import { DataSource } from 'typeorm';

import { OrderItem } from '@/orders/order-item.entity';
import { Order, OrderStatus } from '@/orders/order.entity';
import { Product } from '@/products/product.entity';
import { User } from '@/users/user.entity';

/**
 * Bulk-inserts `orderCount` orders spread across the provided users and products.
 * Each order gets 1–3 items. Orders are spread across random dates in the past year
 * to give the cursor-pagination queries realistic distribution.
 *
 * @param dataSource - Active TypeORM DataSource
 * @param orderCount - Number of orders to insert (default 1 000)
 */
export async function seedOrders(dataSource: DataSource, orderCount = 1_000): Promise<void> {
  const userIds = await dataSource
    .getRepository(User)
    .createQueryBuilder('u')
    .select('u.id')
    .limit(200)
    .getRawMany<{ u_id: string }>();

  const products = await dataSource
    .getRepository(Product)
    .createQueryBuilder('p')
    .select(['p.id', 'p.price'])
    .where('p.is_active = true')
    .limit(200)
    .getMany();

  if (!userIds.length || !products.length) {
    throw new Error('seedOrders requires users and products to be seeded first');
  }

  const orderRepo = dataSource.getRepository(Order);
  const itemRepo = dataSource.getRepository(OrderItem);

  const existingCount = await orderRepo.count();
  if (existingCount > 0) {
    console.log(`  ⏭ orders table already has ${existingCount} rows — skipping`);
    return;
  }

  const nowMs = Date.now();
  const yearMs = 365 * 24 * 60 * 60 * 1_000;

  const chunkSize = 100;
  console.log(`  Seeding ${orderCount} orders…`);

  for (let offset = 0; offset < orderCount; offset += chunkSize) {
    const batchSize = Math.min(chunkSize, orderCount - offset);
    const orders: Order[] = [];

    // Phase 1: build and save orders so they get their UUIDs
    for (let i = 0; i < batchSize; i++) {
      const userId = userIds[(offset + i) % userIds.length].u_id;
      const createdAt = new Date(nowMs - Math.random() * yearMs);

      orders.push(
        orderRepo.create({
          createdAt,
          status: OrderStatus.PENDING,
          userId,
        }),
      );
    }

    await orderRepo.save(orders, { chunk: chunkSize });

    // Phase 2: orders now have UUIDs — build and save items
    const items: OrderItem[] = [];
    for (let i = 0; i < batchSize; i++) {
      const itemCount = Math.floor(Math.random() * 3) + 1;
      const usedProducts = new Set<number>();
      for (let j = 0; j < itemCount; j++) {
        let pi: number;
        do {
          pi = Math.floor(Math.random() * products.length);
        } while (usedProducts.has(pi));
        usedProducts.add(pi);

        items.push(
          itemRepo.create({
            orderId: orders[i].id,
            priceAtPurchase: products[pi].price,
            productId: products[pi].id,
            quantity: Math.floor(Math.random() * 3) + 1,
          }),
        );
      }
    }

    await itemRepo.save(items, { chunk: chunkSize * 3 });
  }

  console.log(`  ✓ ${orderCount} orders inserted`);
}
