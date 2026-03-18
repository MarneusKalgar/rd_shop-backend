import { INestApplication, Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
// import { setupGracefulShutdown } from '@tygra/nestjs-graceful-shutdown';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters';
import { getLogLevels } from './config';
import { getEnvVariable, safeClose, setupProcessErrorHandlers } from './core';
import { setupSwagger } from './core/swagger';
import { HEALTH_PATHS_TO_BYPASS } from './health/constants';
import { isProduction } from './utils';

async function bootstrap() {
  setupProcessErrorHandlers();

  let app: INestApplication | undefined;

  try {
    app = await NestFactory.create(AppModule, {
      logger: getLogLevels(),
    });

    // TODO: Uncomment when resolve problem with graphql module
    // setupGracefulShutdown({ app });

    app.enableVersioning({
      defaultVersion: '1',
      type: VersioningType.URI,
    });

    app.setGlobalPrefix('api', {
      exclude: [...HEALTH_PATHS_TO_BYPASS, '/'],
    });

    app.useGlobalFilters(new GlobalExceptionFilter());

    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        validationError: { target: false, value: false },
        whitelist: true,
      }),
    );

    const isProd = isProduction();

    if (!isProd) {
      setupSwagger(app);
    }

    const port = getEnvVariable(app, 'PORT');

    await app.listen(port);

    Logger.log(`Application is running on port: ${port}`);

    if (!isProd) {
      Logger.log(`Swagger UI available at: http://localhost:${port}/api-docs`);
      Logger.log(`GraphQL Playground available at: http://localhost:${port}/graphql`);
    }
  } catch (error) {
    Logger.error('Error during application bootstrap', (error as Error).stack);
    await safeClose(app);
    process.exit(1);
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
