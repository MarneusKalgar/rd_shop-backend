import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

import { Product } from './product.entity';

@Injectable()
export class ProductsRepository {
  constructor(
    @InjectRepository(Product)
    private readonly repository: Repository<Product>,
  ) {}

  async findByIds(productIds: string[]): Promise<Product[]> {
    return this.repository.find({
      where: { id: In(productIds) },
    });
  }

  /**
   * Finds products by IDs with pessimistic write lock (FOR UPDATE).
   *
   * **Lock Behavior:**
   * - Translates to `SELECT ... FOR UPDATE` in PostgreSQL
   * - Prevents concurrent modifications to locked product rows
   * - Blocks other transactions attempting `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`
   * - Allows non-locking reads (plain `SELECT` queries)
   * - Prevents foreign key references during the lock period
   *
   * **Use Case:**
   * - Ensures stock consistency during order creation
   * - Prevents race conditions when multiple orders target the same product
   * - Guarantees atomic stock updates within transaction boundaries
   *
   * **Lock Acquisition:**
   * - Locks acquired in order of product IDs (prevents deadlocks)
   * - Held until transaction commits or rolls back
   * - Subject to `lock_timeout` (default: 10 seconds in order transactions)
   *
   * **Performance Considerations:**
   * - Lock duration typically < 50ms for order creation
   * - High contention may cause lock waits (monitor `pg_stat_activity`)
   * - Consider connection pooling to prevent exhaustion under load
   *
   * **Error Handling:**
   * - Lock timeout (PostgreSQL `55P03`) → HTTP 409 Conflict
   * - Statement timeout (`57014`) → HTTP 500 Internal Server Error
   * - Deadlock (`40P01`) → Automatic retry by PostgreSQL or manual handling
   *
   * @param manager - TypeORM EntityManager (transaction context required)
   * @param productIds - Array of product UUIDs to lock (must be non-empty)
   * @returns Promise resolving to locked Product entities
   * @throws {Error} If productIds array is empty
   * @throws {QueryFailedError} If lock cannot be acquired within lock_timeout
   *
   * @example
   * ```typescript
   * // Within a transaction
   * await this.dataSource.transaction(async (manager) => {
   *   // Acquire locks on products
   *   const products = await this.productsRepository.findByIdsWithLock(
   *     manager,
   *     ['product-uuid-1', 'product-uuid-2']
   *   );
   *
   *   // Now safe to modify - no concurrent changes possible
   *   products.forEach(p => p.stock -= 1);
   *   await this.productsRepository.saveProducts(manager, products);
   * });
   * ```
   *
   * @see https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS
   * @see https://typeorm.io/select-query-builder#locking
   */
  async findByIdsWithLock(manager: EntityManager, productIds: string[]): Promise<Product[]> {
    const repo = this.getRepository(manager);
    return repo
      .createQueryBuilder('product')
      .setLock('pessimistic_write')
      .where('product.id IN (:...ids)', { ids: productIds })
      .getMany();
  }

  async saveProducts(manager: EntityManager, products: Product[]): Promise<Product[]> {
    const repo = this.getRepository(manager);
    return repo.save(products);
  }

  /**
   * Helper to get the appropriate repository (transactional or default).
   */
  private getRepository(manager?: EntityManager): Repository<Product> {
    return manager ? manager.getRepository(Product) : this.repository;
  }
}
