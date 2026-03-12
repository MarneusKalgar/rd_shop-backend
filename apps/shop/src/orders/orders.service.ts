import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { PaymentsGrpcService } from '@/payments/payments-grpc.service';
import { ProductsRepository } from '@/products/product.repository';
import { ORDER_PROCESS_QUEUE } from '@/rabbitmq/constants';
import { ProcessedMessage } from '@/rabbitmq/processed-message.entity';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { simulateExternalService } from '@/utils';

import { Product } from '../products/product.entity';
import { User } from '../users/user.entity';
import { DEFAULT_ORDERS_LIMIT, MAX_ORDER_QUANTITY, ORDER_WORKER_SCOPE } from './constants';
import { CreateOrderDto, FindOrdersFilterDto, OrderProcessMessageDto } from './dto';
import { Order, OrderStatus } from './order.entity';
import {
  OrderItemData,
  OrderItemsRepository,
  OrdersQueryBuilder,
  OrdersRepository,
} from './repositories';
import { FindOrdersWithFiltersResponse } from './types';
import { getTotalSumInCents } from './utils';

/**
 * Service responsible for order creation and querying with transaction safety.
 *
 * **Concurrency Strategy:**
 * - Uses pessimistic locking (`FOR UPDATE`) to prevent stock oversell
 * - Acquires product locks within database transactions
 * - Timeout protection: 30s statement timeout, 10s lock timeout
 *
 * **Transaction Flow:**
 * 1. Pre-validate user and products (outside transaction)
 * 2. Begin database transaction
 * 3. Acquire pessimistic locks on products
 * 4. Validate stock availability
 * 5. Update product stock
 * 6. Create order and order items
 * 7. Commit (releases locks automatically)
 *
 * **Error Handling:**
 * - HTTP 400: Invalid input (quantity ≤ 0)
 * - HTTP 404: User or product not found
 * - HTTP 409: Insufficient stock, product inactive, or lock contention
 * - HTTP 500: Database timeouts or deadlocks
 *
 * @see {@link createOrder} for order creation with idempotency
 * @see {@link findOrdersWithFilters} for order querying with pagination
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly ordersRepository: OrdersRepository,
    private readonly productsRepository: ProductsRepository,
    private readonly orderItemsRepository: OrderItemsRepository,
    private readonly rabbitmqService: RabbitMQService,

    private readonly ordersQueryBuilder: OrdersQueryBuilder,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,

    private readonly paymentsGrpcService: PaymentsGrpcService,
  ) {}

  /**
   * Creates a new order with idempotency support and transaction safety.
   *
   * **Concurrency Control:**
   * Uses pessimistic write locking (`FOR UPDATE`) to prevent oversell in concurrent scenarios.
   * Locks are acquired on product rows within a database transaction, ensuring no other transaction
   * can modify stock until the current transaction commits or rolls back.
   *
   * **Idempotency:**
   * If `idempotencyKey` is provided and an order with that key already exists, returns the existing
   * order instead of creating a new one. This prevents duplicate orders from double-submissions.
   *
   * **Transaction Safety:**
   * All database operations (product locking, stock updates, order creation) occur within a single
   * transaction. If any step fails, all changes are rolled back automatically.
   *
   * **Timeout Configuration:**
   * - Statement timeout: 30 seconds (prevents runaway queries)
   * - Lock timeout: 10 seconds (prevents indefinite lock waits)
   *
   * **Performance:**
   * - Pre-validation occurs before transaction to fail fast
   * - Transaction duration typically < 50ms
   * - Lock duration matches transaction duration
   *
   * @param createOrderDto - Order creation data containing userId, items, and optional idempotencyKey
   * @returns Promise resolving to created Order entity with all relations loaded
   *
   * @throws {BadRequestException} Invalid quantity (≤0 or >1000) - HTTP 400
   * @throws {NotFoundException} User or product doesn't exist - HTTP 404
   * @throws {ConflictException} Insufficient stock, product inactive, or lock timeout - HTTP 409
   * @throws {Error} Database timeouts (statement or deadlock) - HTTP 500
   *
   * @example
   * ```typescript
   * const order = await ordersService.createOrder({
   *   idempotencyKey: 'client-generated-uuid',
   *   items: [
   *     { productId: 'product-uuid-1', quantity: 2 },
   *     { productId: 'product-uuid-2', quantity: 1 }
   *   ]
   * });
   *
   * @see {@link executeOrderTransaction} for transaction implementation
   * @see {@link handleOrderCreationPgErrors} for error handling
   */

  async createOrder(userId: string, createOrderDto: CreateOrderDto): Promise<Order> {
    const { idempotencyKey, items } = createOrderDto;

    const user = await this.validateUser(userId);
    this.validateOrderItems(items);

    const existingOrder = await this.checkIdempotency(idempotencyKey);
    if (existingOrder) {
      return existingOrder;
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    await this.validateProductsExist(productIds);

    try {
      const createdOrder = await this.executeOrderTransaction(createOrderDto, user, productIds);
      this.publishOrderProcessingMessage(createdOrder, idempotencyKey);
      return createdOrder;
    } catch (error: unknown) {
      return await this.handleOrderCreationPgErrors(error, userId, idempotencyKey);
    }
  }

  /**
   * Retrieves an order by its ID with all relations loaded.
   *
   * @param userId - The UUID of the user
   * @param orderId - The UUID of the order to retrieve
   * @returns Promise resolving to Order entity with items, products, and user
   * @throws {NotFoundException} If order doesn't exist - HTTP 404
   */
  async getOrderById(userId: string, orderId: string): Promise<Order> {
    const order = await this.ordersRepository.findByIdWithRelations(orderId);

    this.assertOrderOwnership(order, userId);

    return order;
  }

  // eslint-disable-next-line perfectionist/sort-classes
  async findOrdersWithFilters(
    userId: string,
    params: FindOrdersFilterDto,
  ): Promise<FindOrdersWithFiltersResponse> {
    const { cursor, limit = DEFAULT_ORDERS_LIMIT } = params;

    const subquery = this.ordersQueryBuilder.buildOrderIdsSubquery(userId, params);

    if (cursor) {
      const cursorOrder = await this.ordersRepository.findByCursor(cursor);
      if (!cursorOrder) {
        throw new BadRequestException(`Invalid cursor: no order found for id "${cursor}"`);
      }

      this.ordersQueryBuilder.applyCursorPagination(subquery, cursorOrder);
    }

    // Apply ordering and limit to the subquery to get the correct slice of orders for pagination
    this.ordersQueryBuilder.applyOrderingAndLimit(subquery, limit + 1);

    // Using getRawMany() here to match cursor pagination logic
    // and avoid performance issues with getManyAndCount() on complex queries.
    // Total count can be added in the future if needed.
    const paginatedOrders: { createdAt: Date; id: string }[] = await subquery.getRawMany();
    if (!paginatedOrders.length) {
      return { nextCursor: null, orders: [] };
    }

    const hasNextPage = paginatedOrders.length > limit;
    const pageSlice = hasNextPage ? paginatedOrders.slice(0, limit) : paginatedOrders;

    const orderIds = pageSlice.map((row) => row.id);
    const mainQuery = this.ordersQueryBuilder.buildMainQuery(orderIds);
    const orders = await mainQuery.getMany();

    const nextCursor = hasNextPage ? orders[orders.length - 1].id : null;

    return { nextCursor, orders };
  }

  /**
   * Retrieves payment information for an order.
   *
   * @param userId - The UUID of the user
   * @param orderId - The UUID of the order
   * @returns Promise resolving to payment details (paymentId and status)
   * @throws {NotFoundException} If order doesn't exist - HTTP 404
   * @throws {BadRequestException} If order has no associated payment - HTTP 400
   * @throws {Error} If payment service is unavailable - HTTP 500
   */
  async getOrderPayment(
    userId: string,
    orderId: string,
  ): Promise<{ paymentId: string; status: string }> {
    const order = await this.ordersRepository.findByIdWithRelations(orderId);

    this.assertOrderOwnership(order, userId);

    if (!order.paymentId) {
      throw new BadRequestException(`Order "${orderId}" has no associated payment`);
    }

    try {
      const paymentStatus = await this.paymentsGrpcService.getPaymentStatus(order.paymentId);
      return paymentStatus;
    } catch (error) {
      this.logger.error(`Failed to fetch payment status for order ${orderId}`, error);
      throw new Error('Failed to retrieve payment information');
    }
  }

  /**
   * Processes an order within a transaction after receiving a RabbitMQ message.
   *
   * **Transaction Steps:**
   * 1. Idempotency check — skip if message already processed
   * 2. Fetch order by ID
   * 3. Simulate external service call (300–500ms)
   * 4. Update order status to PROCESSED
   * 5. Insert ProcessedMessage record (idempotency guard)
   * 6. Commit
   *
   * Caller (worker) must ack the message only after this method resolves successfully.
   *
   * @param messageId - Unique RabbitMQ message ID
   * @param orderId - Order UUID to process
   * @param correlationId - Optional correlation ID (idempotencyKey from producer)
   * @throws {Error} If order not found or DB error occurs — worker should nack
   */
  async processOrderMessage(payload: OrderProcessMessageDto): Promise<void> {
    const { correlationId, messageId, orderId } = payload;
    const simulateFailure: boolean =
      this.configService.get<string>('RABBITMQ_SIMULATE_FAILURE') === 'true';
    const simulateDelay: number = this.configService.get<number>('RABBITMQ_SIMULATE_DELAY') ?? 0;

    const processedOrder = await this.dataSource.transaction(async (manager) => {
      const processedMessageRepository = manager.getRepository(ProcessedMessage);

      const alreadyProcessed = await processedMessageRepository.findOne({
        where: { messageId },
      });

      if (alreadyProcessed) {
        this.logger.warn(`Message [messageId: ${messageId}] already processed, skipping`);
        return;
      }

      try {
        await manager.insert(ProcessedMessage, {
          idempotencyKey: correlationId ?? null,
          messageId,
          orderId: orderId ?? null,
          processedAt: new Date(),
          scope: ORDER_WORKER_SCOPE,
        });
      } catch (error) {
        const pgError = error as { code?: string };
        if (String(pgError?.code) === '23505') {
          return;
        }
        this.logger.error(`Failed to insert ProcessedMessage for [messageId: ${messageId}]`, error);
        throw new Error('Failed to acquire idempotency lock');
      }

      const orderRepository = manager.getRepository(Order);

      const order = await orderRepository.findOne({ where: { id: orderId } });

      if (!order) {
        throw new NotFoundException(`Order "${orderId}" not found`);
      }

      if (order.status === OrderStatus.PROCESSED) {
        this.logger.warn(`Order "${orderId}" already in PROCESSED state, skipping`);
        return;
      }

      if (order.status !== OrderStatus.PENDING) {
        this.logger.warn(`Order "${orderId}" has unexpected status "${order.status}", skipping`);
        return;
      }

      if (simulateFailure) {
        this.logger.warn(`Simulating processing failure for messageId: ${messageId}`);
        throw new Error('Simulated processing failure');
      }

      if (simulateDelay) {
        this.logger.warn(
          `Simulating processing delay of ${simulateDelay}ms for messageId: ${messageId}`,
        );
        await simulateExternalService(simulateDelay);
      }

      order.status = OrderStatus.PROCESSED;
      await orderRepository.save(order);

      this.logger.log(`Order "${orderId}" marked as PROCESSED`);

      return order;
    });

    if (processedOrder && !processedOrder.paymentId) {
      await this.authorizePayment(processedOrder);
    }
  }

  private assertOrderOwnership(order: null | Order, userId: string): asserts order is Order {
    if (order?.userId !== userId) {
      throw new NotFoundException(`Order with ID "${order?.id ?? 'unknown'}" not found`);
    }
  }

  private async authorizePayment(order: Order): Promise<void> {
    const orderWithItems = await this.ordersRepository.findByIdWithRelations(order.id);

    if (!orderWithItems) {
      this.logger.error(`Order "${order.id}" not found for payment authorization`);
      throw new NotFoundException(`Order "${order.id}" not found for payment authorization`);
    }

    const amount = getTotalSumInCents(orderWithItems);

    try {
      const response = await this.paymentsGrpcService.authorize({
        amount,
        currency: 'USD',
        orderId: order.id,
      });

      if (response.paymentId) {
        await this.ordersRepository
          .getRepository()
          .update({ id: order.id }, { paymentId: response.paymentId, status: OrderStatus.PAID });

        this.logger.log(
          `Payment authorized: paymentId=${response.paymentId}, status=${response.status} for order=${order.id}`,
        );
      }
    } catch (error) {
      this.logger.error(`Payment authorization failed for order=${order.id}`, error);
      throw error;
    }
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

  /**
   * Executes the order creation transaction with pessimistic locking.
   *
   * **Transaction Steps:**
   * 1. Set local transaction timeouts (30s statement, 10s lock)
   * 2. Acquire pessimistic write locks on products (`FOR UPDATE`)
   * 3. Validate stock availability and product active status
   * 4. Decrement product stock in memory
   * 5. Persist stock updates to database
   * 6. Create order entity
   * 7. Create order item entities
   * 8. Re-fetch order with all relations
   * 9. Commit transaction (releases locks)
   *
   * **Lock Behavior:**
   * - Products locked with `pessimistic_write` (PostgreSQL `FOR UPDATE`)
   * - Other transactions attempting to lock same products will wait
   * - Lock released automatically on commit or rollback
   * - Maximum wait time: 10 seconds (lock_timeout)
   *
   * **Atomicity Guarantee:**
   * All changes commit together or none commit at all. No partial order creation possible.
   *
   * @param createOrderDto - Order creation data
   * @param user - Validated User entity
   * @param productIds - Array of product UUIDs to lock
   * @returns Promise resolving to created Order with all relations
   * @throws {NotFoundException} If products disappear during transaction
   * @throws {ConflictException} If stock insufficient or product inactive
   * @throws {QueryFailedError} If database errors occur (timeouts, deadlocks)
   * @private
   */
  private async executeOrderTransaction(
    createOrderDto: CreateOrderDto,
    user: User,
    productIds: string[],
  ): Promise<Order> {
    const { idempotencyKey, items } = createOrderDto;

    const createdOrder = await this.dataSource.transaction(async (manager) => {
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
        userId: user.id,
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

      const createdOrder = await this.ordersRepository.findByIdWithRelations(order.id, manager);

      if (!createdOrder) {
        throw new Error('Order creation failed');
      }

      this.logger.log(`Order created successfully: ${createdOrder.id}`);

      return createdOrder;
    });

    this.publishOrderProcessingMessage(createdOrder, idempotencyKey);

    return createdOrder;
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

  /**
   * Publishes order processing message to RabbitMQ after successful order creation.
   *
   * Message is published with persistent delivery mode to survive broker restarts.
   * Publishing failures are logged but don't fail the order creation to maintain
   * service availability. Consider implementing retry logic or outbox pattern for
   * critical messaging requirements.
   *
   * @param order - Created order entity
   * @param correlationId - Optional correlation ID (uses idempotencyKey if provided)
   * @private
   */
  private publishOrderProcessingMessage(order: Order, correlationId?: string) {
    const messageIdFromConfig = this.configService.get<string>(
      'RABBITMQ_SIMULATE_DUPLICATE_MESSAGE_ID',
    );

    const forcedMessageId =
      messageIdFromConfig && messageIdFromConfig.length > 0 ? messageIdFromConfig : undefined;

    const message = new OrderProcessMessageDto(order.id, correlationId, forcedMessageId);

    this.rabbitmqService.publish(
      ORDER_PROCESS_QUEUE,
      message as unknown as Record<string, unknown>,
      { messageId: message.messageId },
    );

    this.logger.log(`Order processing message published for order: ${order.id}`);
  }

  private validateOrderItems(items: CreateOrderDto['items']): void {
    for (const item of items) {
      if (item.quantity <= 0) {
        throw new BadRequestException(
          `Quantity must be greater than zero for product ${item.productId}`,
        );
      }

      if (item.quantity > MAX_ORDER_QUANTITY) {
        throw new BadRequestException(
          `Quantity cannot exceed ${MAX_ORDER_QUANTITY} for product ${item.productId}`,
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

  private async validateUser(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }
    return user;
  }
}
