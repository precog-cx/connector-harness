/**
 * RSK Loader
 * 
 * Loads and parses a Rootstock YAML file into typed configuration.
 */

import { parse } from 'yaml';
import { readFileSync } from 'fs';
import type { RskConfig } from './types.js';

export function loadRskConfig(filePath: string): RskConfig {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = parse(content) as RskConfig;
  
  // Basic validation
  if (!parsed.id) {
    throw new Error('RSK file missing required "id" field');
  }
  if (!parsed.config?.reqs) {
    throw new Error('RSK file missing required "config.reqs" field');
  }
  // deps is optional - simple RSKs may not have dependencies
  if (!parsed.config.deps) {
    parsed.config.deps = [];
  }
  if (!parsed.config?.datasets) {
    throw new Error('RSK file missing required "config.datasets" field');
  }
  
  return parsed;
}

/**
 * Get the list of required credentials from the RSK configSchema
 */
export function getRequiredCredentials(rsk: RskConfig): string[] {
  return Object.entries(rsk.configSchema)
    .filter(([_, field]) => field.sensitive)
    .map(([name]) => name);
}

/**
 * Validate that all required credentials are provided
 */
export function validateCredentials(
  rsk: RskConfig,
  credentials: Record<string, string>
): { valid: boolean; missing: string[] } {
  const required = getRequiredCredentials(rsk);
  const missing = required.filter(name => !credentials[name]);
  return {
    valid: missing.length === 0,
    missing
  };
}
