/**
 * Dependency Resolver for RSK Runtime
 * 
 * Extracts values from responses using JSONPath and creates
 * new request contexts based on dependency definitions.
 */

import { JSONPath } from 'jsonpath-plus';
import type { DependencyDef, SelectDef, PaginatedResponse, RequestContext, RequestResult } from './types.js';
import { ExpressionEvaluator, evaluateCondition } from './expression-evaluator.js';
import { TokenStorage } from './token-storage.js';

export class DependencyResolver {
  private debug: boolean;
  private tokenStorage?: TokenStorage;

  constructor(debug = false, tokenStorage?: TokenStorage) {
    this.debug = debug;
    this.tokenStorage = tokenStorage;
  }

  /**
   * Extract values from a response using JSONPath or expression evaluation
   */
  async extractValues(
    data: PaginatedResponse | RequestResult,
    selectDef: SelectDef,
    context: RequestContext
  ): Promise<Array<string | number | any>> {
    try {
      // Handle nested select (aggregations) FIRST - extract nested values before evaluating expr
      let nestedContext = context;
      if (selectDef.select && selectDef.select.length > 0) {
        // Create a temporary context with nested extracted values
        nestedContext = {
          ...context,
          extractedData: {
            ...context.extractedData,
          }
        };
        
        for (const nestedSelect of selectDef.select) {
          const values = await this.extractValues(data, nestedSelect, context);
          // Add the extracted values to the nested context so they're available for expr evaluation
          if (values.length > 0) {
            nestedContext.extractedData![nestedSelect.name] = values;
          }
        }
        
        // If there's no expr, return the nested results directly
        if (!selectDef.expr) {
          return Object.values(nestedContext.extractedData!).flat();
        }
      }
      
      // Handle expr-based selection (using nestedContext if nested selects were extracted)
      if (selectDef.expr) {
        const evaluator = new ExpressionEvaluator(nestedContext);
        const result = evaluator.evaluate(selectDef.expr);
        
        // Store authy values
        if (selectDef.authy && this.tokenStorage) {
          await this.tokenStorage.saveAuthyValue(selectDef.name, result);
        }
        
        return [result];
      }

      // Handle full-body type
      if (selectDef.type === 'full-body') {
        const result = 'body' in data ? data.body : data;
        const fullBody = JSON.stringify(result);
        const upTo = selectDef['up-to'];
        return [upTo ? fullBody.substring(0, upTo) : fullBody];
      }

      // Handle status type
      if (selectDef.type === 'status') {
        const status = 'status' in data ? data.status : 200;
        return [status];
      }

      // Handle JSONPath extraction
      if (!selectDef.path) {
        return [];
      }

      // RSK uses [:_] for array wildcards, JSONPath uses [*]
      const normalizedPath = selectDef.path.replace(/\[:_\]/g, '[*]').replace(/\[_:\]/g, '[*]');
      
      // Extract from body if this is a PaginatedResponse, otherwise use data directly
      const jsonData = 'body' in data ? data.body : data;
      
      const results = JSONPath({
        path: normalizedPath,
        json: jsonData as Record<string, unknown>,
        wrap: true,
      }) as unknown[];

      if (!results || results.length === 0) {
        return [];
      }

      // For nested selects, return the raw results without type conversion
      // This allows aggregation functions like count() to work on object arrays
      const isNestedInAggregation = selectDef.type === 'number' && typeof results[0] === 'object';
      if (isNestedInAggregation) {
        return results;
      }

      const typedResults = results
        .map(value => {
          if (selectDef.type === 'number') {
            return typeof value === 'number' ? value : Number(value);
          }
          return String(value);
        })
        .filter(value => {
          if (selectDef.type === 'number') {
            return !isNaN(value as number);
          }
          // Filter out null/undefined string representations
          return value !== 'null' && value !== 'undefined' && value !== '';
        });

      // Store authy values
      if (selectDef.authy && this.tokenStorage && typedResults.length > 0) {
        await this.tokenStorage.saveAuthyValue(selectDef.name, typedResults[0]);
      }

      return typedResults;
    } catch (error) {
      if (this.debug) {
        console.warn(`[Extract] Failed to extract ${selectDef.name}:`, error);
      }
      return [];
    }
  }

  /**
   * Apply a dependency to create new request contexts
   * 
   * @param dependency - The dependency definition from the RSK
   * @param responseData - All collected response data
   * @param currentContext - The current request context
   * @param latestOnly - If true, only use the latest response (for pagination)
   */
  async applyDependency(
    dependency: DependencyDef,
    responseData: Map<string, PaginatedResponse[]>,
    currentContext: RequestContext,
    latestOnly = false
  ): Promise<RequestContext[]> {
    // Get source data from the 'from' requests
    const sourceData: PaginatedResponse[] = [];
    for (const fromReq of dependency.from) {
      const data = responseData.get(fromReq);
      if (data && data.length > 0) {
        if (latestOnly) {
          // For pagination, only use the latest response
          sourceData.push(data[data.length - 1]!);
        } else {
          sourceData.push(...data);
        }
      }
    }

    if (sourceData.length === 0) {
      return [];
    }

    // Extract values for each select definition
    const extractedValues = new Map<string, Array<string | number>>();
    
    for (const selectDef of dependency.select) {
      const allValues: Array<string | number> = [];
      
      for (const data of sourceData) {
        const values = await this.extractValues(data, selectDef, currentContext);
        allValues.push(...values);
      }
      
      // Deduplicate
      const uniqueValues = Array.from(new Set(allValues));
      extractedValues.set(selectDef.name, uniqueValues);
    }

    if (extractedValues.size === 0) {
      return [];
    }

    // Create a temporary context with extracted values for selectwhere evaluation
    const tempContext: RequestContext = {
      ...currentContext,
      extractedData: {
        ...currentContext.extractedData,
      }
    };
    
    // Add all extracted values to temp context for condition evaluation
    for (const [name, values] of extractedValues.entries()) {
      if (values.length > 0) {
        tempContext.extractedData![name] = values[0];
      }
    }
    
    // Check selectwhere condition AFTER extracting values
    if (dependency.selectwhere) {
      const shouldApply = evaluateCondition(dependency.selectwhere, tempContext);
      if (!shouldApply) {
        if (this.debug) {
          console.log(`[Dependency] Skipping - selectwhere condition false`);
        }
        return [];
      }
    }

    // Create new contexts from extracted values
    return this.createContexts(extractedValues, currentContext);
  }

  /**
   * Create request contexts from extracted values
   * If multiple parameters, creates cartesian product
   */
  private createContexts(
    extractedValues: Map<string, Array<string | number>>,
    currentContext: RequestContext
  ): RequestContext[] {
    const entries = Array.from(extractedValues.entries());
    
    if (entries.length === 0) {
      return [];
    }

    // Single parameter - one context per value
    if (entries.length === 1) {
      const [paramName, values] = entries[0]!;
      return values.map(value => ({
        ...currentContext,
        extractedData: {
          ...currentContext.extractedData,
          [paramName]: value,
        },
      }));
    }

    // Multiple parameters - cartesian product
    const contexts: RequestContext[] = [];
    const cartesian = this.cartesianProduct(entries.map(([_, values]) => values));
    
    for (const combination of cartesian) {
      const context: RequestContext = { 
        ...currentContext,
        extractedData: { ...currentContext.extractedData },
      };
      entries.forEach(([paramName], index) => {
        context.extractedData![paramName] = combination[index]!;
      });
      contexts.push(context);
    }

    return contexts;
  }

  /**
   * Compute cartesian product of arrays
   */
  private cartesianProduct<T>(arrays: T[][]): T[][] {
    if (arrays.length === 0) return [[]];
    
    return arrays.reduce<T[][]>(
      (acc, array) => acc.flatMap(combo => array.map(item => [...combo, item])),
      [[]]
    );
  }

  /**
   * Interpolate URL template with context values
   */
  interpolateUrl(template: string, context: RequestContext): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const trimmedKey = key.trim();
      
      // Check extractedData first
      const value = context.extractedData?.[trimmedKey];
      if (value !== undefined) {
        return String(value);
      }
      
      // Return match unchanged (might be a credential or system variable)
      return match;
    });
  }

  /**
   * Check if a URL template has unresolved variables
   */
  hasUnresolvedVariables(template: string, context: RequestContext): boolean {
    const matches = template.match(/\{\{([^}]+)\}\}/g);
    if (!matches) return false;
    
    return matches.some(match => {
      const key = match.slice(2, -2).trim();
      return context.extractedData?.[key] === undefined &&
             context.credentials?.[key] === undefined &&
             context.authState === undefined &&
             context.systemVariables?.[key] === undefined;
    });
  }
}
