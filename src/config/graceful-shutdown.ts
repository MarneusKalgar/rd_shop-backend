import { IGracefulShutdownConfigOptions } from '@tygra/nestjs-graceful-shutdown';
import { Logger } from '@nestjs/common';

/**
 * Graceful shutdown configuration for the application.
 * Controls how the application handles shutdown signals (SIGTERM, SIGINT).
 *
 * @constant {IGracefulShutdownConfigOptions} gracefulShutdownConfig
 * @property {number} gracefulShutdownTimeout - Maximum time (ms) to wait for graceful shutdown
 * @property {boolean} keepNodeProcessAlive - Keep process alive during shutdown
 * @property {Function} cleanup - Optional cleanup function to run before shutdown
 *
 * @example
 * // Import in AppModule
 * GracefulShutdownModule.forRoot(gracefulShutdownConfig)
 */
export const gracefulShutdownConfig: IGracefulShutdownConfigOptions = {
  /**
   * Timeout for graceful shutdown in milliseconds.
   * After this time, the process will be forcefully terminated.
   * @default 10000 (10 seconds)
   */
  gracefulShutdownTimeout: 10000,

  /**
   * Optional cleanup function to run before shutdown.
   * Use this to close database connections, flush logs, etc.
   *
   * @example
   * cleanup: async () => {
   *   await database.disconnect();
   *   await redis.quit();
   * }
   */
  cleanup: async () => {
    Logger.log('🧹 Starting graceful shutdown cleanup...');

    try {
      // Add real cleanup logic as needed:
      // await databaseService.disconnect();
      // await redisClient.quit();
      // await messageQueue.close();

      // TODO Remove placeholder delay when real cleanup is implemented
      await new Promise((resolve) => setTimeout(resolve, 500));

      Logger.log('✅ Cleanup completed successfully');
    } catch (error) {
      Logger.error('❌ Cleanup failed:', (error as Error).message);
    }
  },
};

/**
 * Environment-specific graceful shutdown configurations.
 * Override default settings based on NODE_ENV.
 */
export const gracefulShutdownConfigByEnv: Record<
  string,
  Partial<IGracefulShutdownConfigOptions>
> = {
  /**
   * Development environment: Longer timeout for debugging
   */
  development: {
    gracefulShutdownTimeout: 15000,
  },

  /**
   * Production environment: Stricter timeout
   */
  production: {
    gracefulShutdownTimeout: 8000,
  },

  /**
   * Test environment: Quick shutdown for fast test runs
   */
  test: {
    gracefulShutdownTimeout: 3000,
    cleanup: undefined, // Skip cleanup in tests
  },
};

/**
 * Get graceful shutdown configuration based on current environment.
 * Merges default config with environment-specific overrides.
 *
 * @returns {IGracefulShutdownConfigOptions} Merged configuration
 *
 * @example
 * const config = getGracefulShutdownConfig('production');
 * GracefulShutdownModule.forRoot(config);
 */
export const getGracefulShutdownConfig = (): IGracefulShutdownConfigOptions => {
  const env = process.env.NODE_ENV || 'development';
  const envConfig = gracefulShutdownConfigByEnv[env] || {};

  return {
    ...gracefulShutdownConfig,
    ...envConfig,
  };
};
