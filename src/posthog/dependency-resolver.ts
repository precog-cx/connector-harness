import { JSONPath } from 'jsonpath-plus';
import type {
  DependencyDef,
  RequestContext,
  PaginatedResponse,
  SelectDef,
} from './types';

/**
 * Resolves dependencies between requests and extracts parameters
 * Implements the dependency chain logic from PostHog connector spec
 */
export class DependencyResolver {
  /**
   * Extract values from response data using JSONPath
   */
  extractValues(
    data: unknown,
    selectDef: SelectDef
  ): Array<string | number> {
    try {
      const results = JSONPath({ 
        path: selectDef.path, 
        json: data as Record<string, unknown>
      });
      
      if (!Array.isArray(results)) {
        return [];
      }

      // Convert to correct type
      return results.map(value => {
        if (selectDef.type === 'number') {
          return typeof value === 'number' ? value : Number(value);
        }
        return String(value);
      }).filter(value => 
        selectDef.type === 'number' ? !isNaN(value as number) : value !== 'null' && value !== 'undefined'
      );
    } catch (error) {
      console.warn(`Failed to extract values for ${selectDef.name}:`, error);
      return [];
    }
  }

  /**
   * Apply dependencies to create new request contexts
   */
  applyDependency(
    dependency: DependencyDef,
    responseData: Map<string, PaginatedResponse[]>,
    currentContext: RequestContext
  ): RequestContext[] {
    const newContexts: RequestContext[] = [];

    // Get data from source requests
    const sourceData: PaginatedResponse[] = [];
    for (const fromReq of dependency.from) {
      const data = responseData.get(fromReq);
      if (data) {
        sourceData.push(...data);
      }
    }

    if (sourceData.length === 0) {
      return [];
    }

    // Extract values from each select definition
    const extractedValues: Map<string, Array<string | number>> = new Map();
    
    for (const selectDef of dependency.select) {
      const allValues: Array<string | number> = [];
      
      for (const data of sourceData) {
        const values = this.extractValues(data, selectDef);
        allValues.push(...values);
      }
      
      // Deduplicate values
      const uniqueValues = Array.from(new Set(allValues));
      extractedValues.set(selectDef.name, uniqueValues);
    }

    // Create cartesian product of all extracted values
    if (extractedValues.size === 0) {
      return [];
    }

    const valueArrays = Array.from(extractedValues.entries());
    
    // If only one parameter, create one context per value
    if (valueArrays.length === 1) {
      const [paramName, values] = valueArrays[0]!;
      for (const value of values) {
        newContexts.push({
          ...currentContext,
          [paramName]: value,
        });
      }
    } else {
      // Multiple parameters - create cartesian product
      const combinations = this.cartesianProduct(
        valueArrays.map(([_, values]) => values)
      );
      
      for (const combo of combinations) {
        const newContext: RequestContext = { ...currentContext };
        valueArrays.forEach(([paramName], index) => {
          newContext[paramName] = combo[index]!;
        });
        newContexts.push(newContext);
      }
    }

    return newContexts;
  }

  /**
   * Create cartesian product of arrays
   */
  private cartesianProduct<T>(arrays: T[][]): T[][] {
    if (arrays.length === 0) return [[]];
    if (arrays.length === 1) return arrays[0]!.map(x => [x]);
    
    const [first, ...rest] = arrays;
    const restProduct = this.cartesianProduct(rest);
    
    const result: T[][] = [];
    for (const item of first!) {
      for (const combo of restProduct) {
        result.push([item, ...combo]);
      }
    }
    
    return result;
  }

  /**
   * Interpolate template variables in URL
   */
  interpolateUrl(url: string, context: RequestContext): string {
    let interpolated = url;
    
    for (const [key, value] of Object.entries(context)) {
      const placeholder = `{{${key}}}`;
      if (interpolated.includes(placeholder)) {
        interpolated = interpolated.replace(placeholder, String(value));
      }
    }
    
    return interpolated;
  }

  /**
   * Check if URL has unresolved template variables
   */
  hasUnresolvedVariables(url: string): boolean {
    return /\{\{[^}]+\}\}/.test(url);
  }

  /**
   * Extract template variables from URL
   */
  extractVariables(url: string): string[] {
    const matches = url.match(/\{\{([^}]+)\}\}/g);
    if (!matches) return [];
    
    return matches.map(match => match.slice(2, -2));
  }
}
