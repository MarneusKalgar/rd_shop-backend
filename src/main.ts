import { INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { setupGracefulShutdown } from '@tygra/nestjs-graceful-shutdown';

import { AppModule } from './app.module';
import { getLogLevels } from './config';
import { getEnvVariable, safeClose, setupProcessErrorHandlers } from './core';

async function bootstrap() {
  setupProcessErrorHandlers();

  let app: INestApplication | undefined;

  try {
    app = await NestFactory.create(AppModule, {
      logger: getLogLevels(),
    });

    setupGracefulShutdown({ app });

    const port = getEnvVariable(app, 'PORT');
    Logger.log(`Application is running on port: ${port}`);
    await app.listen(port);
  } catch (error) {
    Logger.error('Error during application bootstrap', (error as Error).stack);
    await safeClose(app);
    process.exit(1);
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
