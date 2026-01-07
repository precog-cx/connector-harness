import type {
  RootstockApiResponse,
  RootstockConfig,
  ValidationResult,
} from './types';

const ROOTSTOCK_API_URL = 'https://rsk.precog.com/greenhouse/api/v1/validate';

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

    const body = JSON.stringify(config);

    console.log(`Sending ${body.length} bytes to API...`);

    const response = await fetch(ROOTSTOCK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: '*/*',
        'Cache-Control': 'no-cache',
      },
      body,
    });

    console.log(`Response status: ${response.status} ${response.statusText}`);

    const responseText = await response.text();
    console.log(`Response length: ${responseText.length} bytes`);

    if (!response.ok) {
      throw new Error(
        `API returned ${response.status}: ${responseText || response.statusText}`
      );
    }

    // 204 No Content means validation passed with no issues
    if (
      response.status === 204 ||
      !responseText ||
      responseText.trim() === ''
    ) {
      return {
        valid: true,
      };
    }

    let result: RootstockApiResponse;
    try {
      result = JSON.parse(responseText) as RootstockApiResponse;
    } catch (parseError) {
      throw new Error(
        `Failed to parse API response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}\nResponse: ${responseText.substring(0, 200)}`
      );
    }

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
