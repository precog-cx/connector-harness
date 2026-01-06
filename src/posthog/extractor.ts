import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { PostHogClient } from './client';
import { DependencyResolver } from './dependency-resolver';
import type {
  PostHogConfig,
  RequestDef,
  DependencyDef,
  DatasetDef,
  ExtractionOptions,
  ExtractionResult,
  ExtractedData,
  RequestContext,
  PaginatedResponse,
} from './types';

/**
 * PostHog data extraction service
 * Implements the full extraction logic from the PostHog connector spec
 */
export class PostHogExtractor {
  private client: PostHogClient;
  private resolver: DependencyResolver;
  private requests: Map<string, RequestDef>;
  private dependencies: DependencyDef[];
  private datasets: DatasetDef[];
  
  constructor(
    config: PostHogConfig,
    requests: RequestDef[],
    dependencies: DependencyDef[],
    datasets: DatasetDef[]
  ) {
    this.client = new PostHogClient(config);
    this.resolver = new DependencyResolver();
    this.requests = new Map(requests.map(r => [r.name, r]));
    this.dependencies = dependencies;
    this.datasets = datasets;
  }

  /**
   * Extract all data from PostHog API
   */
  async extract(options: ExtractionOptions = {}): Promise<ExtractionResult> {
    const startTime = Date.now();
    const stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retries: 0,
      duration: 0,
    };
    
    const errors: Error[] = [];
    const extractedData: Map<string, ExtractedData[]> = new Map();
    const responseData: Map<string, PaginatedResponse[]> = new Map();

    try {
      // Start with entry point requests (no dependencies)
      const entryRequests = this.findEntryRequests();
      
      if (options.verbose) {
        console.log(`Starting extraction with ${entryRequests.length} entry requests...`);
      }

      // Process requests in dependency order
      await this.processRequestChain(
        entryRequests,
        {},
        responseData,
        extractedData,
        stats,
        errors,
        options
      );

      // Organize data by datasets
      const datasetMap = this.organizeByDatasets(extractedData);

      // Save to disk if output directory specified
      if (options.outputDir) {
        await this.saveDatasets(datasetMap, options.outputDir);
      }

      stats.duration = Date.now() - startTime;

      return {
        success: errors.length === 0,
        datasets: datasetMap,
        errors,
        stats,
      };

    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
      stats.duration = Date.now() - startTime;
      
      return {
        success: false,
        datasets: new Map(),
        errors,
        stats,
      };
    }
  }

  /**
   * Process request chain recursively
   */
  private async processRequestChain(
    requestNames: string[],
    context: RequestContext,
    responseData: Map<string, PaginatedResponse[]>,
    extractedData: Map<string, ExtractedData[]>,
    stats: ExtractionResult['stats'],
    errors: Error[],
    options: ExtractionOptions
  ): Promise<void> {
    for (const requestName of requestNames) {
      const requestDef = this.requests.get(requestName);
      if (!requestDef) {
        errors.push(new Error(`Request definition not found: ${requestName}`));
        continue;
      }

      // Check if URL can be resolved with current context
      const url = this.resolver.interpolateUrl(requestDef.url, context);
      if (this.resolver.hasUnresolvedVariables(url)) {
        if (options.verbose) {
          console.log(`Skipping ${requestName}: unresolved variables in ${url}`);
        }
        continue;
      }

      // Execute request
      try {
        stats.totalRequests++;
        
        if (options.verbose) {
          console.log(`Fetching ${requestName}: ${url}`);
        }

        const data = await this.client.get<PaginatedResponse>(url);
        
        stats.successfulRequests++;

        // Store response data
        if (!responseData.has(requestName)) {
          responseData.set(requestName, []);
        }
        responseData.get(requestName)!.push(data);

        // Store extracted data
        if (!extractedData.has(requestName)) {
          extractedData.set(requestName, []);
        }
        extractedData.get(requestName)!.push({
          requestName,
          data,
          timestamp: Date.now(),
        });

        // Process pagination if exists
        if (data.next && typeof data.next === 'string') {
          const pagedRequestName = `${requestName}_paged`;
          await this.processRequestChain(
            [pagedRequestName],
            { ...context, [`${requestName}_page_token`]: data.next },
            responseData,
            extractedData,
            stats,
            errors,
            options
          );
        }

        // Find and process dependent requests
        const dependentRequests = this.findDependentRequests(requestName);
        
        for (const dep of dependentRequests) {
          const newContexts = this.resolver.applyDependency(
            dep,
            responseData,
            context
          );

          if (options.verbose && newContexts.length > 0) {
            console.log(`  -> Created ${newContexts.length} contexts for ${dep.to.join(', ')}`);
          }

          // Process each dependent request with its context
          for (const newContext of newContexts) {
            await this.processRequestChain(
              dep.to,
              newContext,
              responseData,
              extractedData,
              stats,
              errors,
              options
            );
          }
        }

      } catch (error) {
        stats.failedRequests++;
        errors.push(
          error instanceof Error 
            ? new Error(`${requestName}: ${error.message}`)
            : new Error(`${requestName}: ${String(error)}`)
        );
        
        if (options.verbose) {
          console.error(`Error in ${requestName}:`, error);
        }
      }
    }
  }

  /**
   * Find entry requests (no dependencies)
   */
  private findEntryRequests(): string[] {
    const allFromRequests = new Set(
      this.dependencies.flatMap(d => d.from)
    );
    
    const entryRequests: string[] = [];
    for (const requestName of this.requests.keys()) {
      if (!requestName.endsWith('_paged') && !allFromRequests.has(requestName)) {
        // Check if any dependency targets this request
        const isDependentOn = this.dependencies.some(d => d.to.includes(requestName));
        if (!isDependentOn) {
          entryRequests.push(requestName);
        }
      }
    }
    
    return entryRequests;
  }

  /**
   * Find requests that depend on the given request
   */
  private findDependentRequests(requestName: string): DependencyDef[] {
    return this.dependencies.filter(dep => dep.from.includes(requestName));
  }

  /**
   * Organize extracted data by datasets
   */
  private organizeByDatasets(
    extractedData: Map<string, ExtractedData[]>
  ): Map<string, ExtractedData[]> {
    const datasetMap = new Map<string, ExtractedData[]>();
    
    for (const dataset of this.datasets) {
      const datasetData: ExtractedData[] = [];
      
      for (const requestName of dataset.data) {
        const data = extractedData.get(requestName);
        if (data) {
          datasetData.push(...data);
        }
      }
      
      if (datasetData.length > 0) {
        datasetMap.set(dataset.name, datasetData);
      }
    }
    
    return datasetMap;
  }

  /**
   * Save datasets to disk
   */
  private async saveDatasets(
    datasets: Map<string, ExtractedData[]>,
    outputDir: string
  ): Promise<void> {
    await mkdir(outputDir, { recursive: true });
    
    for (const [datasetName, data] of datasets.entries()) {
      const filename = `${datasetName.replace(/\s+/g, '_').toLowerCase()}.json`;
      const filepath = join(outputDir, filename);
      
      await writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`Saved ${data.length} records to ${filepath}`);
    }
  }
}
