import { INestApplication, Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { setupGracefulShutdown } from '@tygra/nestjs-graceful-shutdown';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters';
import { TransformInterceptor } from './common/interceptors';
import { getLogLevels } from './config';
import { getEnvVariable, safeClose, setupProcessErrorHandlers } from './core';
import { setupSwagger } from './core/swagger';
import { isProduction } from './utils';

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
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        validationError: { target: false, value: false },
        whitelist: true,
      }),
    );

    if (!isProduction) {
      setupSwagger(app);
    }

    const port = getEnvVariable(app, 'PORT');

    if (!isProduction) {
      Logger.log(`Application is running on port: ${port}`);
      Logger.log(`Swagger UI available at: http://localhost:${port}/api-docs`);
    }

    await app.listen(port);
  } catch (error) {
    Logger.error('Error during application bootstrap', (error as Error).stack);
    await safeClose(app);
    process.exit(1);
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
