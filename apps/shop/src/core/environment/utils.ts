import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DEFAULT_VALUES } from './constants';
import { EnvironmentVariables } from './schema';
import { DefaultEnvKey, EnvVariable } from './types';

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
