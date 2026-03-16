/**
 * Checks if the application is running in development environment.
 * @returns {boolean} True if NODE_ENV is 'development', false otherwise
 */
export const isDevelopment = () => process.env.NODE_ENV === 'development';

/**
 * Checks if the application is running in production environment.
 * @returns {boolean} True if NODE_ENV is 'production', false otherwise
 */
export const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Checks if the application is running in test environment.
 * @returns {boolean} True if NODE_ENV is 'test', false otherwise
 */
export const isTest = () => process.env.NODE_ENV === 'test';

/**
 * Checks if the application is running on localhost.
 * @returns {boolean} True if NODE_HOSTNAME is 'localhost', false otherwise
 */
export const isLocal = () => process.env.NODE_HOSTNAME === 'localhost';
