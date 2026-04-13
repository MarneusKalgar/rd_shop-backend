import { DataSource } from 'typeorm';

import { ProductCategory } from '@/products/constants';
import { Product } from '@/products/product.entity';

const BRANDS = ['Samsung', 'Apple', 'Sony', 'LG', 'Bose', 'Dell', 'HP', 'Asus', 'Lenovo', 'Xiaomi'];
const CATEGORIES = Object.values(ProductCategory);
const COUNTRIES = ['US', 'CN', 'JP', 'KR', 'DE'];

const ADJECTIVES = [
  'Wireless',
  'Smart',
  'Ultra',
  'Pro',
  'Elite',
  'Premium',
  'Advanced',
  'Digital',
  'Compact',
  'Portable',
  'Lightweight',
  'Ergonomic',
  'Powerful',
  'Slim',
  'Fast',
];
const NOUNS = [
  'Headphones',
  'Speaker',
  'Monitor',
  'Keyboard',
  'Mouse',
  'Laptop',
  'Tablet',
  'Charger',
  'Webcam',
  'Hub',
  'Drive',
  'Controller',
  'Display',
  'Earbuds',
  'Watch',
];

/**
 * Bulk-inserts `count` products into the database.
 * Uses chunked raw INSERT for maximum throughput.
 *
 * @param dataSource - Active TypeORM DataSource (migrations must already be applied)
 * @param count - Number of products to insert (default 10 000)
 */
export async function seedProducts(dataSource: DataSource, count = 10_000): Promise<void> {
  const repo = dataSource.getRepository(Product);
  const chunkSize = 500;

  console.log(`  Seeding ${count} products in chunks of ${chunkSize}…`);

  for (let offset = 0; offset < count; offset += chunkSize) {
    const batch = Array.from({ length: Math.min(chunkSize, count - offset) }).map((_, i) => {
      const adj = randomItem(ADJECTIVES);
      const noun = randomItem(NOUNS);
      const seq = offset + i + 1;
      return repo.create({
        brand: randomItem(BRANDS),
        category: randomItem(CATEGORIES),
        country: randomItem(COUNTRIES),
        description: `${adj} ${noun} model ${seq} — designed for everyday use with high performance and reliability. Comes with a ${seq % 2 === 0 ? '1-year' : '2-year'} warranty and free support.`,
        isActive: true,
        price: (Math.random() * 1800 + 10).toFixed(2),
        stock: Math.floor(Math.random() * 500) + 1,
        title: `${adj} ${noun} ${seq}`,
      });
    });

    await repo.createQueryBuilder().insert().into(Product).values(batch).orIgnore().execute();
  }

  console.log(`  ✓ ${count} products inserted`);
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
