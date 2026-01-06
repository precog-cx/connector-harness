import type { RateLimitWindow } from './types';

/**
 * Rate limiter with sliding window support
 * Implements the rate limiting strategy from PostHog connector spec:
 * - 240 requests per minute
 * - 1200 requests per hour
 * - Handles 429 responses with retry-after headers
 */
export class RateLimiter {
  private windows: Map<string, RateLimitWindow> = new Map();

  constructor(
    private minuteLimit: number = 240,
    private hourLimit: number = 1200
  ) {}

  /**
   * Check if a request can proceed under rate limits
   */
  canProceed(): boolean {
    const now = Date.now();
    
    // Check minute window
    const minuteWindow = this.getOrCreateWindow('minute', now, 60000, this.minuteLimit);
    if (minuteWindow.count >= minuteWindow.maxRequests && now < minuteWindow.windowEnd) {
      return false;
    }

    // Check hour window
    const hourWindow = this.getOrCreateWindow('hour', now, 3600000, this.hourLimit);
    if (hourWindow.count >= hourWindow.maxRequests && now < hourWindow.windowEnd) {
      return false;
    }

    return true;
  }

  /**
   * Record a request
   */
  recordRequest(): void {
    const now = Date.now();
    
    // Update minute window
    const minuteWindow = this.getOrCreateWindow('minute', now, 60000, this.minuteLimit);
    minuteWindow.count++;

    // Update hour window
    const hourWindow = this.getOrCreateWindow('hour', now, 3600000, this.hourLimit);
    hourWindow.count++;
  }

  /**
   * Set a delay based on 429 response
   */
  setRetryAfter(retryAfterSeconds: number): void {
    const now = Date.now();
    const retryAfter = now + (retryAfterSeconds * 1000);
    
    // Set both windows to expire at retry-after time
    const minuteWindow = this.windows.get('minute');
    if (minuteWindow) {
      minuteWindow.windowEnd = Math.max(minuteWindow.windowEnd, retryAfter);
    }
    
    const hourWindow = this.windows.get('hour');
    if (hourWindow) {
      hourWindow.windowEnd = Math.max(hourWindow.windowEnd, retryAfter);
    }
  }

  /**
   * Wait until rate limit allows request
   */
  async waitForSlot(): Promise<void> {
    while (!this.canProceed()) {
      const waitTime = this.getWaitTime();
      await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 1000)));
    }
  }

  /**
   * Get time to wait in milliseconds
   */
  getWaitTime(): number {
    const now = Date.now();
    let minWait = 0;

    const minuteWindow = this.windows.get('minute');
    if (minuteWindow && minuteWindow.count >= minuteWindow.maxRequests && now < minuteWindow.windowEnd) {
      minWait = Math.max(minWait, minuteWindow.windowEnd - now);
    }

    const hourWindow = this.windows.get('hour');
    if (hourWindow && hourWindow.count >= hourWindow.maxRequests && now < hourWindow.windowEnd) {
      minWait = Math.max(minWait, hourWindow.windowEnd - now);
    }

    return minWait;
  }

  /**
   * Get or create a rate limit window
   */
  private getOrCreateWindow(
    key: string,
    now: number,
    windowSize: number,
    maxRequests: number
  ): RateLimitWindow {
    let window = this.windows.get(key);
    
    if (!window || now >= window.windowEnd) {
      window = {
        key,
        windowEnd: now + windowSize,
        count: 0,
        maxRequests,
      };
      this.windows.set(key, window);
    }

    return window;
  }

  /**
   * Get current rate limit stats
   */
  getStats(): { minute: number; hour: number } {
    const minuteWindow = this.windows.get('minute');
    const hourWindow = this.windows.get('hour');
    
    return {
      minute: minuteWindow?.count ?? 0,
      hour: hourWindow?.count ?? 0,
    };
  }

  /**
   * Reset all windows
   */
  reset(): void {
    this.windows.clear();
  }
}
