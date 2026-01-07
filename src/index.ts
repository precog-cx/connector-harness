/**
 * Connector Harness
 *
 * A generic runtime for executing Rootstock (RSK) YAML configurations
 * to extract data from APIs.
 */

// RSK Validation (validates YAML against the Rootstock API)
export { loadRootstockConfig } from './runtime/rootstock-loader.js';
export { validateRootstockConfig } from './runtime/validator.js';
export type { RootstockConfig } from './runtime/rootstock-types.js';

// RSK Runtime (executes RSK files to extract data)
export * from './runtime/index.js';
