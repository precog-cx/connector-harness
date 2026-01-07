/**
 * Expression Evaluator
 *
 * Evaluates expr fields used in RSK configurations for computed values.
 * Supports operators, functions, and variable interpolation.
 */
import { RequestContext } from './types.js';

// ============================================================
// Expression Functions
// ============================================================

const FUNCTIONS: Record<string, (...args: any[]) => any> = {
  to_string: (value: any) => String(value),
  to_number: (value: any) => Number(value),
  url_encode: (value: string) => encodeURIComponent(value),
  base64: (value: string) => Buffer.from(value).toString('base64'),
  count: (arr: any[]) => arr?.length ?? 0,
  max: (...values: number[]) => Math.max(...values),
  now: () => Date.now(),
  not: (value: any) => !value,
  find_in: (arr: any[], key: string, value: any) =>
    arr?.find((item: any) => item[key] === value),
};

// ============================================================
// Expression Evaluator
// ============================================================

export class ExpressionEvaluator {
  private context: RequestContext;

  constructor(context: RequestContext) {
    this.context = context;
  }

  /**
   * Evaluate an expression string with the current context
   */
  evaluate(expr: string): any {
    try {
      // First, interpolate {{variable}} references
      const interpolated = this.interpolateVariables(expr);

      // Then evaluate the expression
      return this.evaluateExpression(interpolated);
    } catch (error: any) {
      throw new Error(
        `Expression evaluation failed: ${error.message}\nExpression: ${expr}`
      );
    }
  }

  /**
   * Interpolate {{variable}} references in a string
   */
  interpolateVariables(expr: string): string {
    return expr.replace(/\{\{([^}]+)\}\}/g, (_, varName) => {
      const value = this.resolveVariable(varName.trim());
      return String(value);
    });
  }

  /**
   * Resolve a variable name to its value from context
   */
  private resolveVariable(varName: string): any {
    // Check system variables first
    const systemVars: Record<string, any> = {
      precog_state: this.context.systemVariables?.precog_state,
      precog_root_uri: this.context.systemVariables?.precog_root_uri,
      precog_redirect_uri: this.context.systemVariables?.precog_redirect_uri,
      wsk_to_rsk_redirect_uri:
        this.context.systemVariables?.wsk_to_rsk_redirect_uri,
      wsk_to_rsk_client_id: this.context.credentials?.['Client Id'],
      wsk_to_rsk_client_secret: this.context.credentials?.['Client Secret'],
      wsk_to_rsk_oauth2_code:
        this.context.systemVariables?.wsk_to_rsk_oauth2_code,
      wsk_to_rsk_auth_token: this.context.authState?.accessToken,
      wsk_to_rsk_refresh_token: this.context.authState?.refreshToken,
    };

    if (varName in systemVars && systemVars[varName] !== undefined) {
      return systemVars[varName];
    }

    // Check authy values (stored in authState)
    if (this.context.authState?.authyValues?.[varName] !== undefined) {
      return this.context.authState.authyValues[varName];
    }

    // Check extracted data from dependencies
    if (this.context.extractedData?.[varName] !== undefined) {
      return this.context.extractedData[varName];
    }

    // Check credentials
    if (this.context.credentials?.[varName] !== undefined) {
      return this.context.credentials[varName];
    }

    throw new Error(`Variable not found: ${varName}`);
  }

  /**
   * Evaluate an expression (supports operators and function calls)
   */
  private evaluateExpression(expr: string): any {
    const trimmed = expr.trim();

    // Handle parentheses - strip outer parens and re-evaluate
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      // Check if these are matching outer parens
      let depth = 0;
      let isOuterParen = true;
      for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i] === '(') depth++;
        if (trimmed[i] === ')') depth--;
        // If depth reaches 0 before the end, these aren't outer parens
        if (depth === 0 && i < trimmed.length - 1) {
          isOuterParen = false;
          break;
        }
      }
      if (isOuterParen) {
        return this.evaluateExpression(trimmed.slice(1, -1));
      }
    }

    // Handle function calls: function_name(arg1, arg2, ...)
    const functionMatch = trimmed.match(/^(\w+)\((.*)\)$/);
    if (functionMatch) {
      const [, funcName, argsStr] = functionMatch;
      if (!funcName) {
        throw new Error('Invalid function syntax');
      }
      const func = FUNCTIONS[funcName];
      if (!func) {
        throw new Error(`Unknown function: ${funcName}`);
      }

      // Parse arguments (simple comma-separated for now)
      const args = argsStr
        ? argsStr.split(',').map((arg) => this.evaluateExpression(arg.trim()))
        : [];

      return func(...args);
    }

    // Handle binary operators
    const operators = [
      { regex: /(.+)\s*\|\|\s*(.+)/, op: (a: any, b: any) => a || b },
      { regex: /(.+)\s*&&\s*(.+)/, op: (a: any, b: any) => a && b },
      { regex: /(.+)\s*==\s*(.+)/, op: (a: any, b: any) => a == b },
      { regex: /(.+)\s*!=\s*(.+)/, op: (a: any, b: any) => a != b },
      { regex: /(.+)\s*>=\s*(.+)/, op: (a: any, b: any) => a >= b },
      { regex: /(.+)\s*<=\s*(.+)/, op: (a: any, b: any) => a <= b },
      { regex: /(.+)\s*>\s*(.+)/, op: (a: any, b: any) => a > b },
      { regex: /(.+)\s*<\s*(.+)/, op: (a: any, b: any) => a < b },
      { regex: /(.+)\s*\+\s*(.+)/, op: (a: any, b: any) => a + b },
      { regex: /(.+)\s*-\s*(.+)/, op: (a: any, b: any) => a - b },
      { regex: /(.+)\s*\*\s*(.+)/, op: (a: any, b: any) => a * b },
      { regex: /(.+)\s*\/\s*(.+)/, op: (a: any, b: any) => a / b },
    ];

    for (const { regex, op } of operators) {
      const match = trimmed.match(regex);
      if (match) {
        const [, left, right] = match;
        if (!left || !right) continue;
        const leftVal = this.evaluateExpression(left);
        const rightVal = this.evaluateExpression(right);
        return op(leftVal, rightVal);
      }
    }

    // Handle string literals (quoted)
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return trimmed.slice(1, -1);
    }

    // Handle number literals
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }

    // Handle boolean literals
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;

    // Otherwise, treat as variable reference
    return this.resolveVariable(trimmed);
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Evaluate a conditional expression (for selectwhere, failwhere, reauthwhere)
 */
export function evaluateCondition(
  condition: string,
  context: RequestContext
): boolean {
  const evaluator = new ExpressionEvaluator(context);
  const result = evaluator.evaluate(condition);
  return Boolean(result);
}

/**
 * Interpolate {{variable}} references in a template string
 */
export function interpolateString(
  template: string,
  context: RequestContext
): string {
  const evaluator = new ExpressionEvaluator(context);
  return evaluator.interpolateVariables(template);
}
