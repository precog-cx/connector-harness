import { RateLimiter } from './rate-limiter';
import type { PostHogConfig } from './types';

/**
 * HTTP client for PostHog API with authentication, rate limiting, and retries
 */
export class PostHogClient {
  private rateLimiter: RateLimiter;
  private maxRetries = 3;
  private retryDelay = 1000;

  constructor(private config: PostHogConfig) {
    this.rateLimiter = new RateLimiter();
  }

  /**
   * Make a GET request to PostHog API
   */
  async get<T = unknown>(url: string): Promise<T> {
    return this.request<T>(url);
  }

  /**
   * Make a request with retries and rate limiting
   */
  private async request<T>(
    url: string,
    attempt = 0
  ): Promise<T> {
    // Wait for rate limit slot
    await this.rateLimiter.waitForSlot();

    try {
      this.rateLimiter.recordRequest();

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Accept': 'application/json',
        },
      });

      // Handle rate limiting (429)
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const retryAfterSeconds = parseInt(retryAfter, 10);
          console.log(`Rate limited. Retrying after ${retryAfterSeconds}s`);
          this.rateLimiter.setRetryAfter(retryAfterSeconds);
        }
        
        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelay * Math.pow(2, attempt));
          return this.request<T>(url, attempt + 1);
        }
        
        throw new Error(`Rate limit exceeded after ${attempt + 1} attempts`);
      }

      // Handle gateway timeout (504) - as specified in connector
      if (response.status === 504) {
        if (attempt < this.maxRetries) {
          console.log(`Gateway timeout. Retrying (${attempt + 1}/${this.maxRetries})...`);
          await this.delay(this.retryDelay * Math.pow(2, attempt));
          return this.request<T>(url, attempt + 1);
        }
        
        throw new Error(`Gateway timeout after ${attempt + 1} attempts`);
      }

      // Handle other errors
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${errorText || response.statusText}`
        );
      }

      // Parse and return response
      const data = await response.json() as T;
      return data;

    } catch (error) {
      // Retry on network errors
      if (error instanceof TypeError && error.message.includes('fetch') && attempt < this.maxRetries) {
        console.log(`Network error. Retrying (${attempt + 1}/${this.maxRetries})...`);
        await this.delay(this.retryDelay * Math.pow(2, attempt));
        return this.request<T>(url, attempt + 1);
      }
      
      throw error;
    }
  }

  /**
   * Delay for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get rate limiter stats
   */
  getRateLimitStats() {
    return this.rateLimiter.getStats();
  }

  /**
   * Reset rate limiter
   */
  resetRateLimiter(): void {
    this.rateLimiter.reset();
  }
}
