/**
 * PostHog Connector
 * 
 * Full implementation of the PostHog data extraction service based on
 * the rootstock YAML specification.
 */

export { PostHogExtractor } from './extractor';
export { PostHogClient } from './client';
export { RateLimiter } from './rate-limiter';
export { DependencyResolver } from './dependency-resolver';

export type {
  PostHogConfig,
  RequestDef,
  DependencyDef,
  DatasetDef,
  ExtractedData,
  ExtractionOptions,
  ExtractionResult,
  RequestContext,
  PaginatedResponse,
} from './types';
