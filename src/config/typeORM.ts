import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';

import { isDevelopment, isProduction } from '@/utils/env';

import { OrderItem } from '../orders/order-item.entity';
import { Order } from '../orders/order.entity';
import { Product } from '../products/product.entity';
import { User } from '../users/user.entity';

/**
 * Determines the correct file paths based on the environment
 */
export const getTypeOrmPaths = () => {
  const isProd = isProduction();
  const isCompiled = __dirname.includes('dist');

  if (isProd || isCompiled) {
    return {
      entities: ['dist/**/*.entity.js'],
      migrations: ['dist/db/migrations/*.js'],
    };
  }

  return {
    entities: ['src/**/*.entity.ts'],
    migrations: ['src/db/migrations/*.ts'],
  };
};

/**
 * Base TypeORM configuration shared between NestJS and CLI
 */
export const getTypeOrmConfig = (databaseUrl?: string): DataSourceOptions => {
  const { entities, migrations } = getTypeOrmPaths();
  const isDev = isDevelopment();

  console.log(`Using database URL: ${databaseUrl}`);

  return {
    entities,
    logger: isDev ? 'advanced-console' : 'simple-console',
    logging: isDev ? ['query', 'error', 'schema', 'warn'] : ['error', 'warn'],
    migrations,
    ssl: true,
    synchronize: false,
    type: 'postgres',
    url: databaseUrl,
  };
};

/**
 * TypeORM configuration for NestJS (includes explicit entity references)
 */
export const getTypeOrmModuleOptions = (configService: ConfigService): TypeOrmModuleOptions => {
  const baseConfig = getTypeOrmConfig(configService.getOrThrow<string>('DATABASE_URL'));

  return {
    ...baseConfig,
    entities: [User, Order, OrderItem, Product],
  } as TypeOrmModuleOptions;
};
