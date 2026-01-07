/**
 * HTTP Client for RSK Runtime
 * 
 * Handles making HTTP requests with authentication and retry logic.
 */

import type { RskConfig, RuntimeConfig, PaginatedResponse, RequestResult, RequestContext } from './types.js';
import { TransformerPipeline, delay } from './transformer-pipeline.js';
import { interpolateString } from './expression-evaluator.js';

export class HttpClient {
  private rsk: RskConfig;
  private debug: boolean;

  constructor(rsk: RskConfig, config: RuntimeConfig) {
    this.rsk = rsk;
    this.debug = config.debug ?? false;
  }

  /**
   * Make a request to the given URL with proper authentication
   */
  async request(
    url: string,
    requestName: string,
    context: RequestContext
  ): Promise<RequestResult> {
    const requestDef = this.rsk.config.reqs.find(r => r.name === requestName);
    if (!requestDef) {
      throw new Error(`Request not found: ${requestName}`);
    }

    const method = requestDef.method ?? 'GET';
    let headers = this.buildHeaders(requestName, context);
    let body = requestDef.body ? interpolateString(requestDef.body, context) : undefined;
    

    
    // Apply transformers to request
    const transformerNames = requestDef.transformers ?? [];
    const pipeline = new TransformerPipeline(
      this.rsk.config.transformers ?? [],
      context
    );
    
    const modifiedRequest = pipeline.applyToRequest(transformerNames, {
      url,
      method,
      headers,
      body,
    });
    headers = modifiedRequest.headers;
    
    // Debug logging removed for cleaner output

    // Execute with retry logic
    return await this.executeWithRetry(
      url,
      method,
      headers,
      body,
      transformerNames,
      pipeline
    );
  }

  /**
   * Make a GET request (legacy method for compatibility)
   */
  async get(
    url: string,
    requestName: string,
    context: RequestContext
  ): Promise<PaginatedResponse> {
    const result = await this.request(url, requestName, context);
    return result.body as PaginatedResponse;
  }

  /**
   * Build headers for a request based on its transformers
   */
  private buildHeaders(requestName: string, context: RequestContext): Record<string, string> {
    const requestDef = this.rsk.config.reqs.find(r => r.name === requestName);
    if (!requestDef) {
      return {};
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Apply headers directly from request definition
    if (requestDef.headers) {
      for (const [key, value] of Object.entries(requestDef.headers)) {
        // Interpolate variables using context
        headers[key] = interpolateString(value, context);
      }
    }

    // Apply headers from transformers (if any)
    const transformers = requestDef.transformers ?? [];
    for (const transformerName of transformers) {
      const transformer = this.rsk.config.transformers?.find(t => t.name === transformerName);
      if (transformer?.headers) {
        for (const [key, value] of Object.entries(transformer.headers)) {
          // Interpolate variables using context
          headers[key] = interpolateString(value, context);
        }
      }
    }

    return headers;
  }

  /**
   * Execute request with transformer-based retry logic
   */
  private async executeWithRetry(
    url: string,
    method: 'GET' | 'POST',
    headers: Record<string, string>,
    body: string | undefined,
    transformerNames: string[],
    pipeline: TransformerPipeline
  ): Promise<RequestResult> {
    let attemptNumber = 0;
    const maxAttempts = 10; // Safety limit

    while (attemptNumber < maxAttempts) {
      attemptNumber++;

      const options: RequestInit = { method, headers };
      if (body && method === 'POST') {
        options.body = body;
      }

      try {
        const response = await fetch(url, options);
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        // Get response body
        const contentType = response.headers.get('content-type') || '';
        let responseBody: any;
        let fullBody: string;
        
        if (contentType.includes('application/json')) {
          fullBody = await response.text();
          responseBody = JSON.parse(fullBody);
        } else {
          fullBody = await response.text();
          responseBody = fullBody;
        }

        const result: RequestResult = {
          status: response.status,
          headers: responseHeaders,
          body: responseBody,
          fullBody,
        };

        // Check fail conditions
        const failCheck = pipeline.shouldFail(transformerNames, result);
        if (failCheck.fail) {
          throw new Error(failCheck.message || 'Request failed');
        }

        // Check if we should retry
        const retryCheck = pipeline.shouldRetry(transformerNames, result, attemptNumber);
        if (retryCheck.retry && retryCheck.delay) {
          if (this.debug) {
            console.log(`[HTTP] Retrying after ${retryCheck.delay}ms (attempt ${attemptNumber})`);
          }
          await delay(retryCheck.delay);
          continue;
        }

        // Success!
        return result;
      } catch (error) {
        if (this.debug) {
          console.log(`[HTTP] Error: ${(error as Error).message}`);
        }
        
        // For network errors, do basic exponential backoff
        if (attemptNumber < maxAttempts) {
          const backoffDelay = 1000 * Math.pow(2, attemptNumber - 1);
          await delay(backoffDelay);
          continue;
        }
        
        throw error;
      }
    }

    throw new Error(`Request failed after ${maxAttempts} attempts`);
  }
}
