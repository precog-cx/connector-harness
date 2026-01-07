/**
 * Type definitions for Rootstock configurations
 */

export interface RootstockConfig {
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

export interface RootstockApiResponse {
  valid: boolean;
  errors?: Array<{
    message: string;
    path?: string;
  }>;
  warnings?: Array<{
    message: string;
    path?: string;
  }>;
}
