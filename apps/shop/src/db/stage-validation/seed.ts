import * as bcrypt from 'bcryptjs';

import { UserRole, UserScope } from '@/auth/permissions';
import dataSource from '@/data-source';
import { ProductCategory } from '@/products/constants';
import { Product } from '@/products/product.entity';
import { User } from '@/users/user.entity';

import { getStageValidationUserEmail } from './constants';
import {
  assertStageValidationRuntime,
  getStageValidationNamespace,
  requireStageValidationProductId,
  requireStageValidationUserPassword,
} from './runtime';

const STAGE_VALIDATION_PRODUCT_STOCK = 24;

/** Creates the deterministic validation users and products consumed by stage e2e scenarios. */
export async function seedStageValidationData(): Promise<void> {
  assertStageValidationRuntime('seed');

  if (!process.env.DATABASE_URL || !process.env.DATABASE_PROVIDER) {
    throw new Error('DATABASE_URL or DATABASE_PROVIDER environment variable is not set');
  }

  const namespace = getStageValidationNamespace();
  const productId = requireStageValidationProductId();
  const userPassword = requireStageValidationUserPassword();
  const hashedPassword = await bcrypt.hash(userPassword, 10);

  await dataSource.initialize();

  try {
    const userRepository = dataSource.getRepository(User);
    const productRepository = dataSource.getRepository(Product);

    const users = [
      userRepository.create({
        email: getStageValidationUserEmail('cart', namespace),
        firstName: 'Stage',
        isEmailVerified: true,
        lastName: 'Cart',
        password: hashedPassword,
        roles: [UserRole.USER],
        scopes: [UserScope.ORDERS_READ, UserScope.ORDERS_WRITE, UserScope.PRODUCTS_READ],
      }),
      userRepository.create({
        email: getStageValidationUserEmail('order', namespace),
        firstName: 'Stage',
        isEmailVerified: true,
        lastName: 'Order',
        password: hashedPassword,
        roles: [UserRole.USER],
        scopes: [UserScope.ORDERS_READ, UserScope.ORDERS_WRITE, UserScope.PRODUCTS_READ],
      }),
      userRepository.create({
        email: getStageValidationUserEmail('orders-query', namespace),
        firstName: 'Stage',
        isEmailVerified: true,
        lastName: 'Query',
        password: hashedPassword,
        roles: [UserRole.USER],
        scopes: [UserScope.ORDERS_READ, UserScope.ORDERS_WRITE, UserScope.PRODUCTS_READ],
      }),
    ];

    const product = productRepository.create({
      brand: 'RD Shop',
      category: ProductCategory.ACCESSORIES,
      country: 'DE',
      description: `Deterministic validation product for namespace ${namespace}.`,
      id: productId,
      isActive: true,
      price: '49.99',
      stock: STAGE_VALIDATION_PRODUCT_STOCK,
      title: `${namespace} Validation Product`,
    });

    console.log(`🌱 Stage validation seed namespace=${namespace}`);
    await userRepository.upsert(users, ['email']);
    await productRepository.upsert(product, ['id']);
    console.log(`   ✓ Upserted ${users.length} validation users`);
    console.log(`   ✓ Upserted validation product ${productId}`);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

/** Executes the stage validation seed entrypoint and converts failures into a non-zero exit code. */
async function main(): Promise<void> {
  try {
    await seedStageValidationData();
  } catch (error) {
    console.error('Stage validation seed failed:', error);
    process.exit(1);
  }
}

void main();
