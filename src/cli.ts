#!/usr/bin/env node

import { config } from 'dotenv';
import { existsSync } from 'fs';

import { loadRootstockConfig } from './loader';
import { validateRootstockConfig } from './validator';

// Load environment variables from .env.local
config({ path: '.env.local' });

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: validate-rootstock <yaml-file>');
    console.error('');
    console.error('Environment variables:');
    console.error(
      '  ROOTSTOCK_TOKEN or RSK_TOKEN - Bearer token for API authentication'
    );
    process.exit(1);
  }

  const filePath = args[0];

  if (!filePath) {
    console.error('Error: No file specified');
    process.exit(1);
  }

  if (!existsSync(filePath)) {
    console.error(`Error: File '${filePath}' not found`);
    process.exit(1);
  }

  try {
    console.log('Loading YAML file...');
    const config = await loadRootstockConfig(filePath);

    console.log('Validating with Rootstock API...');
    const result = await validateRootstockConfig(config);

    console.log('');
    if (result.valid) {
      console.log('✓ Validation successful');

      if (result.warnings && result.warnings.length > 0) {
        console.log('\nWarnings:');
        result.warnings.forEach((warning) => {
          console.log(`  ⚠ ${warning}`);
        });
      }

      process.exit(0);
    } else {
      console.log('✗ Validation failed');

      if (result.errors && result.errors.length > 0) {
        console.log('\nErrors:');
        result.errors.forEach((error) => {
          console.log(`  ✗ ${error}`);
        });
      }

      if (result.warnings && result.warnings.length > 0) {
        console.log('\nWarnings:');
        result.warnings.forEach((warning) => {
          console.log(`  ⚠ ${warning}`);
        });
      }

      process.exit(1);
    }
  } catch (error) {
    console.error(
      'Error:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

main();
