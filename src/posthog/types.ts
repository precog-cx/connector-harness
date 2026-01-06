/**
 * Type definitions for PostHog connector
 */

// Configuration
export interface PostHogConfig {
  name: string;
  apiKey: string;
}

// Rate limit tracking
export interface RateLimitWindow {
  key: string;
  windowEnd: number;
  count: number;
  maxRequests: number;
}

// Request definition
export interface RequestDef {
  name: string;
  url: string;
  transformers: string[];
}

// Dependency definition
export interface DependencyDef {
  from: string[];
  to: string[];
  select: SelectDef[];
}

export interface SelectDef {
  name: string;
  path: string; // JSONPath expression
  type: 'string' | 'number';
}

// Dataset definition
export interface DatasetDef {
  name: string;
  data: string[];
}

// Extracted data
export interface ExtractedData {
  requestName: string;
  data: unknown;
  timestamp: number;
}

// Request context
export interface RequestContext {
  [key: string]: string | number | string[] | number[];
}

// Response with pagination
export interface PaginatedResponse {
  next?: string;
  results?: unknown[];
  [key: string]: unknown;
}

// Extraction options
export interface ExtractionOptions {
  maxConcurrency?: number;
  verbose?: boolean;
  outputDir?: string;
}

// Extraction result
export interface ExtractionResult {
  success: boolean;
  datasets: Map<string, ExtractedData[]>;
  errors: Error[];
  stats: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    retries: number;
    duration: number;
  };
}
