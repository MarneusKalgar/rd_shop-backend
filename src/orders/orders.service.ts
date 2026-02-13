import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { ProductsRepository } from '@/products/product.repository';

import { Product } from '../products/product.entity';
import { User } from '../users/user.entity';
import { CreateOrderDto, FindOrdersFilterDto } from './dto';
import { Order } from './order.entity';
import {
  OrderItemData,
  OrderItemsRepository,
  OrdersQueryBuilder,
  OrdersRepository,
} from './repositories';
import { FindOrdersWithFiltersResponse } from './types';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly ordersRepository: OrdersRepository,
    private readonly productsRepository: ProductsRepository,
    private readonly orderItemsRepository: OrderItemsRepository,

    private readonly ordersQueryBuilder: OrdersQueryBuilder,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Creates a new order with idempotency support and transaction safety.
   * Uses pessimistic locking (FOR NO KEY UPDATE) to prevent oversell in concurrent scenarios.
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

    const user = await this.validateUser(userId);
    this.validateOrderItems(items);

    const existingOrder = await this.checkIdempotency(idempotencyKey);
    if (existingOrder) {
      return existingOrder;
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    await this.validateProductsExist(productIds);

    try {
      return await this.executeOrderTransaction(createOrderDto, user, productIds);
    } catch (error: unknown) {
      return await this.handleOrderCreationPgErrors(error, userId, idempotencyKey);
    }
  }

  async findOrdersWithFilters(params: FindOrdersFilterDto): Promise<FindOrdersWithFiltersResponse> {
    const { cursor, limit = 10 } = params;

    const queryBuilder = this.ordersQueryBuilder.buildFilteredQuery(params);

    if (cursor) {
      const cursorOrder = await this.ordersRepository.findByCursor(cursor);
      if (cursorOrder) {
        this.ordersQueryBuilder.applyCursorPagination(queryBuilder, cursorOrder);
      }
    }

    this.ordersQueryBuilder.applyOrderingAndLimit(queryBuilder, limit);

    const [orders, total] = await queryBuilder.getManyAndCount();
    const nextCursor = orders.length === limit ? orders[orders.length - 1].id : null;

    return { nextCursor, orders, total };
  }

  private async checkIdempotency(idempotencyKey?: string): Promise<null | Order> {
    if (!idempotencyKey) {
      return null;
    }

    const existingOrder = await this.ordersRepository.findByIdempotencyKey(idempotencyKey);

    if (existingOrder) {
      this.logger.log(
        `Idempotency key "${idempotencyKey}" already exists. Returning existing order: ${existingOrder.id}`,
      );
    }

    return existingOrder;
  }

  private decrementProductStock(
    items: CreateOrderDto['items'],
    productMap: Map<string, Product>,
  ): void {
    for (const item of items) {
      const product = productMap.get(item.productId)!;
      product.stock -= item.quantity;
    }
  }

  private async executeOrderTransaction(
    createOrderDto: CreateOrderDto,
    user: User,
    productIds: string[],
  ): Promise<Order> {
    const { idempotencyKey, items, userId } = createOrderDto;

    return await this.dataSource.transaction(async (manager) => {
      await manager.query('SET LOCAL statement_timeout = 30000');
      await manager.query('SET LOCAL lock_timeout = 10000');

      const products = await this.productsRepository.findByIdsWithLock(manager, productIds);
      const productMap = new Map(products.map((p) => [p.id, p]));

      this.validateStockAndAvailability(items, productMap);
      this.decrementProductStock(items, productMap);

      await this.productsRepository.saveProducts(manager, [...productMap.values()]);

      const order = await this.ordersRepository.createOrder(manager, {
        idempotencyKey,
        user,
        userId,
      });

      const orderItemsData: OrderItemData[] = items.map((item) => {
        const product = productMap.get(item.productId)!;
        return {
          order,
          orderId: order.id,
          priceAtPurchase: product.price,
          product,
          productId: product.id,
          quantity: item.quantity,
        };
      });

      await this.orderItemsRepository.createOrderItems(manager, orderItemsData);

      const createdOrder = await this.ordersRepository.findByIdWithRelations(manager, order.id);

      if (!createdOrder) {
        throw new Error('Order creation failed');
      }

      this.logger.log(`Order created successfully: ${createdOrder.id}`);

      return createdOrder;
    });
  }

  private async handleOrderCreationPgErrors(
    error: unknown,
    userId: string,
    idempotencyKey?: string,
  ): Promise<Order> {
    const pgError = error as { code?: string; message?: string };

    // Handle duplicate idempotency key race condition
    if (pgError?.code === '23505' && idempotencyKey) {
      this.logger.warn(
        `Race condition detected for idempotency key "${idempotencyKey}". Returning existing order.`,
      );

      const existingOrder = await this.ordersRepository.findByIdempotencyKey(idempotencyKey);

      if (existingOrder) {
        return existingOrder;
      }
    }

    // Handle timeout errors specifically
    if (pgError?.code === '57014' || pgError?.message?.includes('statement timeout')) {
      this.logger.error(
        `Statement timeout during order creation for user ${userId}. Consider optimizing query or increasing timeout.`,
      );
      throw new Error('Order creation timed out due to high load. Please try again in a moment.');
    }

    if (pgError?.code === '55P03' || pgError?.message?.includes('lock timeout')) {
      this.logger.error(`Lock timeout during order creation for user ${userId}.`);
      throw new ConflictException(
        'Unable to process order due to high concurrent activity. Please try again.',
      );
    }

    this.logger.error('Order creation failed, transaction rolled back', error);
    throw error;
  }

  private validateOrderItems(items: CreateOrderDto['items']): void {
    for (const item of items) {
      if (item.quantity <= 0) {
        throw new BadRequestException(
          `Quantity must be greater than zero for product ${item.productId}`,
        );
      }
    }
  }

  private async validateProductsExist(productIds: string[]): Promise<void> {
    const productsPreCheck = await this.productsRepository.findByIds(productIds);

    if (productsPreCheck.length !== productIds.length) {
      const foundIds = new Set(productsPreCheck.map((p) => p.id));
      const missingId = productIds.find((id) => !foundIds.has(id));
      throw new NotFoundException(`Product with ID "${missingId}" not found`);
    }
  }

  private validateStockAndAvailability(
    items: CreateOrderDto['items'],
    productMap: Map<string, Product>,
  ): void {
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
  }

  private async validateUser(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }
    return user;
  }
}
