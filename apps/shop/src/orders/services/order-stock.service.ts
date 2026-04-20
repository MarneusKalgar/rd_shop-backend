import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { Product } from '@/products/product.entity';
import { ProductsRepository } from '@/products/product.repository';

import { OrderItem } from '../order-item.entity';

export interface StockItem {
  productId: string;
  quantity: number;
}

@Injectable()
export class OrderStockService {
  constructor(private readonly productsRepository: ProductsRepository) {}

  /**
   * Decrements stock values in-memory for items being ordered.
   * Must be followed by a `saveProducts` call within the same transaction.
   */
  decrementStock(items: StockItem[], productMap: Map<string, Product>): void {
    for (const item of items) {
      const product = productMap.get(item.productId)!;
      product.stock -= item.quantity;
    }
  }

  /**
   * Acquires pessimistic write locks on products for a cancellation, increments
   * stock in-memory, and persists the updated products — all within the provided
   * transaction manager.
   */
  async lockAndRestore(
    manager: EntityManager,
    items: Pick<OrderItem, 'productId' | 'quantity'>[],
    productIds: string[],
  ): Promise<void> {
    const products = await this.productsRepository.findByIdsWithLock(manager, productIds);
    const productMap = new Map(products.map((p) => [p.id, p]));

    this.restoreStock(items, productMap);

    await this.productsRepository.saveProducts(manager, [...productMap.values()]);
  }

  /**
   * Acquires pessimistic write locks on products, validates stock/availability,
   * decrements stock in-memory, and persists the updated products — all within
   * the provided transaction manager.
   */
  async lockValidateAndDecrement(
    manager: EntityManager,
    items: StockItem[],
    productIds: string[],
  ): Promise<Map<string, Product>> {
    const products = await this.productsRepository.findByIdsWithLock(manager, productIds);
    const productMap = new Map(products.map((p) => [p.id, p]));

    this.validateStockAndAvailability(items, productMap);
    this.decrementStock(items, productMap);

    await this.productsRepository.saveProducts(manager, [...productMap.values()]);

    return productMap;
  }

  /**
   * Restores stock for each order item by incrementing `product.stock` in-memory.
   * Must be followed by a `saveProducts` call within the same transaction.
   */
  restoreStock(
    items: Pick<OrderItem, 'productId' | 'quantity'>[],
    productMap: Map<string, Product>,
  ): void {
    for (const item of items) {
      const product = productMap.get(item.productId);
      if (product) {
        product.stock += item.quantity;
      }
    }
  }

  /**
   * Validates that all given product IDs exist in the database.
   * Used as a fast pre-check before opening a transaction.
   *
   * @throws {NotFoundException} If any product ID is not found
   */
  async validateExist(productIds: string[]): Promise<void> {
    const products = await this.productsRepository.findByIds(productIds);

    if (products.length !== productIds.length) {
      const foundIds = new Set(products.map((p) => p.id));
      const missingId = productIds.find((id) => !foundIds.has(id));
      throw new NotFoundException(`Product with ID "${missingId}" not found`);
    }
  }

  /**
   * Validates that all items reference active products with sufficient stock.
   * Called inside a transaction after acquiring pessimistic locks.
   *
   * @throws {NotFoundException} If a product is missing from the locked result set
   * @throws {ConflictException} If a product is inactive or has insufficient stock
   */
  validateStockAndAvailability(items: StockItem[], productMap: Map<string, Product>): void {
    for (const item of items) {
      const product = productMap.get(item.productId);

      if (!product) {
        throw new NotFoundException(
          `Product with ID "${item.productId}" not found or was deleted during order processing`,
        );
      }

      if (!product.isActive) {
        throw new ConflictException(`Product "${product.title}" is not available for purchase`);
      }

      if (product.stock < item.quantity) {
        throw new ConflictException(
          `Insufficient stock for product "${product.title}". Requested: ${item.quantity}, Available: ${product.stock}`,
        );
      }
    }
  }
}
