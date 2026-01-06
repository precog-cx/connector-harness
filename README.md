# connector-harness

Test harness for validating rootstock YAML connector configurations from web-source-kinds.

## Overview

This Node.js application provides automated testing and validation for source connectors (rootstock kinds). It loads rootstock YAML configurations, validates their structure, and can execute test scenarios against the connector definitions.

## Installation

```bash
pnpm install
```

## Development

```bash
# Run in watch mode
pnpm dev

# Run tests
pnpm test

# Build
pnpm build

# Type check
pnpm type-check
```

## Usage

```typescript
import { loadRootstockConfig, validateRootstockConfig } from 'connector-harness';

// Load a rootstock YAML file
const config = await loadRootstockConfig('./path/to/connector.yaml');

// Validate the configuration
const result = validateRootstockConfig(config);

if (result.valid) {
  console.log('✓ Configuration is valid');
} else {
  console.error('✗ Validation errors:', result.errors);
}
```

## Project Structure

```
src/
  index.ts         # Main exports
  loader.ts        # YAML loading and parsing
  validator.ts     # Configuration validation
  types.ts         # TypeScript type definitions
  __tests__/       # Test files
```

## Requirements

- Node.js >= 20.0.0
- Works with rootstock YAML files from web-source-kinds repository
