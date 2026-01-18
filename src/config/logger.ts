import { LogLevel } from '@nestjs/common';

/**
 * Logger configuration per environment.
 * Controls which log levels are enabled for each environment.
 *
 * Log levels (in order of verbosity):
 * - error: Only critical errors
 * - warn: Warnings and errors
 * - log: General information, warnings, and errors
 * - debug: Debugging information + all above
 * - verbose: Everything including detailed traces
 */
export const loggerConfigByEnv: Record<string, LogLevel[]> = {
  /**
   * Development: Detailed logging for debugging
   * Everything except verbose traces
   */
  development: ['error', 'warn', 'log', 'debug'],

  /**
   * Production: Minimal logging for performance
   * Only errors and warnings
   */
  production: ['error', 'warn'],

  /**
   * Test: Quiet logging to avoid cluttering test output
   * Only errors
   */
  test: ['error'],
};

/**
 * Default log levels if environment not specified.
 */
export const defaultLogLevels: LogLevel[] = ['error', 'warn', 'log'];

/**
 * Get logger configuration based on current environment.
 * Can be overridden by LOG_LEVEL environment variable.
 *
 * @returns {LogLevel[]} Array of enabled log levels
 *
 * @example
 * // Get config for current environment
 * const logLevels = getLogLevels();
 *
 * @example
 * // Override with specific log level
 * const logLevels = getLogLevels();
 */
export const getLogLevels = (): LogLevel[] => {
  // Get environment-specific config
  const env = process.env.NODE_ENV ?? 'development';
  return loggerConfigByEnv[env] || defaultLogLevels;
};
