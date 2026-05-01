import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import { AuditAction, AuditLogService, AuditOutcome } from '@/audit-log';
import { OrdersMetricsService } from '@/observability';
import { PaymentsGrpcService } from '@/payments/payments-grpc.service';
import { ProcessedMessage } from '@/rabbitmq/processed-message.entity';
import { simulateExternalService } from '@/utils';

import { ORDER_WORKER_SCOPE } from '../constants';
import { OrderProcessMessageDto } from '../dto';
import { ORDER_PAID_EVENT, OrderPaidEvent } from '../events';
import { Order, OrderStatus } from '../order.entity';
import { OrdersRepository } from '../repositories';
import { getTotalSumInCents } from '../utils';

/**
 * Handles the worker-side order processing pipeline: idempotent message consumption,
 * status transitions, and payment authorization via gRPC.
 *
 * **Processing flow (processOrderMessage):**
 * 1. SELECT from processed_messages — fast-path skip if duplicate
 * 2. INSERT into processed_messages — acquire idempotency lock (23505 = safe duplicate)
 * 3. Fetch order — guard on PENDING status
 * 4. Optional failure / delay simulation via env
 * 5. UPDATE order → PROCESSED, commit
 * 6. After transaction: call authorizePayment if order has no paymentId yet
 *
 * **authorizePayment:**
 * - Re-fetches order with relations to compute amount + user email
 * - On success: UPDATE → PAID, emit ORDER_PAID_EVENT, audit log
 * - On failure: audit log ORDER_PAYMENT_FAILED, re-throw (worker nacks and retries)
 */
@Injectable()
export class OrderProcessingService {
  private readonly logger = new Logger(OrderProcessingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly ordersRepository: OrdersRepository,
    private readonly paymentsGrpcService: PaymentsGrpcService,
    private readonly auditLogService: AuditLogService,
    private readonly eventEmitter: EventEmitter2,
    private readonly ordersMetricsService: OrdersMetricsService,
  ) {}

  /**
   * Authorizes payment for a PROCESSED order via the payments gRPC microservice.
   *
   * Re-fetches the order with all relations (items, products, user) to compute the total amount
   * and obtain the user email for the ORDER_PAID event.
   *
   * @param order - The PROCESSED order (only `id` and `userId` are required at call-time)
   * @throws {NotFoundException} If the order cannot be reloaded from the DB
   * @throws {Error} Re-throws any gRPC or DB error so the worker can nack and retry
   */
  async authorizePayment(order: Order): Promise<void> {
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
        this.ordersMetricsService.recordOrderCompleted({ finalStatus: OrderStatus.PAID });

        this.logger.log(
          `Payment authorized: paymentId=${response.paymentId}, status=${response.status} for order=${order.id}`,
        );

        void this.auditLogService.log({
          action: AuditAction.ORDER_PAYMENT_AUTHORIZED,
          actorId: order.userId,
          outcome: AuditOutcome.SUCCESS,
          targetId: order.id,
          targetType: 'Order',
        });

        this.eventEmitter.emit(
          ORDER_PAID_EVENT,
          new OrderPaidEvent(order.id, orderWithItems.user.email),
        );
      }
    } catch (error) {
      this.logger.error(`Payment authorization failed for order=${order.id}`, error);
      void this.auditLogService.log({
        action: AuditAction.ORDER_PAYMENT_FAILED,
        actorId: order.userId,
        outcome: AuditOutcome.FAILURE,
        targetId: order.id,
        targetType: 'Order',
      });
      throw error;
    }
  }

  /**
   * Processes an order after receiving a RabbitMQ message, then authorizes payment.
   *
   * @param payload - OrderProcessMessageDto containing messageId, orderId, correlationId
   * @throws {NotFoundException} If order not found — worker should nack
   * @throws {Error} If DB error or payment authorization fails — worker should nack
   */
  async processOrderMessage(payload: OrderProcessMessageDto): Promise<void> {
    const { correlationId, messageId, orderId } = payload;
    const simulateFailure: boolean =
      this.configService.get<string>('RABBITMQ_SIMULATE_FAILURE') === 'true';
    const simulateDelay: number = this.configService.get<number>('RABBITMQ_SIMULATE_DELAY') ?? 0;
    const disablePaymentsAuthorization: boolean =
      this.configService.get<string>('RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION') === 'true';

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

    if (disablePaymentsAuthorization) {
      this.logger.warn(
        `Payments authorization is disabled via configuration. Skipping payment authorization for orderId: ${orderId}`,
      );
      return;
    }

    if (processedOrder && !processedOrder.paymentId) {
      await this.authorizePayment(processedOrder);
    }
  }
}
