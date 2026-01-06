/**
 * RSK Executor
 * 
 * The main runtime engine that executes an RSK configuration.
 * This is a generic executor that works with any RSK YAML file.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type {
  RskConfig,
  RuntimeConfig,
  RequestContext,
  PaginatedResponse,
  ExtractionResult,
  ExecutionStats,
  ExecutionError,
  DependencyDef,
} from './types.js';
import { HttpClient } from './http-client.js';
import { DependencyResolver } from './dependency-resolver.js';

export interface ExecutionResult {
  stats: ExecutionStats;
  errors: ExecutionError[];
  datasets: Map<string, ExtractionResult[]>;
}

export class RskExecutor {
  private rsk: RskConfig;
  private config: RuntimeConfig;
  private client: HttpClient;
  private resolver: DependencyResolver;
  private debug: boolean;

  constructor(rsk: RskConfig, config: RuntimeConfig) {
    this.rsk = rsk;
    this.config = config;
    this.debug = config.debug ?? false;
    this.client = new HttpClient(rsk, config);
    this.resolver = new DependencyResolver(this.debug);
  }

  /**
   * Execute the RSK and extract all data
   */
  async execute(): Promise<ExecutionResult> {
    const stats: ExecutionStats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      startTime: Date.now(),
    };
    const errors: ExecutionError[] = [];
    const responseData = new Map<string, PaginatedResponse[]>();
    const extractedData = new Map<string, ExtractionResult[]>();
    const visitedUrls = new Set<string>();  // Prevent duplicate requests

    console.log(`\nExecuting RSK: ${this.rsk.id}`);
    console.log(`Requests: ${this.rsk.config.reqs.length}`);
    console.log(`Dependencies: ${this.rsk.config.deps.length}`);
    console.log(`Datasets: ${this.rsk.config.datasets.length}\n`);

    // Find entry points (requests with no template variables)
    const entryRequests = this.findEntryRequests();
    console.log(`Entry requests: ${entryRequests.join(', ')}\n`);

    // Process each entry request
    for (const requestName of entryRequests) {
      await this.processRequest(
        requestName,
        {},
        responseData,
        extractedData,
        stats,
        errors,
        visitedUrls
      );
    }

    stats.endTime = Date.now();

    // Save datasets
    await this.saveDatasets(extractedData);

    // Print summary
    this.printSummary(stats, errors, extractedData);

    return {
      stats,
      errors,
      datasets: extractedData,
    };
  }

  /**
   * Find entry requests - requests with no template variables in their URL
   */
  private findEntryRequests(): string[] {
    return this.rsk.config.reqs
      .filter(req => !req.url.includes('{{'))
      .map(req => req.name);
  }

  /**
   * Process a single request and its dependencies
   */
  private async processRequest(
    requestName: string,
    context: RequestContext,
    responseData: Map<string, PaginatedResponse[]>,
    extractedData: Map<string, ExtractionResult[]>,
    stats: ExecutionStats,
    errors: ExecutionError[],
    visitedUrls: Set<string>
  ): Promise<void> {
    const requestDef = this.rsk.config.reqs.find(r => r.name === requestName);
    if (!requestDef) {
      if (this.debug) {
        console.log(`[SKIP] Request not found: ${requestName}`);
      }
      return;
    }

    // Build the URL
    const url = this.resolver.interpolateUrl(requestDef.url, context);
    
    // Check if URL still has unresolved variables (missing context)
    if (this.resolver.hasUnresolvedVariables(url, context)) {
      if (this.debug) {
        console.log(`[SKIP] Unresolved variables in ${requestName}: ${url}`);
      }
      return;
    }

    // Skip if we've already visited this URL
    const urlKey = `${requestName}:${url}`;
    if (visitedUrls.has(urlKey)) {
      if (this.debug) {
        console.log(`[SKIP] Already visited: ${urlKey}`);
      }
      return;
    }
    visitedUrls.add(urlKey);

    console.log(`Fetching ${requestName}: ${url}`);
    stats.totalRequests++;

    try {
      const data = await this.client.get(url, requestName);
      stats.successfulRequests++;

      // Store response
      if (!responseData.has(requestName)) {
        responseData.set(requestName, []);
      }
      responseData.get(requestName)!.push(data);

      // Store extraction result
      if (!extractedData.has(requestName)) {
        extractedData.set(requestName, []);
      }
      extractedData.get(requestName)!.push({
        requestName,
        data,
        url,
        timestamp: Date.now(),
      });

      // Process dependencies
      await this.processDependencies(
        requestName,
        data,
        context,
        responseData,
        extractedData,
        stats,
        errors,
        visitedUrls
      );

    } catch (error) {
      stats.failedRequests++;
      const err = error as Error;
      console.error(`Error in ${requestName}: ${err.message}`);
      errors.push({
        requestName,
        url,
        error: err.message,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Process dependencies after a successful request
   */
  private async processDependencies(
    requestName: string,
    data: PaginatedResponse,
    context: RequestContext,
    responseData: Map<string, PaginatedResponse[]>,
    extractedData: Map<string, ExtractionResult[]>,
    stats: ExecutionStats,
    errors: ExecutionError[],
    visitedUrls: Set<string>
  ): Promise<void> {
    // Find dependencies that have this request as a source
    const dependencies = this.rsk.config.deps.filter(dep =>
      dep.from.includes(requestName)
    );

    for (const dep of dependencies) {
      // Check if this is a pagination dependency (self-referential _paged)
      const isPaginationDep = this.isPaginationDependency(dep);
      
      // Skip pagination when next is null/undefined
      if (isPaginationDep && (data.next === null || data.next === undefined)) {
        if (this.debug) {
          console.log(`[PAGINATION] Stopping ${dep.to.join(', ')} - no more pages`);
        }
        continue;
      }

      // Apply dependency to get new contexts
      const newContexts = this.resolver.applyDependency(
        dep,
        responseData,
        context,
        isPaginationDep  // Use latest only for pagination
      );

      // Process each dependent request
      for (const newContext of newContexts) {
        for (const toRequest of dep.to) {
          await this.processRequest(
            toRequest,
            newContext,
            responseData,
            extractedData,
            stats,
            errors,
            visitedUrls
          );
        }
      }
    }
  }

  /**
   * Check if a dependency is for pagination (self-referential _paged request)
   */
  private isPaginationDependency(dep: DependencyDef): boolean {
    return dep.to.some(toReq => 
      toReq.includes('_paged') && dep.from.includes(toReq)
    );
  }

  /**
   * Save extracted data to output files organized by dataset
   */
  private async saveDatasets(
    extractedData: Map<string, ExtractionResult[]>
  ): Promise<void> {
    mkdirSync(this.config.outputDir, { recursive: true });

    for (const datasetDef of this.rsk.config.datasets) {
      const datasetResults: unknown[] = [];

      for (const requestName of datasetDef.data) {
        const results = extractedData.get(requestName);
        if (results) {
          for (const result of results) {
            // Extract the actual data (usually in 'results' array)
            if (Array.isArray(result.data.results)) {
              datasetResults.push(...result.data.results);
            } else {
              datasetResults.push(result.data);
            }
          }
        }
      }

      if (datasetResults.length > 0) {
        const filename = `${datasetDef.name.replace(/\s+/g, '_').toLowerCase()}.json`;
        const filepath = join(this.config.outputDir, filename);
        writeFileSync(filepath, JSON.stringify(datasetResults, null, 2));
        console.log(`Saved ${datasetResults.length} records to ${filename}`);
      }
    }
  }

  /**
   * Print execution summary
   */
  private printSummary(
    stats: ExecutionStats,
    errors: ExecutionError[],
    extractedData: Map<string, ExtractionResult[]>
  ): void {
    const duration = ((stats.endTime ?? Date.now()) - stats.startTime) / 1000;
    
    console.log('\n=== Execution Summary ===');
    console.log(`RSK: ${this.rsk.id}`);
    console.log(`Duration: ${duration.toFixed(2)}s`);
    console.log(`Total Requests: ${stats.totalRequests}`);
    console.log(`Successful: ${stats.successfulRequests}`);
    console.log(`Failed: ${stats.failedRequests}`);
    console.log(`Unique Endpoints: ${extractedData.size}`);
    
    if (errors.length > 0) {
      console.log(`\nErrors (${errors.length}):`);
      const uniqueErrors = new Map<string, number>();
      for (const err of errors) {
        const key = `${err.requestName}: ${err.error.substring(0, 80)}`;
        uniqueErrors.set(key, (uniqueErrors.get(key) ?? 0) + 1);
      }
      for (const [msg, count] of uniqueErrors) {
        console.log(`  - ${msg} (x${count})`);
      }
    }
  }
}
