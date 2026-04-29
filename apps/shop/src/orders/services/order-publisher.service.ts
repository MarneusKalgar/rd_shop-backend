import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { getRequestContext } from '@/core/async-storage';
import { WorkerMetricsService } from '@/observability';
import { ORDER_PROCESS_QUEUE } from '@/rabbitmq/constants';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';

import { OrderProcessMessageDto } from '../dto';
import { Order } from '../order.entity';

/**
 * Publishes order processing messages to RabbitMQ.
 *
 * Reads `RABBITMQ_SIMULATE_DUPLICATE_MESSAGE_ID` from config to optionally force a
 * specific messageId — useful for integration-test idempotency scenarios.
 */
@Injectable()
export class OrderPublisherService {
  private readonly logger = new Logger(OrderPublisherService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly rabbitmqService: RabbitMQService,
    private readonly workerMetricsService: WorkerMetricsService,
  ) {}

  /**
   * @param order - The newly created order (only `id` is used)
   * @param correlationId - Optional correlation ID (typically the idempotencyKey)
   */
  publishOrderProcessing(order: Order, correlationId?: string): void {
    const messageIdFromConfig = this.configService.get<string>(
      'RABBITMQ_SIMULATE_DUPLICATE_MESSAGE_ID',
    );

    const forcedMessageId =
      messageIdFromConfig && messageIdFromConfig.length > 0 ? messageIdFromConfig : undefined;
    const trafficSource = getRequestContext()?.trafficSource;

    const message = new OrderProcessMessageDto(
      order.id,
      correlationId,
      forcedMessageId,
      trafficSource,
    );

    this.rabbitmqService.publish(
      ORDER_PROCESS_QUEUE,
      message as unknown as Record<string, unknown>,
      { messageId: message.messageId },
    );
    this.workerMetricsService.recordRabbitMqPublish({
      queue: ORDER_PROCESS_QUEUE,
      trafficSource: message.trafficSource,
    });

    this.logger.log(`Order processing message published for order: ${order.id}`);
  }
}
