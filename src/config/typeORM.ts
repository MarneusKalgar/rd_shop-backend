import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { DatabaseAdapterFactory } from '@/db/adapters';
import { CustomTypeOrmLogger } from '@/db/logger';
import { isProduction } from '@/utils/env';

import { OrderItem } from '../orders/order-item.entity';
import { Order } from '../orders/order.entity';
import { Product } from '../products/product.entity';
import { User } from '../users/user.entity';

/**
 * Determines the correct file paths based on the environment
 */
export const getTypeOrmPaths = () => {
  const isProd = isProduction();

  if (isProd) {
    return {
      entities: ['dist/**/*.entity.js'],
      migrations: ['dist/db/migrations/*.js'],
    };
  }

  return {
    entities: ['src/**/*.entity{.ts,.js}'],
    migrations: ['src/db/migrations/*{.ts,.js}'],
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
    entities: [User, Order, OrderItem, Product],
    logger: new CustomTypeOrmLogger(),
  } as TypeOrmModuleOptions;
};
