/**
 * Performance seed orchestrator.
 *
 * Usage (from apps/shop/):
 *   npx ts-node -r tsconfig-paths/register ./src/db/perf-seed/index.ts
 *   npx ts-node -r tsconfig-paths/register ./src/db/perf-seed/index.ts --scenario=product-search
 *   npx ts-node -r tsconfig-paths/register ./src/db/perf-seed/index.ts --scenario=order-creation
 *   npx ts-node -r tsconfig-paths/register ./src/db/perf-seed/index.ts --scenario=auth-stress
 *
 * Also called directly from beforeAll() in Testcontainers perf scenarios.
 */
import 'dotenv/config';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

import { FileRecord } from '@/files/file-record.entity';
import { OrderItem } from '@/orders/order-item.entity';
import { Order } from '@/orders/order.entity';
import { Product } from '@/products/product.entity';
import { ProcessedMessage } from '@/rabbitmq/processed-message.entity';
import { User } from '@/users/user.entity';

import { seedOrders } from './generate-orders';
import { seedProducts } from './generate-products';
import { seedUsers } from './generate-users';

const MIGRATIONS_GLOB = join(__dirname, '../../db/migrations/*{.ts,.js}');

type Scenario = 'all' | 'auth-stress' | 'order-creation' | 'product-search';

const SCENARIO_CONFIGS: Record<Scenario, { orders: number; products: number; users: number }> = {
  all: { orders: 1_000, products: 10_000, users: 100 },
  'auth-stress': { orders: 0, products: 0, users: 100 },
  'order-creation': { orders: 0, products: 20, users: 100 },
  'product-search': { orders: 0, products: 10_000, users: 10 },
};

/**
 * Runs the seed pipeline for a given scenario against the provided DataSource.
 * When called from compose (index.ts as CLI entry), it creates its own DataSource.
 * When called from Testcontainers beforeAll(), the caller passes in its DataSource.
 */
export async function runSeed(dataSource: DataSource, scenario: Scenario = 'all'): Promise<void> {
  const { orders, products, users } = SCENARIO_CONFIGS[scenario];
  console.log(`\n🌱 Perf seed — scenario="${scenario}"`);

  if (users > 0) await seedUsers(dataSource, users);
  if (products > 0) await seedProducts(dataSource, products);
  if (orders > 0) await seedOrders(dataSource, orders);

  console.log('✅ Perf seed done\n');
}

function parseScenario(): Scenario {
  const arg = process.argv.find((a) => a.startsWith('--scenario='));
  const value = arg ? arg.split('=')[1] : 'all';
  if (!(value in SCENARIO_CONFIGS)) {
    throw new Error(
      `Unknown scenario "${value}". Valid: ${Object.keys(SCENARIO_CONFIGS).join(', ')}`,
    );
  }
  return value as Scenario;
}

// CLI entry point — only executes when run directly via ts-node / node
if (require.main === module) {
  const scenario = parseScenario();

  const dataSource = new DataSource({
    entities: [FileRecord, Order, OrderItem, ProcessedMessage, Product, User],
    migrations: [MIGRATIONS_GLOB],
    ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? true : false,
    synchronize: false,
    type: 'postgres',
    url: process.env.DATABASE_URL,
  });

  dataSource
    .initialize()
    .then(() => runSeed(dataSource, scenario))
    .then(() => dataSource.destroy())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
