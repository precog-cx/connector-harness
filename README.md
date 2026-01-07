# connector-harness

Generic runtime for executing Rootstock (RSK) YAML configurations to extract data from APIs.

## Overview

This tool provides a generic RSK runtime that can execute any RSK file to extract data from APIs. It supports various features including OAuth2 authentication, dependency resolution, pagination, transformers, and expression evaluation.

### What's Built ✅

- **Generic RSK Execution**: Load and execute any RSK YAML file
- **OAuth2 Support**: Full browser-based OAuth2 authorization flow
  - Authorization code flow with CSRF protection
  - Token storage and automatic refresh
  - Support for client credentials and authorization code grants
- **Entry Request Detection**: Automatically identifies starting points for execution
  - URL variable interpolation detection
  - Header variable interpolation detection
- **Expression Evaluation**: Complex expression parser with support for:
  - Boolean expressions with AND/OR/parentheses
  - Variable interpolation (`{{variable}}`)
  - Comparison operators (`>=`, `<=`, `>`, `<`, `==`, `!=`)
  - Aggregation functions (`count()`)
- **Dependency Resolution**: Automatic dependency processing with:
  - Delta loadtype filtering (skips delta dependencies on initial loads)
  - Nested select extraction (processes nested selects before parent expressions)
  - JSONPath extraction from response bodies
  - Aggregation support for complex transformations
  - SelectWhere conditional filtering
- **Transformer Pipeline**: Response transformation with:
  - JSONPath selection
  - Variable interpolation in headers
  - Type conversion (string, number, boolean)
- **HTTP Client**: Robust HTTP handling with:
  - Retry logic for transient failures
  - Configurable timeouts
  - Bearer token authentication
- **Pagination**: Automatic pagination support for various patterns
- **Clean Output**: Production-quality console output with minimal verbosity

### What's Not Built Yet ⚠️

- **Webhooks**: No webhook support
- **Incremental Loads**: Delta/incremental loading not fully implemented
- **Advanced Transformers**: Some complex transformation types may not be supported
- **Error Recovery**: Limited error recovery strategies
- **Rate Limiting**: No built-in rate limiting (relies on API responses)
- **Parallel Requests**: Sequential execution only (no concurrent request batching)

## Installation

```bash
pnpm install
```

## Quick Start

### Basic Usage

```bash
# Extract data from an RSK file
pnpm extract <path-to-rsk-file> <output-directory>

# Example: Extract Xero data
pnpm extract ../web-source-kinds/modules/core/src/main/resources/rootstock-kinds/xero-2.0.0.yml ./output
```

### OAuth2 Sources

For sources requiring OAuth2 (like Xero):

1. Set up environment variables in `.env.local`:

```bash
# OAuth2 credentials (from your app registration)
XERO_CLIENT_ID=your_client_id
XERO_CLIENT_SECRET=your_client_secret
XERO_REDIRECT_URI=http://localhost:3000/callback
```

2. Run the extraction (browser will open for authorization):

```bash
pnpm extract xero-2.0.0.yml ./output
```

3. For subsequent runs, use existing tokens:

```bash
# Uses stored tokens from .credentials/
pnpm extract xero-2.0.0.yml ./output
```

4. Force re-authorization:

```bash
pnpm extract xero-2.0.0.yml ./output --fresh
```

### API Key Sources

For sources using API keys (like PostHog):

```bash
# Set environment variables
export POSTHOG_API_KEY="phx_your_api_key_here"

# Extract data
pnpm extract posthog-1.0.0.yml ./output
```

## Development

```bash
# Build TypeScript
pnpm build

# Run tests
pnpm test

# Type check
pnpm type-check

# Lint
pnpm lint

# Format code
pnpm format
```

## Command Line Options

```bash
pnpm extract <rsk-file> <output-dir> [options]

Options:
  --fresh              Force OAuth2 re-authorization (ignore stored tokens)
  --redirect-port      Port for OAuth2 callback server (default: 3000)
  --redirect-uri       Custom redirect URI for OAuth2 flow
```

## How It Works

### Execution Flow

1. **Load RSK**: Parse YAML configuration
2. **Check OAuth2**: If required, initiate OAuth2 flow
3. **Find Entry Points**: Identify requests with no unresolved variables
4. **Execute Requests**: Make HTTP requests with proper authentication
5. **Process Dependencies**: Extract values and create new request contexts
6. **Handle Pagination**: Follow pagination patterns automatically
7. **Save Datasets**: Write extracted data to JSON files

### OAuth2 Flow

```
1. User runs extraction
2. Browser opens with authorization URL
3. User grants access
4. Callback received with authorization code
5. Exchange code for access token
6. Store tokens in .credentials/
7. Use access token for API requests
8. Auto-refresh when token expires
```

### Dependency Resolution

RSK files define dependencies between requests:

```yaml
deps:
  - from: [request_a]
    to: [request_b]
    select:
      - name: tenant_id
        path: $.data[*].id
```

The runtime:

- Executes `request_a` first
- Extracts values using JSONPath
- Creates new contexts for `request_b` with extracted values
- Executes `request_b` for each context

## Output

Extracted data is saved as JSON files:

```
output/
  dataset1.json
  dataset2.json
  ...
```

Each file contains an array of records extracted from the API.

## Tested RSK Files

Successfully tested with:

- ✅ **Xero** (xero-2.0.0.yml) - OAuth2 source with 7 datasets
- ✅ **PostHog** (posthog-1.0.0.yml) - API key authentication
- ✅ **Linear** (linear-1.0.0.yml) - API key authentication
- ✅ **PokeAPI** (custom test) - No authentication

## Project Structure

```
src/
  runtime/
    cli.ts                    # Command-line interface
    executor.ts               # Main RSK execution engine
    dependency-resolver.ts    # Dependency processing
    expression-evaluator.ts   # Expression parser and evaluator
    http-client.ts            # HTTP client with retry logic
    oauth2-handler.ts         # OAuth2 authorization flow
    token-storage.ts          # Token persistence
    transformer-pipeline.ts   # Response transformation
    loader.ts                 # RSK YAML loading
    logger.ts                 # Logging utilities
    types.ts                  # TypeScript types
```

## Environment Variables

### OAuth2 Sources

Each OAuth2 source requires specific credentials:

```bash
# Xero
XERO_CLIENT_ID=your_client_id
XERO_CLIENT_SECRET=your_client_secret
XERO_REDIRECT_URI=http://localhost:3000/callback

# Add other OAuth2 sources as needed
```

### API Key Sources

```bash
# PostHog
POSTHOG_API_KEY=phx_your_api_key

# Linear
LINEAR_API_KEY=lin_api_your_key
```

## Token Storage

OAuth2 tokens are stored in `.credentials/`:

```
.credentials/
  SourceName@version.json
```

Token files contain:

- Access token
- Refresh token
- Expiration time
- Token type

Tokens are automatically refreshed when expired.

## Known Limitations

### Pagination Sentinel Errors

Some pagination patterns use sentinel values (counters) that may not be calculable from certain response formats. This results in expected errors like:

```
Error in contacts: Expression evaluation failed: Variable not found: contacts_sentinel
```

These are **graceful failures** - pagination stops when the sentinel can't be calculated, but data up to that point is still extracted successfully.

### Delta Dependencies

Dependencies with `loadtype: delta` are automatically filtered during initial loads to avoid spurious errors.

## Requirements

- Node.js >= 20.0.0
- pnpm >= 10.0.0
- Works with RSK YAML files from web-source-kinds repository

## Contributing

This is a test harness for validating RSK files. When adding support for new features:

1. Ensure backward compatibility with existing RSK files
2. Add tests for new functionality
3. Update this README with new capabilities
4. Format code with `pnpm format` before committing
