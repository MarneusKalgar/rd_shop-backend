import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters';
import { ResponseTimeInterceptor } from './common/interceptors';
import {
  getEnvVariable,
  registerShutdownHandlers,
  safeClose,
  setupCors,
  setupEventLoopMonitoring,
  setupHelmet,
  setupProcessErrorHandlers,
} from './core';
import { setupSwagger } from './core/swagger';
import { HEALTH_PATHS_TO_BYPASS } from './health/constants';
import { isProduction } from './utils';

async function bootstrap() {
  setupProcessErrorHandlers();

  let app: NestExpressApplication | undefined;

  try {
    app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

    app.useLogger(app.get(Logger));

    // Trust one level of proxy (Docker gateway / AWS ALB) for correct client IP resolution
    app.set('trust proxy', 1);

    app.enableVersioning({
      defaultVersion: '1',
      type: VersioningType.URI,
    });

    app.setGlobalPrefix('api', {
      exclude: [...HEALTH_PATHS_TO_BYPASS, '/'],
    });

    app.use(cookieParser());

    setupHelmet(app);

    app.useGlobalFilters(new GlobalExceptionFilter());

    app.useGlobalInterceptors(new ResponseTimeInterceptor());

    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        validationError: { target: false, value: false },
        whitelist: true,
      }),
    );

    setupCors(app);

    const isProd = isProduction();

    if (!isProd) {
      setupSwagger(app);
    }

    const port = getEnvVariable(app, 'PORT');
    const eventLoopThresholdMs = getEnvVariable(app, 'EVENT_LOOP_LAG_THRESHOLD_MS') ?? 100;
    setupEventLoopMonitoring(app.get(Logger), Number(eventLoopThresholdMs));

    await app.listen(port);

    registerShutdownHandlers(app);

    if (!isProd) {
      const logger = app.get(Logger);
      logger.log(`Application is running on port: ${port}`, 'Bootstrap');
      logger.log(`Swagger UI available at: http://localhost:${port}/api-docs`, 'Bootstrap');
      logger.log(`GraphQL Playground available at: http://localhost:${port}/graphql`, 'Bootstrap');
    }
  } catch (error) {
    console.error('Bootstrap failed:', error);
    await safeClose(app);
    process.exit(1);
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
