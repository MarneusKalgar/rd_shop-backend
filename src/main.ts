import { INestApplication, Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { setupGracefulShutdown } from '@tygra/nestjs-graceful-shutdown';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters';
import { TransformInterceptor } from './common/interceptors';
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

    app.enableVersioning({
      defaultVersion: '1',
      type: VersioningType.URI,
    });

    app.setGlobalPrefix('api', {
      exclude: ['/health', '/'],
    });

    app.useGlobalFilters(new GlobalExceptionFilter());

    app.useGlobalInterceptors(new TransformInterceptor());

    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true, // Throw error if non-whitelisted properties are present
        transform: true, // Automatically transform payloads to DTO instances
        transformOptions: { enableImplicitConversion: true }, // Enable implicit type conversion
        validationError: { target: false, value: false }, // Do not expose the original object
        whitelist: true, // Strip properties that don't have decorators
      }),
    );

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
