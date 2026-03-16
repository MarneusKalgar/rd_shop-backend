import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { DatabaseAdapterFactory } from '@/db/adapters';
import { CustomTypeOrmLogger } from '@/db/logger';
import { Payment } from '@/payment.entity';
import { isProduction } from '@/utils/env';

/**
 * Determines the correct file paths based on the environment
 */
export const getTypeOrmPaths = () => {
  const isProd = isProduction();

  const resolvedProject = process.env.APP?.toLowerCase()?.trim();

  if (!resolvedProject) {
    throw new Error('APP environment variable is not set or invalid');
  }

  if (isProd) {
    return {
      entities: [`../../dist/apps/${resolvedProject}/**/*.entity.js`],
      migrations: [`../../dist/apps/${resolvedProject}/db/migrations/*.js`],
    };
  }

  return {
    entities: [`src/**/*.entity{.ts,.js}`],
    migrations: [`src/db/migrations/*{.ts,.js}`],
  };
};

/**
 * TypeORM configuration for NestJS (includes explicit entity references)
 */
export const getTypeOrmModuleOptions = (configService: ConfigService): TypeOrmModuleOptions => {
  const databaseProvider = configService.get<string>('DATABASE_PROVIDER');
  const adapter = DatabaseAdapterFactory.create(databaseProvider);
  const baseConfig = adapter.getModuleOptions();

  return {
    ...baseConfig,
    entities: [Payment],
    logger: new CustomTypeOrmLogger(),
  } as TypeOrmModuleOptions;
};
