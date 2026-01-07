/**
 * Token Storage
 * 
 * Securely stores OAuth2 tokens and authy values in .credentials/ directory.
 * Each RSK gets its own JSON file for persistent token storage across runs.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { AuthState } from './types.js';

// ============================================================
// Token Storage Service
// ============================================================

export class TokenStorage {
  private credentialsDir: string;
  private filePath: string;

  constructor(rskId: string, credentialsDir: string = '.credentials') {
    this.credentialsDir = credentialsDir;
    this.filePath = path.join(credentialsDir, `${rskId}.json`);
  }

  /**
   * Load authentication state from disk
   */
  async load(): Promise<AuthState | null> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(data) as AuthState;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null; // File doesn't exist yet
      }
      throw new Error(`Failed to load tokens: ${error.message}`);
    }
  }

  /**
   * Save authentication state to disk
   */
  async save(authState: AuthState): Promise<void> {
    try {
      // Ensure credentials directory exists
      await fs.mkdir(this.credentialsDir, { recursive: true });

      // Write with pretty formatting for debugging
      const data = JSON.stringify(authState, null, 2);
      await fs.writeFile(this.filePath, data, 'utf-8');
    } catch (error: any) {
      throw new Error(`Failed to save tokens: ${error.message}`);
    }
  }

  /**
   * Clear all stored tokens for this RSK
   */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return; // Already cleared
      }
      throw new Error(`Failed to clear tokens: ${error.message}`);
    }
  }

  /**
   * Save a value marked with authy: true
   */
  async saveAuthyValue(key: string, value: any): Promise<void> {
    const authState = (await this.load()) || { authyValues: {} };
    authState.authyValues = authState.authyValues || {};
    authState.authyValues[key] = value;
    await this.save(authState);
  }

  /**
   * Get a value marked with authy: true
   */
  async getAuthyValue(key: string): Promise<any> {
    const authState = await this.load();
    return authState?.authyValues?.[key];
  }

  /**
   * Update access token and expiration
   */
  async updateAccessToken(
    accessToken: string,
    expiresIn?: number
  ): Promise<void> {
    const authState = (await this.load()) || {};
    authState.accessToken = accessToken;
    
    if (expiresIn !== undefined) {
      // Calculate expiration timestamp (subtract 60s buffer)
      authState.expiresAt = Date.now() + (expiresIn - 60) * 1000;
    }
    
    await this.save(authState);
  }

  /**
   * Update refresh token
   */
  async updateRefreshToken(refreshToken: string): Promise<void> {
    const authState = (await this.load()) || {};
    authState.refreshToken = refreshToken;
    await this.save(authState);
  }

  /**
   * Check if access token is expired or missing
   */
  async isTokenExpired(): Promise<boolean> {
    const authState = await this.load();
    
    if (!authState?.accessToken) {
      return true; // No token means expired
    }

    if (authState.expiresAt && Date.now() >= authState.expiresAt) {
      return true; // Token has expired
    }

    return false;
  }

  /**
   * Check if we have a refresh token
   */
  async hasRefreshToken(): Promise<boolean> {
    const authState = await this.load();
    return Boolean(authState?.refreshToken);
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Create a token storage instance for an RSK
 */
export function createTokenStorage(
  rskId: string,
  credentialsDir?: string
): TokenStorage {
  return new TokenStorage(rskId, credentialsDir);
}

/**
 * Clear all stored tokens (useful for testing)
 */
export async function clearAllTokens(
  credentialsDir: string = '.credentials'
): Promise<void> {
  try {
    await fs.rm(credentialsDir, { recursive: true, force: true });
  } catch (error: any) {
    throw new Error(`Failed to clear all tokens: ${error.message}`);
  }
}
