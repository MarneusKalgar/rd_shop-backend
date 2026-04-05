import { INestApplication } from '@nestjs/common';

import { getEnvVariable } from '../environment';

export const setupCors = (app: INestApplication): void => {
  const corsOrigins =
    getEnvVariable(app, 'CORS_ALLOWED_ORIGINS')
      ?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) ?? [];

  app.enableCors({
    credentials: true,
    maxAge: 86400,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    origin: corsOrigins,
  });
};
