# connector-harness

Test harness for validating rootstock YAML connector configurations from web-source-kinds.

## Overview

This Node.js application provides automated testing and validation for source connectors (rootstock kinds). It loads rootstock YAML configurations, validates their structure, and can execute test scenarios against the connector definitions.

## Installation

```bash
pnpm install

# Set up environment variables
cp .env.sample .env.local
# Edit .env.local and add your ROOTSTOCK_TOKEN
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

### Validate Rootstock YAML

### Command Line

```bash
# Option 1: Use .env.local (recommended)
# Set up .env.local with your ROOTSTOCK_TOKEN
pnpm validate path/to/connector.yaml

# Option 2: Set environment variable directly
export ROOTSTOCK_TOKEN="your-token-here"
pnpm validate path/to/connector.yaml

# Or use the built binary (after build)
pnpm build
./dist/cli.js path/to/connector.yaml
```

### Extract PostHog Data

```bash
# Set your PostHog API credentials
export POSTHOG_NAME="My PostHog Source"
export POSTHOG_API_KEY="phx_your_api_key_here"

# Extract data from PostHog
pnpm extract:posthog path/to/posthog-connector.yml ./output

# Or use the built binary
pnpm build
./dist/posthog/cli.js path/to/posthog-connector.yml ./output
```

The extractor will:
- Automatically handle rate limiting (240/min, 1200/hour)
- Retry failed requests (429, 504 errors)
- Follow pagination links
- Resolve dependencies between requests
- Extract all 50+ datasets defined in the connector
- Save results as JSON files in the output directory

### Programmatic

```typescript
import { loadRootstockConfig, validateRootstockConfig } from 'connector-harness';

// Load a rootstock YAML file
const config = await loadRootstockConfig('./path/to/connector.yaml');

// Validate the configuration with Rootstock API
const result = await validateRootstockConfig(config, 'your-bearer-token');

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
  cli.ts           # Rootstock validation CLI
  loader.ts        # YAML loading and parsing
  validator.ts     # Configuration validation
  types.ts         # TypeScript type definitions
  posthog/         # PostHog connector implementation
    index.ts       # PostHog exports
    cli.ts         # PostHog extraction CLI
    types.ts       # PostHog type definitions
    client.ts      # HTTP client with auth and retries
    rate-limiter.ts  # Rate limiting implementation
    dependency-resolver.ts  # Request dependency resolution
    extractor.ts   # Main extraction service
  __tests__/       # Test files
```

## Features

### Rootstock Validation
- Load and parse rootstock YAML files
- Validate against Rootstock API
- Handle 204 No Content responses
- Detailed error reporting

### PostHog Data Extraction
- **Rate Limiting**: Automatic sliding window rate limiter (240/min, 1200/hour)
- **Retry Logic**: Handles 429 (rate limit) and 504 (gateway timeout) with exponential backoff
- **Dependency Resolution**: Automatically resolves request dependencies and variable interpolation
- **Pagination**: Follows pagination links automatically
- **50+ Datasets**: Extracts all datasets defined in the connector specification
- **Parallel Extraction**: Efficient data extraction with proper dependency ordering
- **JSON Output**: Saves extracted data as structured JSON files

## Environment Variables

- `ROOTSTOCK_TOKEN` or `RSK_TOKEN` - Bearer token for Rootstock API authentication

## Requirements

- Node.js >= 20.0.0
- Works with rootstock YAML files from web-source-kinds repository
