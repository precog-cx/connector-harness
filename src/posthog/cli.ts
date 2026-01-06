#!/usr/bin/env node

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { loadRootstockConfig } from '../loader';
import { PostHogExtractor } from './extractor';
import type {
  PostHogConfig,
  RequestDef,
  DependencyDef,
  DatasetDef,
} from './types';

config({ path: '.env.local' });

interface RootstockConfig {
  configSchema: Record<string, { fieldDescription: string; sensitive: boolean }>;
  config: {
    reqs: Array<{ name: string; url: string; transformers: string[] }>;
    deps: Array<{
      from: string[];
      to: string[];
      select: Array<{
        name: string;
        path: string;
        type: 'string' | 'number';
      }>;
    }>;
    datasets: Array<{
      name: string;
      data: string[];
    }>;
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: extract-posthog <yaml-file> <output-dir>');
    console.error('');
    console.error('Environment variables:');
    console.error('  POSTHOG_NAME - Name for this source');
    console.error('  POSTHOG_API_KEY - PostHog Personal API Key');
    console.error('');
    console.error('Example:');
    console.error('  POSTHOG_NAME="My PostHog" POSTHOG_API_KEY="phx_..." \\');
    console.error('    extract-posthog posthog-1.0.0.yml ./output');
    process.exit(1);
  }

  const [yamlFile, outputDir] = args;

  if (!yamlFile || !outputDir) {
    console.error('Error: Both yaml-file and output-dir are required');
    process.exit(1);
  }

  if (!existsSync(yamlFile)) {
    console.error(`Error: File '${yamlFile}' not found`);
    process.exit(1);
  }

  const name = process.env.POSTHOG_NAME || process.env.Name || 'PostHog Source';
  const apiKey = process.env.POSTHOG_API_KEY || process.env['API Key'];

  if (!apiKey) {
    console.error('Error: POSTHOG_API_KEY or API Key environment variable is required');
    process.exit(1);
  }

  try {
    console.log('Loading PostHog connector configuration...');
    const rootstockConfig = await loadRootstockConfig(yamlFile) as unknown as RootstockConfig;

    const postHogConfig: PostHogConfig = {
      name,
      apiKey,
    };

    const requests: RequestDef[] = rootstockConfig.config.reqs.map(req => ({
      name: req.name,
      url: req.url,
      transformers: req.transformers,
    }));

    const dependencies: DependencyDef[] = rootstockConfig.config.deps.map(dep => ({
      from: dep.from,
      to: dep.to,
      select: dep.select,
    }));

    const datasets: DatasetDef[] = rootstockConfig.config.datasets.map(ds => ({
      name: ds.name,
      data: ds.data,
    }));

    console.log(`Initializing extractor with ${requests.length} requests, ${dependencies.length} dependencies, ${datasets.length} datasets...`);
    
    const extractor = new PostHogExtractor(
      postHogConfig,
      requests,
      dependencies,
      datasets
    );

    console.log('Starting data extraction...');
    console.log('');

    const result = await extractor.extract({
      outputDir,
      verbose: true,
    });

    console.log('');
    console.log('=== Extraction Complete ===');
    console.log(`Success: ${result.success ? '✓' : '✗'}`);
    console.log(`Total Requests: ${result.stats.totalRequests}`);
    console.log(`Successful: ${result.stats.successfulRequests}`);
    console.log(`Failed: ${result.stats.failedRequests}`);
    console.log(`Duration: ${(result.stats.duration / 1000).toFixed(2)}s`);
    console.log(`Datasets: ${result.datasets.size}`);

    if (result.errors.length > 0) {
      console.log('');
      console.log('Errors:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.message}`);
      });
    }

    if (result.datasets.size > 0) {
      console.log('');
      console.log('Datasets saved to', outputDir);
      for (const [name, data] of result.datasets.entries()) {
        console.log(`  - ${name}: ${data.length} records`);
      }
    }

    process.exit(result.success ? 0 : 1);

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
