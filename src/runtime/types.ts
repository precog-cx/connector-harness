/**
 * Generic RSK Runtime Types
 * 
 * These types represent the structure of a Rootstock (RSK) YAML file
 * and the runtime configuration needed to execute it.
 */

// ============================================================
// RSK YAML Structure Types (parsed from the YAML file)
// ============================================================

export interface RskConfig {
  id: string;
  description?: string;
  naming?: {
    type: string;
    fieldName: string;
  };
  configSchema: Record<string, ConfigField>;
  config: {
    metadata?: Record<string, unknown>;
    transformers: Transformer[];
    reqs: RequestDef[];
    deps: DependencyDef[];
    datasets: DatasetDef[];
  };
}

export interface ConfigField {
  fieldDescription: string;
  sensitive: boolean;
}

export interface Transformer {
  name: string;
  headers?: Record<string, string>;
  ratelimits?: RateLimitDef[];
  retrywhere?: RetryDef;
}

export interface RateLimitDef {
  key: string;
  window: string;
  select: unknown;
  hooks: {
    pre?: RateLimitHook[];
    post?: RateLimitHook[];
  };
}

export interface RateLimitHook {
  select: Array<{ name: string; expr?: string; type?: string; headername?: string }>;
  trigger: string;
  until: string | null;
}

export interface RetryDef {
  conditions: Array<{
    expr: string;
    select: Array<{ name: string; type: string }>;
  }>;
}

export interface RequestDef {
  name: string;
  url: string;
  method?: 'GET' | 'POST';  // Default: GET
  body?: string;            // For POST requests
  transformers?: string[];
}

export interface DependencyDef {
  from: string[];
  to: string[];
  select: SelectDef[];
}

export interface SelectDef {
  name: string;
  path: string;
  type: 'string' | 'number';
}

export interface DatasetDef {
  name: string;
  data: string[];
}

// ============================================================
// Runtime Configuration (provided by user at execution time)
// ============================================================

export interface RuntimeConfig {
  /** Credentials and config values matching configSchema keys */
  credentials: Record<string, string>;
  /** Output directory for extracted data */
  outputDir: string;
  /** Optional: limit number of pages for testing */
  maxPagesPerRequest?: number;
  /** Optional: enable debug logging */
  debug?: boolean;
}

// ============================================================
// Execution State
// ============================================================

export interface RequestContext {
  [key: string]: string | number;
}

export interface PaginatedResponse {
  results?: unknown[];
  next?: string | null;
  previous?: string | null;
  count?: number;
  [key: string]: unknown;
}

export interface ExtractionResult {
  requestName: string;
  data: PaginatedResponse;
  url: string;
  timestamp: number;
}

export interface ExecutionStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  startTime: number;
  endTime?: number;
}

export interface ExecutionError {
  requestName: string;
  url: string;
  error: string;
  timestamp: number;
}
