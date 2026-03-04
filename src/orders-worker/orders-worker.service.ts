import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Channel, ConsumeMessage } from 'amqplib';

import { OrderProcessMessageDto } from '@/orders/dto';
import { OrdersService } from '@/orders/orders.service';
import {
  MAX_RETRY_ATTEMPTS,
  ORDER_DLQ,
  ORDER_PROCESS_QUEUE,
  RETRY_DELAY_MS,
} from '@/rabbitmq/constants';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';

/**
 * Worker service responsible for consuming and processing order messages from RabbitMQ.
 *
 * **Responsibilities:**
 * - Subscribes to the `order.process` queue on startup
 * - Delegates processing to {@link OrdersService.processOrderMessage}
 * - Performs manual ack/nack — ack only after successful DB commit
 * - Retries failed messages up to {@link MAX_RETRY_ATTEMPTS} times with a fixed delay
 * - Routes exhausted messages to the dead-letter queue (`orders.dlq`)
 * - Gracefully stops consuming on module teardown
 *
 * **Retry Policy:**
 * - Max attempts: `MAX_RETRY_ATTEMPTS` (re-published with incremented `attempt` counter)
 * - Delay between retries: `RETRY_DELAY_MS`
 * - After limit: message is published to `ORDER_DLQ` and acked
 */
@Injectable()
export class OrderWorkerService implements OnModuleDestroy, OnModuleInit {
  private consumerTag: null | string = null;
  private readonly logger = new Logger(OrderWorkerService.name);

  constructor(
    private readonly rabbitmqService: RabbitMQService,
    private readonly ordersService: OrdersService,
  ) {}

  /** Cancels the active consumer when the module is torn down. */
  async onModuleDestroy() {
    await this.stopConsuming();
  }

  /** Starts consuming from `order.process` queue when the module is initialized. */
  async onModuleInit() {
    await this.startConsuming();
  }

  /**
   * Core message handler for the `order.process` queue.
   *
   * **Processing flow:**
   * 1. Parse the raw message buffer into {@link OrderProcessMessageDto}
   * 2. Delegate to {@link OrdersService.processOrderMessage} (runs in a DB transaction)
   * 3. On success — `channel.ack(msg)`
   * 4. On failure — retry if `attempt < MAX_RETRY_ATTEMPTS`, otherwise publish to DLQ
   * 5. Unparseable messages are immediately routed to DLQ
   *
   * Ack is always performed **after** the DB transaction commit or after scheduling a retry/DLQ.
   *
   * @param msg - Raw RabbitMQ message
   * @param channel - AMQP channel used for acking
   */
  private async handleMessage(msg: ConsumeMessage, channel: Channel): Promise<void> {
    let payload: OrderProcessMessageDto;

    try {
      payload = JSON.parse(msg.content.toString('utf-8')) as OrderProcessMessageDto;
    } catch (error) {
      this.logger.error(
        `[result: dlq] Failed to parse message, sending to dead-letter, reason: ${(error as Error)?.message}`,
      );
      this.publishToDlq({ attempt: 0, raw: msg.content.toString('base64') });
      channel.ack(msg);
      return;
    }

    if (!payload.messageId || !payload.orderId) {
      this.logger.error(
        `[result: dlq] Invalid payload — missing required fields (messageId: ${payload.messageId}, orderId: ${payload.orderId}), routing to DLQ`,
      );
      this.publishToDlq({ ...payload, attempt: 0 });
      channel.ack(msg);
      return;
    }

    if (typeof payload.attempt !== 'number' || !Number.isFinite(payload.attempt)) {
      this.logger.warn(
        `[result: warn] Invalid attempt value "${payload.attempt}" for [messageId: ${payload.messageId}], defaulting to 1`,
      );
      payload = { ...payload, attempt: 1 };
    }

    const { messageId, orderId } = payload;
    this.logger.log(
      `Received order.process message [messageId: ${messageId}, orderId: ${orderId}, attempt: ${payload.attempt}]`,
    );

    try {
      await this.ordersService.processOrderMessage(payload);
      channel.ack(msg);
      this.logger.log(
        `[result: success] Acked message [messageId: ${messageId}, orderId: ${orderId}, attempt: ${payload.attempt}] processed successfully`,
      );
      return;
    } catch (error) {
      this.logger.error(
        `[result: error] Failed to process message [messageId: ${messageId}, orderId: ${orderId}, attempt: ${payload.attempt}] reason: ${(error as Error)?.message}`,
        error,
      );
    }

    if (payload.attempt < MAX_RETRY_ATTEMPTS) {
      await this.retryMessage(payload);
      channel.ack(msg);
      this.logger.warn(
        `[result: retry] Scheduled retry [messageId: ${messageId}, orderId: ${orderId}, attempt: ${payload.attempt}, nextAttempt: ${payload.attempt + 1}]`,
      );
      return;
    }

    this.publishToDlq(payload);
    channel.ack(msg);
    this.logger.error(
      `[result: dlq] [messageId: ${messageId}, orderId: ${orderId}, attempt: ${payload.attempt}] reason: max retries (${MAX_RETRY_ATTEMPTS}) reached`,
    );
  }

  /**
   * Publishes a failed message payload to the dead-letter queue (`orders.dlq`).
   * Preserves the original `messageId` for traceability.
   *
   * @param payload - The message payload to forward (may include a `raw` base64 field for unparseable messages)
   */
  private publishToDlq(payload: OrderProcessMessageDto): void {
    this.rabbitmqService.publish(ORDER_DLQ, payload, {
      messageId: payload.messageId,
    });
  }

  /**
   * Schedules a retry by re-publishing the message to `order.process` with an incremented `attempt` counter.
   * Waits `RETRY_DELAY_MS` before publishing to avoid tight retry loops.
   *
   * @param payload - Original message payload with current `attempt` value
   */
  private async retryMessage(payload: OrderProcessMessageDto): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

    const retryPayload: OrderProcessMessageDto = {
      ...payload,
      attempt: payload.attempt + 1,
    };

    this.rabbitmqService.publish(ORDER_PROCESS_QUEUE, retryPayload, {
      messageId: retryPayload.messageId,
    });
  }

  /**
   * Registers a consumer on the `order.process` queue and stores the consumer tag
   * for later cancellation.
   *
   * @throws {Error} If the RabbitMQ channel is not initialized
   */
  private async startConsuming(): Promise<void> {
    const { consumerTag } = await this.rabbitmqService.consume(
      ORDER_PROCESS_QUEUE,
      async (msg, channel) => {
        await this.handleMessage(msg, channel);
      },
    );

    this.consumerTag = consumerTag;
    this.logger.log(`Started consuming queue "${ORDER_PROCESS_QUEUE}" [tag: ${consumerTag}]`);
  }

  /**
   * Cancels the active consumer if one exists, preventing new messages from being delivered.
   * Called automatically during module teardown.
   */
  private async stopConsuming(): Promise<void> {
    if (this.consumerTag) {
      await this.rabbitmqService.cancelConsumer(this.consumerTag);
      this.consumerTag = null;
    }
  }
}
