import { INestApplication } from '@nestjs/common';

import { getEnvVariable } from '../core/environment';

/**
 * Checks if the application is running in development environment.
 * @param {INestApplication} app - The NestJS application instance
 * @returns {boolean} True if NODE_ENV is 'development', false otherwise
 */
export const isDevelopment = (app: INestApplication) =>
  getEnvVariable(app, 'NODE_ENV') === 'development';

/**
 * Checks if the application is running in production environment.
 * @param {INestApplication} app - The NestJS application instance
 * @returns {boolean} True if NODE_ENV is 'production', false otherwise
 */
export const isProduction = (app: INestApplication) =>
  getEnvVariable(app, 'NODE_ENV') === 'production';

/**
 * Checks if the application is running in test environment.
 * @param {INestApplication} app - The NestJS application instance
 * @returns {boolean} True if NODE_ENV is 'test', false otherwise
 */
export const isTest = (app: INestApplication) => getEnvVariable(app, 'NODE_ENV') === 'test';

/**
 * Checks if the application is running on localhost.
 * @param {INestApplication} app - The NestJS application instance
 * @returns {boolean} True if NODE_HOSTNAME is 'localhost', false otherwise
 */
export const isLocal = (app: INestApplication) =>
  getEnvVariable(app, 'NODE_HOSTNAME') === 'localhost';
