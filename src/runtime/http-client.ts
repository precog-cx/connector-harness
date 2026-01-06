/**
 * HTTP Client for RSK Runtime
 * 
 * Handles making HTTP requests with authentication and retry logic.
 */

import type { RskConfig, RuntimeConfig, PaginatedResponse } from './types.js';

export class HttpClient {
  private rsk: RskConfig;
  private credentials: Record<string, string>;
  private debug: boolean;

  constructor(rsk: RskConfig, config: RuntimeConfig) {
    this.rsk = rsk;
    this.credentials = config.credentials;
    this.debug = config.debug ?? false;
  }

  /**
   * Make a GET request to the given URL with proper authentication
   */
  async get(url: string, requestName: string): Promise<PaginatedResponse> {
    const headers = this.buildHeaders(requestName);
    
    if (this.debug) {
      console.log(`[HTTP] GET ${url}`);
    }

    const response = await this.fetchWithRetry(url, headers);
    
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body}`);
    }

    return response.json() as Promise<PaginatedResponse>;
  }

  /**
   * Build headers for a request based on its transformers
   */
  private buildHeaders(requestName: string): Record<string, string> {
    const requestDef = this.rsk.config.reqs.find(r => r.name === requestName);
    if (!requestDef) {
      return {};
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Apply headers from transformers (if any)
    const transformers = requestDef.transformers ?? [];
    for (const transformerName of transformers) {
      const transformer = this.rsk.config.transformers?.find(t => t.name === transformerName);
      if (transformer?.headers) {
        for (const [key, value] of Object.entries(transformer.headers)) {
          // Interpolate credential values like {{API Key}}
          headers[key] = this.interpolateCredentials(value);
        }
      }
    }

    return headers;
  }

  /**
   * Replace {{credential}} placeholders with actual values
   */
  private interpolateCredentials(template: string): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      const value = this.credentials[key.trim()];
      if (value === undefined) {
        throw new Error(`Missing credential: ${key}`);
      }
      return value;
    });
  }

  /**
   * Fetch with retry logic for transient errors
   */
  private async fetchWithRetry(
    url: string,
    headers: Record<string, string>,
    maxRetries = 3
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, { headers });
        
        // Retry on 429 (rate limit) or 504 (gateway timeout)
        if (response.status === 429 || response.status === 504) {
          const retryAfter = response.headers.get('retry-after');
          const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000 * (attempt + 1);
          
          if (this.debug) {
            console.log(`[HTTP] ${response.status} - retrying in ${waitTime}ms`);
          }
          
          await this.sleep(waitTime);
          continue;
        }

        return response;
      } catch (error) {
        lastError = error as Error;
        if (this.debug) {
          console.log(`[HTTP] Error: ${lastError.message} - retrying...`);
        }
        await this.sleep(1000 * (attempt + 1));
      }
    }

    throw lastError ?? new Error('Request failed after retries');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
