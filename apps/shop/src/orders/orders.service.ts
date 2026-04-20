import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditAction, AuditLogService, AuditOutcome } from '@/audit-log';
import { AuditEventContext } from '@/audit-log/audit-log.types';
import { AuthUser } from '@/auth/types';
import { ProductsRepository } from '@/products/product.repository';

import { User } from '../users/user.entity';
import { MAX_ORDER_QUANTITY } from './constants';
import { CreateOrderDto, FindOrdersFilterDto } from './dto';
import {
  ORDER_CANCELLED_EVENT,
  ORDER_CREATED_EVENT,
  OrderCancelledEvent,
  OrderCreatedEvent,
} from './events';
import { Order, OrderStatus } from './order.entity';
import { OrderItemData, OrderItemsRepository, OrdersRepository } from './repositories';
import { OrderPublisherService, PgErrorMapperService } from './services';
import { OrdersQueryService, OrderStockService } from './services';
import { FindOrdersWithFiltersResponse } from './types';
import { assertOrderOwnership } from './utils';

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

    private readonly dataSource: DataSource,

    private readonly eventEmitter: EventEmitter2,
    private readonly auditLogService: AuditLogService,
    private readonly orderStockService: OrderStockService,
    private readonly ordersQueryService: OrdersQueryService,
    private readonly orderPublisherService: OrderPublisherService,
    private readonly pgErrorMapperService: PgErrorMapperService,
  ) {}

  /**
   * **Allowed statuses:** PENDING, PROCESSED, PAID
   * **Rejected statuses:** CANCELLED (409), CREATED (400)
   *
   * For PROCESSED/PAID orders with a paymentId, payment void/refund integration is deferred
   * to the payments plan. Stock is always restored.
   *
   * @param user - The authenticated user (sub used for ownership check; email for notification event)
   * @param orderId - The UUID of the order to cancel
   * @param context - Audit event context (correlationId, ip, userAgent) from the HTTP request
   * @returns Promise resolving to the updated Order entity
   * @throws {NotFoundException} If order not found or doesn't belong to user — HTTP 404
   * @throws {ConflictException} If order is already cancelled — HTTP 409
   * @throws {BadRequestException} If order is in CREATED (legacy) state — HTTP 400
   */
  async cancelOrder(user: AuthUser, orderId: string, context?: AuditEventContext): Promise<Order> {
    const { email: userEmail, sub: userId } = user;

    const order = await this.dataSource.transaction(async (manager) => {
      await manager.query('SET LOCAL statement_timeout = 30000');
      await manager.query('SET LOCAL lock_timeout = 10000');

      const orderRepo = manager.getRepository(Order);

      // Phase 1: status check only — no JOIN to items/products.
      // Early-exit guards run here; we avoid loading relations for rejected cancels.
      const orderShallow = await orderRepo.findOne({ where: { id: orderId } });

      assertOrderOwnership(orderShallow, userId);

      if (orderShallow.status === OrderStatus.CANCELLED) {
        throw new ConflictException(`Order "${orderId}" is already cancelled`);
      }

      if (orderShallow.status === OrderStatus.CREATED) {
        throw new BadRequestException(`Order "${orderId}" is in an invalid state for cancellation`);
      }

      // Phase 2: cancellation proceeds — load items + products for stock restore.
      const order = await orderRepo.findOne({
        relations: ['items', 'items.product'],
        where: { id: orderId },
      });

      if (!order) {
        throw new NotFoundException(`Order "${orderId}" not found`);
      }

      const productIds = order.items.map((item) => item.productId);
      await this.orderStockService.lockAndRestore(manager, order.items, productIds);

      order.status = OrderStatus.CANCELLED;
      await orderRepo.save(order);

      this.logger.log(`Order "${orderId}" cancelled, stock restored`);

      const updatedOrder = await this.ordersRepository.findByIdWithItemRelations(orderId, manager);
      if (!updatedOrder) {
        throw new Error('Failed to reload cancelled order');
      }

      return updatedOrder;
    });

    this.eventEmitter.emit(ORDER_CANCELLED_EVENT, new OrderCancelledEvent(order.id, userEmail));

    void this.auditLogService.log({
      action: AuditAction.ORDER_CANCELLED,
      actorId: userId,
      context,
      outcome: AuditOutcome.SUCCESS,
      targetId: order.id,
      targetType: 'Order',
    });

    return order;
  }

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
  async createOrder(
    userId: string,
    createOrderDto: CreateOrderDto,
    context?: AuditEventContext,
  ): Promise<Order> {
    const { idempotencyKey, items } = createOrderDto;

    const user = await this.validateUser(userId);
    this.validateOrderItems(items);

    const existingOrder = await this.checkIdempotency(idempotencyKey);
    if (existingOrder) {
      void this.auditLogService.log({
        action: AuditAction.ORDER_IDEMPOTENT_HIT,
        actorId: userId,
        context,
        outcome: AuditOutcome.SUCCESS,
        targetId: existingOrder.id,
        targetType: 'Order',
      });
      return existingOrder;
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    await this.validateProductsExist(productIds);

    try {
      const createdOrder = await this.executeOrderTransaction(createOrderDto, user, productIds);
      this.orderPublisherService.publishOrderProcessing(createdOrder, idempotencyKey);
      this.eventEmitter.emit(
        ORDER_CREATED_EVENT,
        new OrderCreatedEvent(createdOrder.id, user.email),
      );

      void this.auditLogService.log({
        action: AuditAction.ORDER_CREATED,
        actorId: userId,
        context,
        outcome: AuditOutcome.SUCCESS,
        targetId: createdOrder.id,
        targetType: 'Order',
      });

      return createdOrder;
    } catch (error: unknown) {
      try {
        return await this.pgErrorMapperService.handleCreationError(error, userId, idempotencyKey);
      } catch (finalError) {
        void this.auditLogService.log({
          action: AuditAction.ORDER_CREATION_FAILED,
          actorId: userId,
          context,
          outcome: AuditOutcome.FAILURE,
          targetType: 'Order',
        });
        throw finalError;
      }
    }
  }

  async findOrdersWithFilters(
    userId: string,
    params: FindOrdersFilterDto,
  ): Promise<FindOrdersWithFiltersResponse> {
    return await this.ordersQueryService.findOrdersWithFilters(userId, params);
  }

  async getOrderById(userId: string, orderId: string): Promise<Order> {
    return await this.ordersQueryService.getOrderById(userId, orderId);
  }

  async getOrderPayment(
    userId: string,
    orderId: string,
  ): Promise<{ paymentId: string; status: string }> {
    return await this.ordersQueryService.getOrderPayment(userId, orderId);
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
    const { idempotencyKey, items, shipping } = createOrderDto;

    const createdOrder = await this.dataSource.transaction(async (manager) => {
      await manager.query('SET LOCAL statement_timeout = 30000');
      await manager.query('SET LOCAL lock_timeout = 10000');

      const productMap = await this.orderStockService.lockValidateAndDecrement(
        manager,
        items,
        productIds,
      );

      const order = await this.ordersRepository.createOrder(manager, {
        idempotencyKey,
        shippingCity: shipping?.city ?? user.city,
        shippingCountry: shipping?.country ?? user.country,
        shippingFirstName: shipping?.firstName ?? user.firstName,
        shippingLastName: shipping?.lastName ?? user.lastName,
        shippingPhone: shipping?.phone ?? user.phone,
        shippingPostcode: shipping?.postcode ?? user.postcode,
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

      order.items = await this.orderItemsRepository.createOrderItems(manager, orderItemsData);
      order.user = user;

      this.logger.log(`Order created successfully: ${order.id}`);

      return order;
    });

    return createdOrder;
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

  private async validateUser(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }
    return user;
  }
}
