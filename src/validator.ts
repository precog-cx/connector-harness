import type {
  RootstockConfig,
  ValidationResult,
  RootstockApiResponse,
} from './types';

const ROOTSTOCK_API_URL =
  'https://rsk.precog.com/greenhouse/api/v1/validate';

/**
 * Validate a Rootstock configuration against the API
 */
export async function validateRootstockConfig(
  config: RootstockConfig,
  bearerToken?: string
): Promise<ValidationResult> {
  try {
    const token =
      bearerToken || process.env.ROOTSTOCK_TOKEN || process.env.RSK_TOKEN;

    if (!token) {
      throw new Error(
        'Bearer token required. Set ROOTSTOCK_TOKEN or RSK_TOKEN environment variable, or pass as parameter.'
      );
    }

    const response = await fetch(ROOTSTOCK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: '*/*',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `API returned ${response.status}: ${text || response.statusText}`
      );
    }

    const result = (await response.json()) as RootstockApiResponse;

    return {
      valid: result.valid,
      errors: result.errors?.map((e) =>
        e.path ? `${e.path}: ${e.message}` : e.message
      ),
      warnings: result.warnings?.map((w) =>
        w.path ? `${w.path}: ${w.message}` : w.message
      ),
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        valid: false,
        errors: [error.message],
      };
    }
    return {
      valid: false,
      errors: ['Unknown validation error'],
    };
  }
}

/**
 * Local validation without API call (structural checks only)
 */
export function validateRootstockStructure(
  config: RootstockConfig
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Basic structural validation
  if (!config || typeof config !== 'object') {
    errors.push('Configuration must be an object');
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
