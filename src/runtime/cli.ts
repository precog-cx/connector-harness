#!/usr/bin/env node
/**
 * RSK Runner CLI
 * 
 * Execute any Rootstock YAML file to extract data.
 * 
 * Usage:
 *   pnpm run extract <rsk-file> <output-dir>
 * 
 * Credentials should be provided via environment variables
 * matching the configSchema field names (spaces replaced with underscores).
 * 
 * Example:
 *   API_KEY=xxx pnpm run extract posthog-1.0.0.yml ./output
 */

import { config as loadEnv } from 'dotenv';
import { loadRskConfig, validateCredentials } from './loader.js';
import { RskExecutor } from './executor.js';
import type { RuntimeConfig } from './types.js';

// Load .env.local for credentials
loadEnv({ path: '.env.local' });

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: pnpm run extract <rsk-file> <output-dir>');
    console.log('');
    console.log('Credentials should be provided via environment variables.');
    console.log('Field names from configSchema are converted: "API Key" -> "API_KEY"');
    process.exit(1);
  }

  const rskFile = args[0]!;
  const outputDir = args[1]!;
  const debug = args.includes('--debug');

  try {
    // Load RSK configuration
    console.log(`Loading RSK: ${rskFile}`);
    const rsk = loadRskConfig(rskFile);
    console.log(`Loaded: ${rsk.id}`);

    // Gather credentials from environment variables
    const credentials: Record<string, string> = {};
    for (const fieldName of Object.keys(rsk.configSchema)) {
      // Convert "API Key" -> "API_KEY"
      const envName = fieldName.toUpperCase().replace(/\s+/g, '_');
      const value = process.env[envName];
      if (value) {
        credentials[fieldName] = value;
      }
    }

    // Validate credentials
    const validation = validateCredentials(rsk, credentials);
    if (!validation.valid) {
      console.error('Missing required credentials:');
      for (const missing of validation.missing) {
        const envName = missing.toUpperCase().replace(/\s+/g, '_');
        console.error(`  - ${missing} (set ${envName} environment variable)`);
      }
      process.exit(1);
    }

    // Create runtime config
    const config: RuntimeConfig = {
      credentials,
      outputDir,
      debug,
    };

    // Execute
    const executor = new RskExecutor(rsk, config);
    await executor.execute();

  } catch (error) {
    console.error('Execution failed:', (error as Error).message);
    if (debug) {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
