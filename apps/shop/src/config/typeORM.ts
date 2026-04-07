import { DatabaseAdapterFactory } from '@app/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { AuditLog } from '@/audit-log/audit-log.entity';
import { DEFAULT_VALUES } from '@/core/environment';
import { ShopTypeOrmLogger } from '@/db/logger';
import { ProcessedMessage } from '@/rabbitmq/processed-message.entity';
import { isProduction } from '@/utils/env';

import { EmailVerificationToken } from '../auth/email-verification-token.entity';
import { PasswordResetToken } from '../auth/password-reset-token.entity';
import { RefreshToken } from '../auth/refresh-token.entity';
import { CartItem } from '../cart/cart-item.entity';
import { Cart } from '../cart/cart.entity';
import { FileRecord } from '../files/file-record.entity';
import { OrderItem } from '../orders/order-item.entity';
import { Order } from '../orders/order.entity';
import { ProductReview } from '../products/product-review.entity';
import { Product } from '../products/product.entity';
import { User } from '../users/user.entity';

/**
 * Determines the correct file paths based on the environment
 */
export const getTypeOrmPaths = () => {
  const isProd = isProduction();

  const resolvedProject = process.env.APP?.toLowerCase()?.trim() ?? DEFAULT_VALUES.APP;

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
    entities: [
      User,
      Order,
      OrderItem,
      Cart,
      CartItem,
      Product,
      ProductReview,
      FileRecord,
      ProcessedMessage,
      RefreshToken,
      EmailVerificationToken,
      PasswordResetToken,
      AuditLog,
    ],
    logger: new ShopTypeOrmLogger(),
  } as TypeOrmModuleOptions;
};
