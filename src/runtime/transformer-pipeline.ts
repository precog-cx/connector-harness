/**
 * Transformer Pipeline
 * 
 * Executes transformer chains (headers, auth, retry, reauth, fail, ratelimit)
 * on HTTP requests and responses per RSK specifications.
 */

import { log } from './logger.js';
import {
  Transformer,
  FailCondition,
  ReauthCondition,
  RequestContext,
  RequestResult,
  RateLimitDef,
} from './types.js';
import { evaluateCondition, interpolateString } from './expression-evaluator.js';

// ============================================================
// Transformer Pipeline
// ============================================================

export class TransformerPipeline {
  private transformers: Map<string, Transformer>;
  private context: RequestContext;

  constructor(transformers: Transformer[], context: RequestContext) {
    this.transformers = new Map(transformers.map(t => [t.name, t]));
    this.context = context;
  }

  /**
   * Apply transformers to a request before execution
   */
  applyToRequest(
    transformerNames: string[],
    request: { url: string; method: string; headers: Record<string, string>; body?: any }
  ): { url: string; method: string; headers: Record<string, string>; body?: any } {
    let modifiedRequest = { ...request };

    for (const name of transformerNames) {
      const transformer = this.transformers.get(name);
      if (!transformer) {
        log.warn('Transformer not found', { name });
        continue;
      }

      // Apply headers transformer (wsk_to_rsk_headers_transformer)
      if (transformer.headers) {
        const interpolatedHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(transformer.headers)) {
          interpolatedHeaders[key] = interpolateString(value, this.context);
        }
        modifiedRequest.headers = {
          ...modifiedRequest.headers,
          ...interpolatedHeaders,
        };
        log.debug('Applied headers transformer', {
          transformer: name,
          headers: interpolatedHeaders,
        });
      }

      // Note: Auth and rate limiting handled separately
    }

    return modifiedRequest;
  }

  /**
   * Check if response should trigger retry
   */
  shouldRetry(
    transformerNames: string[],
    result: RequestResult,
    attemptNumber: number
  ): { retry: boolean; delay?: number } {
    for (const name of transformerNames) {
      const transformer = this.transformers.get(name);
      if (!transformer?.retrywhere) continue;

      const retry = transformer.retrywhere;
      
      // Check if any retry condition matches
      for (const condition of retry.conditions) {
        const matches = this.checkRetryCondition(condition, result);
        if (matches) {
          // Check if we haven't exceeded max retries
          const maxRetries = retry.retries ?? 3;
          if (attemptNumber >= maxRetries) {
            log.info('Max retries exceeded', {
              transformer: name,
              attempts: attemptNumber,
              maxRetries,
            });
            return { retry: false };
          }

          // Calculate delay with exponential backoff
          const initialDelay = retry.initialDelay ?? 1000;
          const maxWait = retry.maxWait ?? 60000;
          const delay = Math.min(
            initialDelay * Math.pow(2, attemptNumber - 1),
            maxWait
          );

          log.info('Retry condition met', {
            transformer: name,
            condition,
            attempt: attemptNumber,
            delay,
          });

          return { retry: true, delay };
        }
      }
    }

    return { retry: false };
  }

  /**
   * Check if response should trigger reauth
   */
  shouldReauth(
    transformerNames: string[],
    result: RequestResult
  ): boolean {
    for (const name of transformerNames) {
      const transformer = this.transformers.get(name);
      if (!transformer?.reauthwhere) continue;

      for (const condition of transformer.reauthwhere) {
        if (this.checkReauthCondition(condition, result)) {
          log.info('Reauth condition met', {
            transformer: name,
            condition,
          });
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if response should trigger failure
   */
  shouldFail(
    transformerNames: string[],
    result: RequestResult
  ): { fail: boolean; message?: string } {
    for (const name of transformerNames) {
      const transformer = this.transformers.get(name);
      if (!transformer?.failwhere) continue;

      for (const condition of transformer.failwhere) {
        if (this.checkFailCondition(condition, result)) {
          const message = condition.message || 'Request failed due to fail condition';
          log.error('Fail condition met', {
            transformer: name,
            condition,
            message,
            status: result.status,
            responseBody: JSON.stringify(result.body).substring(0, 200),
          });
          return { fail: true, message };
        }
      }
    }

    return { fail: false };
  }

  /**
   * Check if a retry condition matches the response
   */
  private checkRetryCondition(
    condition: { status?: number; expr?: string },
    result: RequestResult
  ): boolean {
    // Check status code match
    if (condition.status !== undefined) {
      if (result.status === condition.status) {
        return true;
      }
    }

    // Check expression condition
    if (condition.expr) {
      const contextWithResult = {
        ...this.context,
        extractedData: {
          ...this.context.extractedData,
          response: result.body,
          status: result.status,
        },
      };
      return evaluateCondition(condition.expr, contextWithResult);
    }

    return false;
  }

  /**
   * Check if a reauth condition matches the response
   */
  private checkReauthCondition(
    condition: ReauthCondition,
    result: RequestResult
  ): boolean {
    // Check status code match
    if (condition.status !== undefined) {
      if (result.status === condition.status) {
        return true;
      }
    }

    // Check expression condition
    if (condition.expr) {
      const contextWithResult = {
        ...this.context,
        extractedData: {
          ...this.context.extractedData,
          response: result.body,
          status: result.status,
        },
      };
      return evaluateCondition(condition.expr, contextWithResult);
    }

    return false;
  }

  /**
   * Check if a fail condition matches the response
   */
  private checkFailCondition(
    condition: FailCondition,
    result: RequestResult
  ): boolean {
    // Check status code match
    if (condition.status !== undefined) {
      if (result.status === condition.status) {
        return true;
      }
    }

    // Check expression condition
    if (condition.expr) {
      const contextWithResult = {
        ...this.context,
        extractedData: {
          ...this.context.extractedData,
          response: result.body,
          status: result.status,
        },
      };
      return evaluateCondition(condition.expr, contextWithResult);
    }

    return false;
  }

  /**
   * Get rate limit configuration from transformers
   */
  getRateLimits(transformerNames: string[]): RateLimitDef[] {
    const rateLimits: RateLimitDef[] = [];

    for (const name of transformerNames) {
      const transformer = this.transformers.get(name);
      if (transformer?.ratelimits) {
        rateLimits.push(...transformer.ratelimits);
      }
    }

    return rateLimits;
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Create a transformer pipeline with given transformers and context
 */
export function createTransformerPipeline(
  transformers: Transformer[],
  context: RequestContext
): TransformerPipeline {
  return new TransformerPipeline(transformers, context);
}

/**
 * Delay execution for a given duration (used for retry backoff)
 */
export async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
