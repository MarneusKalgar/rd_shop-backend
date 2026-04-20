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
import { User } from '@/users/user.entity';

import { CreateOrderDto } from '../dto';
import {
  ORDER_CANCELLED_EVENT,
  ORDER_CREATED_EVENT,
  OrderCancelledEvent,
  OrderCreatedEvent,
} from '../events';
import { Order, OrderStatus } from '../order.entity';
import { OrderItemData, OrderItemsRepository, OrdersRepository } from '../repositories';
import { assertOrderOwnership, validateOrderItems } from '../utils';
import { OrderPublisherService } from './order-publisher.service';
import { OrderStockService } from './order-stock.service';
import { PgErrorMapperService } from './pg-error-mapper.service';

/**
 * Handles the command side of the orders domain: order creation and cancellation.
 *
 * Owns all write operations, transaction logic, stock mutations, and event emission
 * for the order lifecycle's command path. Called by OrdersService (facade),
 * OrdersController, and CartService.
 *
 * **createOrder flow:**
 * 1. Validate user + items (outside transaction, fast-fail)
 * 2. Idempotency short-circuit — return existing order if key already used
 * 3. Pre-check product existence (outside transaction)
 * 4. Begin transaction: lock products (FOR UPDATE), validate stock, decrement, create order + items
 * 5. Publish RabbitMQ message, emit ORDER_CREATED event, write audit log
 *
 * **cancelOrder flow:**
 * 1. Begin transaction: load order (shallow), assert ownership + status guards
 * 2. Load items + products, restore stock, set CANCELLED, reload with relations
 * 3. Emit ORDER_CANCELLED event, write audit log
 */
@Injectable()
export class OrdersCommandService {
  private readonly logger = new Logger(OrdersCommandService.name);

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
    private readonly orderPublisherService: OrderPublisherService,
    private readonly pgErrorMapperService: PgErrorMapperService,
  ) {}

  async cancelOrder(user: AuthUser, orderId: string, context?: AuditEventContext): Promise<Order> {
    const { email: userEmail, sub: userId } = user;

    const order = await this.dataSource.transaction(async (manager) => {
      await manager.query('SET LOCAL statement_timeout = 30000');
      await manager.query('SET LOCAL lock_timeout = 10000');

      const orderRepo = manager.getRepository(Order);

      const orderShallow = await orderRepo.findOne({ where: { id: orderId } });

      assertOrderOwnership(orderShallow, userId);

      if (orderShallow.status === OrderStatus.CANCELLED) {
        throw new ConflictException(`Order "${orderId}" is already cancelled`);
      }

      if (orderShallow.status === OrderStatus.CREATED) {
        throw new BadRequestException(`Order "${orderId}" is in an invalid state for cancellation`);
      }

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

  async createOrder(
    userId: string,
    createOrderDto: CreateOrderDto,
    context?: AuditEventContext,
  ): Promise<Order> {
    const { idempotencyKey, items } = createOrderDto;

    const user = await this.validateUser(userId);
    validateOrderItems(items);

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

  private async executeOrderTransaction(
    createOrderDto: CreateOrderDto,
    user: User,
    productIds: string[],
  ): Promise<Order> {
    const { idempotencyKey, items, shipping } = createOrderDto;

    return await this.dataSource.transaction(async (manager) => {
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
