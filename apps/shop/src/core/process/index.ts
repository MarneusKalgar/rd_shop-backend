import { INestApplication, Logger } from '@nestjs/common';

let isShuttingDown = false;

/**
 * Sets up global process error handlers for uncaught exceptions and unhandled rejections.
 * These handlers ensure that unexpected errors are logged before the process exits.
 *
 * @example
 * setupProcessErrorHandlers();
 */
export const setupProcessErrorHandlers = (): void => {
  /**
   * Handler for uncaught exceptions.
   * Logs the error and exits the process with code 1.
   */
  process.on('uncaughtException', (error: Error) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    Logger.error('💥 Uncaught Exception:', error.stack);
    Logger.error('Process will exit due to uncaught exception');
    process.exit(1);
  });

  /**
   * Handler for unhandled promise rejections.
   * Logs the rejection reason and exits the process with code 1.
   */
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    Logger.error('💥 Unhandled Rejection at:', promise);
    Logger.error('Rejection reason:', reason);
    Logger.error('Process will exit due to unhandled rejection');
    process.exit(1);
  });

  Logger.log('📝 Process error handlers are registered');
};

/**
 * Safely close the NestJS application.
 * Handles cases where app might be partially initialized.
 *
 * @param {INestApplication | undefined} app - The NestJS application instance
 * @returns {Promise<void>} Resolves when the application is closed
 *
 * @example
 * await safeClose(app);
 */
export const registerShutdownHandlers = (app: INestApplication): void => {
  const shutdown = (signal: string) => {
    void (async () => {
      app.get(Logger).log(`${signal} received — starting graceful shutdown`, 'Bootstrap');
      await safeClose(app);
      process.exit(0);
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

export const safeClose = async (app: INestApplication | undefined): Promise<void> => {
  if (!app) {
    Logger.warn('No application instance to close');
    return;
  }

  if (isShuttingDown) {
    Logger.warn('Application is already shutting down');
    return;
  }

  isShuttingDown = true;

  try {
    Logger.log('Closing application...');
    await app.close();
    Logger.log('✅ Application closed successfully');
  } catch (error) {
    Logger.error('⚠️ Failed to close application', (error as Error).stack);
  }
};
