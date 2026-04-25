import dataSource from '@/data-source';
import { OrderItem } from '@/orders/order-item.entity';
import { Order } from '@/orders/order.entity';
import { ProductReview } from '@/products/product-review.entity';
import { Product } from '@/products/product.entity';
import { User } from '@/users/user.entity';
import { isProduction } from '@/utils';

import { seedOrders, seedProducts, seedReviews, seedUsers } from './data';

/**
 * Runs the shared idempotent seed body against the configured database.
 * This is the unguarded implementation used by the stage-only and production-guarded entrypoints.
 */
export async function runSeed(): Promise<void> {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_PROVIDER) {
    throw new Error('DATABASE_URL or DATABASE_PROVIDER environment variable is not set');
  }

  await dataSource.initialize();

  console.log('🌱 Starting database seeding...');

  try {
    const userRepository = dataSource.getRepository(User);
    const productRepository = dataSource.getRepository(Product);
    const orderRepository = dataSource.getRepository(Order);
    const orderItemRepository = dataSource.getRepository(OrderItem);
    const reviewRepository = dataSource.getRepository(ProductReview);

    console.log('👤 Seeding users...');
    await userRepository.upsert(seedUsers, ['email']);
    console.log(`   ✓ Upserted ${seedUsers.length} users`);

    console.log('📦 Seeding products...');
    await productRepository.upsert(seedProducts, ['title']);
    console.log(`   ✓ Upserted ${seedProducts.length} products`);

    console.log('🛒 Seeding orders...');
    const ordersToUpsert: Order[] = [];
    const orderItemsToUpsert: OrderItem[] = [];

    for (const orderData of seedOrders) {
      const user = await userRepository.findOne({
        where: { email: orderData.userEmail },
      });

      if (!user) {
        console.warn(`   ⚠ User not found: ${orderData.userEmail}`);
        continue;
      }

      ordersToUpsert.push(
        orderRepository.create({
          id: orderData.id,
          userId: user.id,
        }),
      );

      for (const itemData of orderData.items) {
        const product = await productRepository.findOne({
          where: { title: itemData.productTitle },
        });

        if (!product) {
          console.warn(`   ⚠ Product not found: ${itemData.productTitle}`);
          continue;
        }

        orderItemsToUpsert.push(
          orderItemRepository.create({
            id: itemData.id,
            orderId: orderData.id,
            priceAtPurchase: product.price,
            productId: product.id,
            quantity: itemData.quantity,
          }),
        );
      }
    }

    if (ordersToUpsert.length > 0) {
      await orderRepository.upsert(ordersToUpsert, ['id']);
      console.log(`   ✓ Upserted ${ordersToUpsert.length} orders`);
    } else {
      console.log('   ⊘ No orders to upsert');
    }

    if (orderItemsToUpsert.length > 0) {
      await orderItemRepository.upsert(orderItemsToUpsert, ['id']);
      console.log(`   ✓ Upserted ${orderItemsToUpsert.length} order items`);
    } else {
      console.log('   ⊘ No order items to upsert');
    }

    console.log('⭐ Seeding reviews...');
    const reviewsToUpsert: ProductReview[] = [];

    for (const reviewData of seedReviews) {
      const user = await userRepository.findOne({
        where: { email: reviewData.userEmail },
      });

      if (!user) {
        console.warn(`   ⚠ User not found: ${reviewData.userEmail}`);
        continue;
      }

      reviewsToUpsert.push(
        reviewRepository.create({
          id: reviewData.id,
          productId: reviewData.productId,
          rating: reviewData.rating,
          text: reviewData.text,
          userId: user.id,
        }),
      );
    }

    if (reviewsToUpsert.length > 0) {
      await reviewRepository.upsert(reviewsToUpsert, ['id']);
      console.log(`   ✓ Upserted ${reviewsToUpsert.length} reviews`);
    } else {
      console.log('   ⊘ No reviews to upsert');
    }

    console.log('✅ Seeding completed successfully');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

/**
 * Runs the seed body only when the runtime identity says this task belongs to the `stage` stack.
 * This is used by the dedicated stage ECS one-off task and must not rely on the production seed flag.
 */
export async function seedStage(): Promise<void> {
  assertStageSeedRuntime();
  await runSeed();
}

/**
 * Runs the seed body behind the explicit production opt-in.
 * This remains the safe default for generic production seed entrypoints and manual runs.
 */
export async function seedWithProductionGuard(): Promise<void> {
  assertProductionSeedAllowed();
  await runSeed();
}

/**
 * Enforces the explicit production seed override before any writes happen.
 * `ALLOW_SEED_IN_PRODUCTION` is a permission bit, not a stack identity marker.
 */
function assertProductionSeedAllowed(): void {
  if (!isProduction()) {
    return;
  }

  if (process.env.ALLOW_SEED_IN_PRODUCTION !== 'true') {
    throw new Error('Seeding should not be run in production environment');
  }

  console.log('🔐 Production seed authorized via env opt-in');
}

/**
 * Ensures the stage-only entrypoint executes only under stage runtime config emitted by Pulumi.
 * This is the stack identity check that separates stage seeding from production seeding.
 */
function assertStageSeedRuntime(): void {
  if (process.env.DEPLOYMENT_ENVIRONMENT !== 'stage') {
    throw new Error(
      `Stage seed entrypoint requires DEPLOYMENT_ENVIRONMENT=stage, received ${process.env.DEPLOYMENT_ENVIRONMENT ?? 'unset'}`,
    );
  }

  console.log('🔐 Stage seed authorized via DEPLOYMENT_ENVIRONMENT=stage');
}
