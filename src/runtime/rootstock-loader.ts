import { readFile } from 'fs/promises';
import { parse } from 'yaml';

import type { RootstockConfig } from './rootstock-types.js';

/**
 * Load and parse a Rootstock YAML configuration file
 */
export async function loadRootstockConfig(
  filePath: string
): Promise<RootstockConfig> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const config = parse(content) as RootstockConfig;

    if (!config || typeof config !== 'object') {
      throw new Error('Invalid YAML: expected object');
    }

    return config;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load rootstock config: ${error.message}`);
    }
    throw error;
  }
}
