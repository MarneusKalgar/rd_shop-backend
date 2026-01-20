import { LogLevel } from '@nestjs/common';

/**
 * Valid log levels supported by NestJS.
 * Ordered from least to most verbose.
 */
const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'] as const;

/**
 * Default log level if APP_LOG_LEVEL is not specified.
 */
const DEFAULT_LOG_LEVEL: LogLevel = 'log';

/**
 * Validates if a string is a valid NestJS log level.
 * @param level - The log level string to validate
 * @returns True if the level is valid, false otherwise
 */
const isValidLogLevel = (level: string): level is LogLevel => {
  return LOG_LEVELS.includes(level as LogLevel);
};

/**
 * Gets all log levels up to and including the specified level.
 * For example, if level is 'log', returns ['error', 'warn', 'log'].
 *
 * @param level - The maximum log level to include
 * @returns Array of log levels from error up to the specified level
 *
 * @example
 * getLevelsUpTo('log') // Returns: ['error', 'warn', 'log']
 * getLevelsUpTo('debug') // Returns: ['error', 'warn', 'log', 'debug']
 */
const getLevelsUpTo = (level: LogLevel): LogLevel[] => {
  const index = LOG_LEVELS.indexOf(level);
  return index === -1 ? [DEFAULT_LOG_LEVEL] : LOG_LEVELS.slice(0, index + 1);
};

/**
 * Resolves the log level from APP_LOG_LEVEL environment variable.
 * Falls back to the default log level if not specified or invalid.
 *
 * @returns {LogLevel[]} Array of enabled log levels
 *
 * @example
 * // With APP_LOG_LEVEL=debug
 * getLogLevels(); // Returns: ['error', 'warn', 'log', 'debug']
 *
 * @example
 * // Without APP_LOG_LEVEL (or invalid value)
 * getLogLevels(); // Returns: ['error', 'warn', 'log']
 */
export const getLogLevels = (): LogLevel[] => {
  const envLogLevel = process.env.APP_LOG_LEVEL?.toLowerCase();

  if (!envLogLevel) {
    return getLevelsUpTo(DEFAULT_LOG_LEVEL);
  }

  if (!isValidLogLevel(envLogLevel)) {
    return getLevelsUpTo(DEFAULT_LOG_LEVEL);
  }

  return getLevelsUpTo(envLogLevel);
};
