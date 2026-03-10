import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DEFAULT_VALUES } from './constants';
import { EnvironmentVariables } from './schema';
import { DefaultEnvKey, EnvVariable } from './types';

/**
 * Determines the appropriate environment file path based on NODE_ENV.
 * Dynamically resolves to .env.{NODE_ENV} format.
 * Falls back to .env if NODE_ENV is not set or the environment is not recognized.
 *
 * @returns {string} The path to the environment file
 *
 * @example
 * // If NODE_ENV is 'development'
 * getEnvFile(); // Returns: '.env.development'
 */
export const getEnvFile = (): string => {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase().trim();

  if (!nodeEnv) {
    return DEFAULT_VALUES.ENV;
  }

  // Dynamically construct the environment file path
  return `.env.${nodeEnv}`;
};

// TODO this function may be an overhead. Consider removing in the future.
/**
 * Retrieves a type-safe environment variable from the application's ConfigService.
 * Automatically falls back to default values if the variable is not set.
 * @template K - The key from EnvironmentVariables schema
 * @param {INestApplication} app - The NestJS application instance
 * @param {K} key - The environment variable key to retrieve
 * @returns {EnvVariable<K>} The typed value of the environment variable or its default
 * @example
 * const port = getEnvVariable(app, 'PORT'); // Type: number
 * const hostname = getEnvVariable(app, 'NODE_HOSTNAME'); // Type: string | undefined
 */
export const getEnvVariable = <K extends keyof EnvironmentVariables>(
  app: INestApplication,
  key: K,
): EnvVariable<K> => {
  const configService = app.get(ConfigService);
  const value = configService.get<EnvVariable<K>>(key);
  const defaultValue = DEFAULT_VALUES[key as DefaultEnvKey] as EnvVariable<K>;
  return value ?? defaultValue;
};
