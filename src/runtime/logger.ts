/**
 * Simple Logger
 * 
 * Provides structured logging for runtime operations.
 */

export const log = {
  info: (_message: string, _metadata?: any) => {
    // Info logging disabled for cleaner output
  },
  
  warn: (message: string, metadata?: any) => {
    console.warn(`[WARN] ${message}`, metadata || '');
  },
  
  error: (message: string, metadata?: any) => {
    console.error(`[ERROR] ${message}`, metadata || '');
  },
  
  debug: (message: string, metadata?: any) => {
    if (process.env.DEBUG) {
      console.log(`[DEBUG] ${message}`, metadata || '');
    }
  },
};
