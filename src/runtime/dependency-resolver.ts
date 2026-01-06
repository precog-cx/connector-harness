/**
 * Dependency Resolver for RSK Runtime
 * 
 * Extracts values from responses using JSONPath and creates
 * new request contexts based on dependency definitions.
 */

import { JSONPath } from 'jsonpath-plus';
import type { DependencyDef, SelectDef, PaginatedResponse, RequestContext } from './types.js';

export class DependencyResolver {
  private debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
  }

  /**
   * Extract values from a response using JSONPath
   */
  extractValues(
    data: PaginatedResponse,
    selectDef: SelectDef
  ): Array<string | number> {
    try {
      // RSK uses [:_] for array wildcards, JSONPath uses [*]
      const normalizedPath = selectDef.path.replace(/\[:_\]/g, '[*]');
      
      const results = JSONPath({
        path: normalizedPath,
        json: data as Record<string, unknown>,
        wrap: true,
      }) as unknown[];

      if (!results || results.length === 0) {
        return [];
      }

      return results
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
    } catch (error) {
      if (this.debug) {
        console.warn(`[JSONPath] Failed to extract ${selectDef.name}:`, error);
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
  applyDependency(
    dependency: DependencyDef,
    responseData: Map<string, PaginatedResponse[]>,
    currentContext: RequestContext,
    latestOnly = false
  ): RequestContext[] {
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
        const values = this.extractValues(data, selectDef);
        allValues.push(...values);
      }
      
      // Deduplicate
      const uniqueValues = Array.from(new Set(allValues));
      extractedValues.set(selectDef.name, uniqueValues);
    }

    if (extractedValues.size === 0) {
      return [];
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
        [paramName]: value,
      }));
    }

    // Multiple parameters - cartesian product
    const contexts: RequestContext[] = [];
    const cartesian = this.cartesianProduct(entries.map(([_, values]) => values));
    
    for (const combination of cartesian) {
      const context: RequestContext = { ...currentContext };
      entries.forEach(([paramName], index) => {
        context[paramName] = combination[index]!;
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
      const value = context[key.trim()];
      if (value === undefined) {
        // Return match unchanged if not in context (might be a credential)
        return match;
      }
      return String(value);
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
      return context[key] === undefined;
    });
  }
}
