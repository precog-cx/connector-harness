/**
 * RSK Executor
 *
 * The main runtime engine that executes an RSK configuration.
 * This is a generic executor that works with any RSK YAML file.
 */
import { mkdirSync, writeFileSync } from 'fs';
import crypto from 'node:crypto';
import { join } from 'path';

import { DependencyResolver } from './dependency-resolver.js';
import { interpolateString } from './expression-evaluator.js';
import { HttpClient } from './http-client.js';
import { OAuth2Handler, openBrowser } from './oauth2-handler.js';
import { TokenStorage } from './token-storage.js';
import type {
  AuthState,
  DependencyDef,
  ExecutionError,
  ExecutionStats,
  ExtractionResult,
  PaginatedResponse,
  RequestContext,
  RskConfig,
  RuntimeConfig,
} from './types.js';

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
  private tokenStorage: TokenStorage;
  private oauth2Handler?: OAuth2Handler;
  private debug: boolean;
  private authState?: AuthState;

  constructor(rsk: RskConfig, config: RuntimeConfig) {
    this.rsk = rsk;
    this.config = config;
    this.debug = config.debug ?? false;
    this.client = new HttpClient(rsk, config);
    this.tokenStorage = new TokenStorage(rsk.id);
    this.resolver = new DependencyResolver(this.debug, this.tokenStorage);

    // Initialize OAuth2 handler if needed
    if (config.redirectPort || config.redirectUri) {
      this.oauth2Handler = new OAuth2Handler(
        config.redirectPort,
        config.redirectUri
      );
    }
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
    const visitedUrls = new Set<string>(); // Prevent duplicate requests

    // Execute RSK

    // Load existing auth state (tokens)
    if (!this.config.forceReauth) {
      this.authState = (await this.tokenStorage.load()) || undefined;
    } else {
      await this.tokenStorage.clear();
    }

    // Check if RSK requires OAuth2 (has env node or OAuth2 requests)
    const hasOAuth2 = this.requiresOAuth2();
    if (hasOAuth2) {
      // Initialize OAuth2 handler if not already done
      if (!this.oauth2Handler) {
        this.oauth2Handler = new OAuth2Handler(
          this.config.redirectPort || 3000,
          this.config.redirectUri
        );
      }

      // Process env virtual node first
      await this.processEnvNode(responseData, extractedData, stats, errors);

      // Reload auth state after OAuth2 flow
      this.authState = (await this.tokenStorage.load()) || undefined;
    }

    // Find entry points (requests with no template variables or after env)
    const entryRequests = this.findEntryRequests();

    // Process each entry request with updated auth state
    for (const requestName of entryRequests) {
      const context = this.createInitialContext();
      await this.processRequest(
        requestName,
        context,
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
   * Get all OAuth2 request names
   */
  private getOAuth2RequestNames(): Set<string> {
    const authRequest = this.rsk.config.reqs.find(
      (req) => req.function === 'interactiveOAuth2Authorization'
    );

    const oauth2Requests = new Set<string>();
    if (authRequest) {
      oauth2Requests.add(authRequest.name);

      // Add all requests in the OAuth2 dependency chain
      const authDeps = this.rsk.config.deps.filter((dep) =>
        dep.from.includes(authRequest.name)
      );
      for (const dep of authDeps) {
        dep.to.forEach((req) => oauth2Requests.add(req));
      }
    }

    return oauth2Requests;
  }

  /**
   * Find entry requests - requests with no template variables in their URL or headers
   */
  private findEntryRequests(): string[] {
    const oauth2Requests = this.getOAuth2RequestNames();

    return this.rsk.config.reqs
      .filter((req) => {
        // Must have a URL
        if (!req.url) return false;

        // Check for template variables in URL
        if (req.url.includes('{{')) return false;

        // Check for template variables in headers
        if (req.headers) {
          const hasTemplateInHeaders = Object.values(req.headers).some(
            (value) => typeof value === 'string' && value.includes('{{')
          );
          if (hasTemplateInHeaders) return false;
        }

        return true;
      })
      .filter((req) => req.name !== 'env') // Exclude env virtual node
      .filter((req) => !oauth2Requests.has(req.name)) // Exclude OAuth2 requests
      .map((req) => req.name);
  }

  /**
   * Check if RSK requires OAuth2
   */
  private requiresOAuth2(): boolean {
    return this.rsk.config.reqs.some(
      (req) =>
        req.function === 'interactiveOAuth2Authorization' || req.name === 'env'
    );
  }

  /**
   * Create initial request context with credentials and auth state
   */
  private createInitialContext(): RequestContext {
    const redirectUri =
      this.oauth2Handler?.getRedirectUri() || 'http://localhost:3000/callback';

    return {
      credentials: this.config.credentials,
      authState: this.authState,
      systemVariables: {
        precog_root_uri: redirectUri,
        precog_redirect_uri: redirectUri,
        wsk_to_rsk_redirect_uri: redirectUri,
      },
      extractedData: {},
    };
  }

  /**
   * Process the env virtual node (OAuth2 flow)
   */
  private async processEnvNode(
    responseData: Map<string, PaginatedResponse[]>,
    extractedData: Map<string, ExtractionResult[]>,
    stats: ExecutionStats,
    errors: ExecutionError[]
  ): Promise<void> {
    // Create env context
    const envContext = this.createInitialContext();

    // Generate CSRF state
    const precogState = crypto.randomBytes(32).toString('hex');
    envContext.systemVariables = {
      ...envContext.systemVariables,
      precog_state: precogState,
    };

    // Find OAuth2 authorization request
    const authRequest = this.rsk.config.reqs.find(
      (req) => req.function === 'interactiveOAuth2Authorization'
    );

    if (!authRequest) {
      console.error('No OAuth2 authorization request found');
      return;
    }

    // Find dependencies FROM the authorization request (not from 'env')
    const authDeps = this.rsk.config.deps.filter((dep) =>
      dep.from.includes(authRequest.name)
    );

    if (authRequest && authRequest.args?.authorizeUrl) {
      try {
        // Interpolate authorize URL with credentials
        const authorizeUrl = interpolateString(
          authRequest.args.authorizeUrl,
          envContext
        );

        // Open browser and wait for callback (pass the state we generated)
        await openBrowser(authorizeUrl);

        const result = await this.oauth2Handler!.authorize(
          authorizeUrl,
          precogState
        );
        stats.successfulRequests++;

        // Store authorization response
        // IMPORTANT: Store with key "env" because RSK dependencies reference "from: [env]"
        // even though the actual request is named wsk_to_rsk_install_oauth2
        // Also store with the actual request name for auth dependencies
        responseData.set('env', [result.body as PaginatedResponse]);
        responseData.set(authRequest.name, [result.body as PaginatedResponse]);
        extractedData.set(authRequest.name, [
          {
            requestName: authRequest.name,
            data: result.body as PaginatedResponse,
            url: authorizeUrl,
            timestamp: Date.now(),
          },
        ]);

        // Extract auth code and process token exchange dependencies
        for (const dep of authDeps) {
          const newContexts = await this.resolver.applyDependency(
            dep,
            responseData,
            envContext,
            false
          );

          // Process token exchange requests
          for (const newContext of newContexts) {
            for (const toRequest of dep.to) {
              await this.processRequest(
                toRequest,
                newContext,
                responseData,
                extractedData,
                stats,
                errors,
                new Set()
              );

              // After token exchange, process dependencies to extract auth tokens
              const oauth2Names = this.getOAuth2RequestNames();
              const tokenDeps = this.rsk.config.deps.filter(
                (d: DependencyDef) =>
                  d.from.includes(toRequest) &&
                  !d.to.some((t: string) => oauth2Names.has(t))
              );

              for (const tokenDep of tokenDeps) {
                await this.resolver.applyDependency(
                  tokenDep,
                  responseData,
                  newContext,
                  false
                );

                // Don't execute the target requests here - just extract the tokens
                // The tokens will be stored via authy and available later
              }
            }
          }
        }

        // Reload auth state after token exchange
        this.authState = (await this.tokenStorage.load()) || undefined;
      } catch (error) {
        stats.failedRequests++;
        const err = error as Error;
        console.error(`OAuth2 authorization failed: ${err.message}`);
        errors.push({
          requestName: authRequest.name,
          url: authRequest.args.authorizeUrl,
          error: err.message,
          timestamp: Date.now(),
        });
        throw error; // Stop execution if OAuth fails
      }
    }
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
    const requestDef = this.rsk.config.reqs.find((r) => r.name === requestName);
    if (!requestDef) {
      if (this.debug) {
        console.log(`[SKIP] Request not found: ${requestName}`);
      }
      return;
    }

    // Skip OAuth2 function requests (handled by processEnvNode)
    if (requestDef.function === 'interactiveOAuth2Authorization') {
      return;
    }

    // Build the URL
    const url = requestDef.url
      ? this.resolver.interpolateUrl(requestDef.url, context)
      : '';

    // Check if URL still has unresolved variables (missing context)
    if (requestDef.url && this.resolver.hasUnresolvedVariables(url, context)) {
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
      const data = await this.client.get(url, requestName, context);
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
    // Filter out delta dependencies since we're always doing initial loads
    const dependencies = this.rsk.config.deps.filter(
      (dep) => dep.from.includes(requestName) && dep.loadtype !== 'delta'
    );

    for (const dep of dependencies) {
      // Check if this is a pagination dependency (self-referential _paged)
      const isPaginationDep = this.isPaginationDependency(dep);

      // Skip pagination when next is null/undefined
      if (isPaginationDep && (data.next === null || data.next === undefined)) {
        if (this.debug) {
          console.log(
            `[PAGINATION] Stopping ${dep.to.join(', ')} - no more pages`
          );
        }
        continue;
      }

      // Apply dependency to get new contexts
      const newContexts = await this.resolver.applyDependency(
        dep,
        responseData,
        context,
        isPaginationDep // Use latest only for pagination
      );

      // Reload auth state after dependency processing (in case authy values were saved)
      this.authState = (await this.tokenStorage.load()) || undefined;

      // Update all contexts with the fresh authState
      for (const ctx of newContexts) {
        ctx.authState = this.authState;
      }

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
    return dep.to.some(
      (toReq) => toReq.includes('_paged') && dep.from.includes(toReq)
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
