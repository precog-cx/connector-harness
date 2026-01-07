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
  failwhere?: FailCondition[];
  reauthwhere?: ReauthCondition[];
}

export interface FailCondition {
  status?: number;
  expr?: string;
  message?: string;
  select?: SelectDef[];
  solutions?: { message: string; select?: SelectDef[] }[];
}

export interface ReauthCondition {
  status?: number;
  expr?: string;
  select?: SelectDef[];
  nuke?: boolean;
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
  retries?: number;
  initialDelay?: number;
  maxWait?: number;
}

export interface RequestDef {
  name: string;
  url?: string;            // Optional for function-based requests
  method?: 'GET' | 'POST';  // Default: GET
  body?: string;            // For POST requests
  headers?: Record<string, string>; // Direct headers on request
  transformers?: string[];
  format?: { type: string }; // Response format
  function?: string;        // Special functions like 'interactiveOAuth2Authorization'
  args?: { authorizeUrl: string }; // Function arguments
  cacheId?: string;         // Token cache identifier
  loadtype?: 'initial' | 'delta'; // Load type
}

export interface DependencyDef {
  from: string[];
  to: string[];
  select: SelectDef[];
  selectwhere?: string;     // Condition for branching
  loadtype?: 'initial' | 'delta'; // Load type filter
}

export interface SelectDef {
  name: string;
  path?: string;            // Optional when using expr
  type?: 'string' | 'number' | 'status' | 'full-body';
  expr?: string;            // Expression for computed values
  authy?: boolean;          // Mark for secure storage
  select?: SelectDef[];     // Nested selects for aggregations
  'up-to'?: number;         // Max bytes for full-body
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
  /** OAuth2: Port for local callback server (default: 3000) */
  redirectPort?: number;
  /** OAuth2: Full redirect URI override */
  redirectUri?: string;
  /** OAuth2: Force new authorization even if tokens exist */
  forceReauth?: boolean;
}

// ============================================================
// Execution State
// ============================================================

export interface RequestContext {
  /** Extracted data from dependencies */
  extractedData?: Record<string, any>;
  /** User-provided credentials */
  credentials?: Record<string, string>;
  /** OAuth2 authentication state */
  authState?: AuthState;
  /** System-generated variables (precog_state, etc.) */
  systemVariables?: Record<string, any>;
  /** Legacy: direct key-value pairs */
  [key: string]: any;
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

// ============================================================
// OAuth2 Support Types
// ============================================================

export interface AuthState {
  /** Access token for API requests */
  accessToken?: string;
  /** Refresh token for renewing access */
  refreshToken?: string;
  /** Token expiration timestamp */
  expiresAt?: number;
  /** Additional authy: true values from OAuth2 responses */
  authyValues?: Record<string, any>;
}

export interface RequestResult {
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Response body (parsed JSON or raw text) */
  body: any;
  /** Full response body as string (for full-body type) */
  fullBody?: string;
}

export interface ExecutionError {
  requestName: string;
  url: string;
  error: string;
  timestamp: number;
}
