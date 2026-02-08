/**
 * True if the application is running in development environment.
 */
export const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * True if the application is running in production environment.
 */
export const isProduction = process.env.NODE_ENV === 'production';

/**
 * True if the application is running in test environment.
 */
export const isTest = process.env.NODE_ENV === 'test';

/**
 * True if the application is running on localhost.
 */
export const isLocal = process.env.NODE_HOSTNAME === 'localhost';
