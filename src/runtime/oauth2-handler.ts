/**
 * OAuth2 Handler
 *
 * Handles interactive OAuth2 authorization flows for RSKs.
 * Opens browser for user authorization and runs local callback server.
 */
import crypto from 'node:crypto';
import http from 'node:http';

import { log } from './logger.js';
import { RequestResult } from './types.js';

// ============================================================
// OAuth2 Handler
// ============================================================

export class OAuth2Handler {
  private redirectPort: number;
  private redirectUri: string;
  private activeSockets = new Set<any>();

  constructor(redirectPort: number = 3000, redirectUri?: string) {
    this.redirectPort = redirectPort;
    this.redirectUri =
      redirectUri || `http://localhost:${redirectPort}/callback`;
  }

  /**
   * Perform interactive OAuth2 authorization
   *
   * Opens browser to authorize URL, starts local callback server,
   * and returns synthetic response with authorization code.
   */
  async authorize(
    authorizeUrl: string,
    expectedState?: string
  ): Promise<RequestResult> {
    // Use provided state or generate new one
    const state = expectedState || this.generateState();

    // Only add redirect_uri and state if not already in URL
    const url = new URL(authorizeUrl);
    if (!url.searchParams.has('redirect_uri')) {
      url.searchParams.set('redirect_uri', this.redirectUri);
    }
    if (!url.searchParams.has('state')) {
      url.searchParams.set('state', state);
    }

    log.info('Starting OAuth2 authorization flow', {
      authorizeUrl: url.toString(),
      redirectUri: this.redirectUri,
      state,
    });

    // Start callback server and wait for authorization
    const { code, receivedState } = await this.waitForCallback(state);

    // Return synthetic response matching RSK expectations
    return {
      status: 200,
      headers: {},
      body: {
        query: {
          code,
          state: receivedState,
        },
      },
    };
  }

  /**
   * Force close the callback server and destroy all connections
   */
  private forceCloseServer(server: http.Server): void {
    // Destroy all active connections
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();

    // Close the server
    server.close();
  }

  /**
   * Start local HTTP server and wait for OAuth callback
   */
  private async waitForCallback(
    expectedState: string
  ): Promise<{ code: string; receivedState: string }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(
          req.url || '',
          `http://localhost:${this.redirectPort}`
        );

        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        // Extract authorization code and state from query params
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        // Handle authorization errors
        if (error) {
          const message = `Authorization failed: ${error}${errorDescription ? ` - ${errorDescription}` : ''}`;
          log.error('OAuth2 authorization error', { error, errorDescription });

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <h1>Authorization Failed</h1>
                <p>${message}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);

          this.forceCloseServer(server);
          reject(new Error(message));
          return;
        }

        // Validate required parameters
        if (!code) {
          const message = 'Authorization code missing from callback';
          log.error(message);

          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <h1>Invalid Callback</h1>
                <p>${message}</p>
              </body>
            </html>
          `);

          this.forceCloseServer(server);
          reject(new Error(message));
          return;
        }

        // Validate state parameter (CSRF protection)
        if (state !== expectedState) {
          const message = 'State parameter mismatch - possible CSRF attack';
          log.error('OAuth2 state validation failed', {
            expected: expectedState,
            received: state,
          });

          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <h1>Security Error</h1>
                <p>${message}</p>
              </body>
            </html>
          `);

          this.forceCloseServer(server);
          reject(new Error(message));
          return;
        }

        // Success! Return code to user
        log.info('Authorization successful', {
          code: code.substring(0, 20) + '...',
        });

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h1>Authorization Successful!</h1>
              <p>You can close this window and return to the terminal.</p>
              <script>
                // Auto-close after 2 seconds
                setTimeout(() => window.close(), 2000);
              </script>
            </body>
          </html>
        `);

        this.forceCloseServer(server);
        resolve({ code, receivedState: state });
      });

      // Track connections so we can force close them
      server.on('connection', (socket) => {
        this.activeSockets.add(socket);
        socket.on('close', () => {
          this.activeSockets.delete(socket);
        });
      });

      // Start server
      server.listen(this.redirectPort, () => {
        log.info(`OAuth2 callback server listening`, {
          port: this.redirectPort,
          redirectUri: this.redirectUri,
        });

        // Open browser (will need to be called externally with actual authorize URL)
        console.log('\n' + '='.repeat(60));
        console.log('OPEN THIS URL IN YOUR BROWSER TO AUTHORIZE:');
        console.log('='.repeat(60));
        console.log('(Authorization URL will be shown by executor)');
        console.log('='.repeat(60) + '\n');
      });

      // Handle server errors
      server.on('error', (error: any) => {
        log.error('OAuth2 callback server error', { error: error.message });
        reject(error);
      });

      // Timeout after 5 minutes
      setTimeout(
        () => {
          this.forceCloseServer(server);
          reject(
            new Error(
              'Authorization timeout - no callback received within 5 minutes'
            )
          );
        },
        5 * 60 * 1000
      );
    });
  }

  /**
   * Generate random state parameter for CSRF protection
   */
  private generateState(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Get the redirect URI for this handler
   */
  getRedirectUri(): string {
    return this.redirectUri;
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Create an OAuth2 handler with given configuration
 */
export function createOAuth2Handler(
  redirectPort?: number,
  redirectUri?: string
): OAuth2Handler {
  return new OAuth2Handler(redirectPort, redirectUri);
}

/**
 * Open URL in default browser (platform-specific)
 */
export async function openBrowser(url: string): Promise<void> {
  const { default: open } = await import('open');
  await open(url);
  log.info('Opened browser for authorization', { url });
}
