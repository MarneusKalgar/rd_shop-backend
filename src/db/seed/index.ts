import { isProduction } from '@/utils';

import dataSource from '../../../data-source';
import { OrderItem } from '../../orders/order-item.entity';
import { Order } from '../../orders/order.entity';
import { Product } from '../../products/product.entity';
import { User } from '../../users/user.entity';
import { seedOrders, seedProducts, seedUsers } from './data';

async function seed() {
  if (isProduction()) {
    console.error('⛔ Seeding should not be run in production environment');
    console.error('   This operation will overwrite production data!');
    process.exit(1);
  }

  console.log(process.env.DATABASE_URL);

  if (!process.env.DATABASE_URL) {
    console.error('⛔ DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  await dataSource.initialize();

  console.log('🌱 Starting database seeding...');

  try {
    const userRepository = dataSource.getRepository(User);
    const productRepository = dataSource.getRepository(Product);
    const orderRepository = dataSource.getRepository(Order);
    const orderItemRepository = dataSource.getRepository(OrderItem);

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

seed().catch((error) => {
  console.error('Seed script failed:', error);
  process.exit(1);
});
