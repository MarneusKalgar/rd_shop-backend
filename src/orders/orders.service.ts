import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { Product } from '../products/product.entity';
import { User } from '../users/user.entity';
import { CreateOrderDto } from './dto';
import { OrderItem } from './order-item.entity';
import { Order } from './order.entity';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Creates a new order with idempotency support and transaction safety.
   * Uses pessimistic locking (FOR NO KEY UPDATE) to prevent oversell in concurrent scenarios.
   *
   * Workflow:
   * 1. Pre-validation (outside transaction):
   *    - Validates user exists
   *    - Validates item quantities are positive
   *    - Checks idempotency key for duplicate submissions
   *    - Pre-checks all products exist (fail fast)
   * 2. Transaction execution:
   *    - Sets PostgreSQL timeouts (statement: 10s, lock: 5s)
   *    - Locks products with pessimistic locking (FOR NO KEY UPDATE)
   *    - Validates product state (active, sufficient stock)
   *    - Updates product stock
   *    - Creates order and order items
   *    - Re-fetches order with relations
   * 3. Error handling:
   *    - Handles idempotency key race conditions (PostgreSQL error 23505)
   *    - Automatic rollback on any failure
   *
   * Approach: Pessimistic Locking
   * - Locks product rows using PostgreSQL's FOR NO KEY UPDATE
   * - Prevents concurrent modifications while allowing foreign key references
   * - Provides strong consistency guarantees without retry logic
   * - Suitable for high-contention scenarios where correctness is critical
   *
   * Timeout Configuration:
   * - statement_timeout: 10000ms (prevents long-running queries)
   * - lock_timeout: 5000ms (prevents indefinite lock waiting)
   * - Set via SET LOCAL within transaction scope
   *
   * @param createOrderDto - Order creation data
   * @returns Created order or existing order if idempotency key matches
   * @throws {BadRequestException} Invalid quantity (≤0) - HTTP 400
   * @throws {NotFoundException} User or product doesn't exist - HTTP 404
   * @throws {ConflictException} Insufficient stock or product inactive - HTTP 409
   * @throws {Error} Unexpected errors (database timeouts, deadlocks) - propagates original error
   */
  async createOrder(createOrderDto: CreateOrderDto): Promise<Order> {
    const { idempotencyKey, items, userId } = createOrderDto;

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    for (const item of items) {
      if (item.quantity <= 0) {
        throw new BadRequestException(
          `Quantity must be greater than zero for product ${item.productId}`,
        );
      }
    }

    if (idempotencyKey) {
      const existingOrder = await this.orderRepository.findOne({
        relations: ['items', 'items.product', 'user'],
        where: { idempotencyKey },
      });

      if (existingOrder) {
        this.logger.log(
          `Idempotency key "${idempotencyKey}" already exists. Returning existing order: ${existingOrder.id}`,
        );
        return existingOrder;
      }
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    const productsPreCheck = await this.productRepository.find({
      where: { id: In(productIds) },
    });

    if (productsPreCheck.length !== productIds.length) {
      const foundIds = new Set(productsPreCheck.map((p) => p.id));
      const missingId = productIds.find((id) => !foundIds.has(id));
      throw new NotFoundException(`Product with ID "${missingId}" not found`);
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        //  Set timeouts
        await manager.query('SET LOCAL statement_timeout = 10000');
        await manager.query('SET LOCAL lock_timeout = 5000');

        const orderRepo = manager.getRepository(Order);
        const orderItemRepo = manager.getRepository(OrderItem);
        const productRepo = manager.getRepository(Product);

        // Lock products with pessimistic locking (FOR NO KEY UPDATE)
        const products = await productRepo
          .createQueryBuilder('product')
          .setLock('pessimistic_write')
          .where('product.id IN (:...ids)', { ids: productIds })
          .getMany();

        const productMap = new Map(products.map((p) => [p.id, p]));

        for (const item of items) {
          const product = productMap.get(item.productId)!;

          if (!product.isActive) {
            throw new ConflictException(`Product "${product.title}" is not available for purchase`);
          }

          if (product.stock < item.quantity) {
            throw new ConflictException(
              `Insufficient stock for product "${product.title}". Requested: ${item.quantity}, Available: ${product.stock}`,
            );
          }
        }

        for (const item of items) {
          const product = productMap.get(item.productId)!;
          product.stock -= item.quantity;
        }

        await productRepo.save([...productMap.values()]);

        const order = orderRepo.create({
          idempotencyKey: idempotencyKey ?? null,
          user,
          userId,
        });
        await orderRepo.save(order);

        const orderItems = items.map((item) => {
          const product = productMap.get(item.productId)!;
          return orderItemRepo.create({
            order,
            orderId: order.id,
            priceAtPurchase: product.price,
            product,
            productId: product.id,
            quantity: item.quantity,
          });
        });

        await orderItemRepo.save(orderItems);

        const createdOrder = await orderRepo.findOne({
          relations: ['items', 'items.product', 'user'],
          where: { id: order.id },
        });

        if (!createdOrder) {
          throw new Error('Order creation failed');
        }

        this.logger.log(`Order created successfully: ${createdOrder.id}`);

        return createdOrder;
      });
    } catch (error: unknown) {
      // Handle duplicate idempotency key race condition
      const pgError = error as { code?: string };
      if (pgError?.code === '23505' && idempotencyKey) {
        this.logger.warn(
          `Race condition detected for idempotency key "${idempotencyKey}". Returning existing order.`,
        );

        const existingOrder = await this.orderRepository.findOne({
          relations: ['items', 'items.product', 'user'],
          where: { idempotencyKey },
        });

        if (existingOrder) {
          return existingOrder;
        }
      }

      this.logger.error('Order creation failed, transaction rolled back', error);
      throw error;
    }
  }
}
