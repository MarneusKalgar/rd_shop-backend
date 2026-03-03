import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';

import { OrderProcessMessageDto } from '@/orders/dto';
import { OrdersService } from '@/orders/orders.service';
import {
  MAX_RETRY_ATTEMPTS,
  ORDER_DLQ,
  ORDER_PROCESS_QUEUE,
  RabbitMQService,
  RETRY_DELAY_MS,
} from '@/rabbitmq/rabbitmq.service';

@Injectable()
export class OrderWorkerService implements OnModuleDestroy, OnModuleInit {
  private consumerTag: null | string = null;
  private readonly logger = new Logger(OrderWorkerService.name);

  constructor(
    private readonly rabbitmqService: RabbitMQService,
    private readonly ordersService: OrdersService,
  ) {}

  async onModuleDestroy() {
    await this.stopConsuming();
  }

  async onModuleInit() {
    await this.startConsuming();
  }

  private async handleMessage(msg: ConsumeMessage): Promise<void> {
    const channel = this.rabbitmqService.channel;
    if (!channel) return;

    let payload: OrderProcessMessageDto;

    try {
      payload = JSON.parse(msg.content.toString('utf-8')) as OrderProcessMessageDto;
    } catch {
      this.logger.error('Failed to parse message, sending to dead-letter');
      this.publishToDlq({ attempt: 0, raw: msg.content.toString('base64') });
      channel.ack(msg); // ack to remove from queue, but log for manual inspection
      return;
    }

    const { messageId, orderId } = payload;
    this.logger.log(
      `Received order.process message [messageId: ${messageId}, orderId: ${orderId}]`,
    );

    try {
      await this.ordersService.processOrderMessage(payload);
      channel.ack(msg); // ack only after successful commit
      this.logger.log(`Acked message [messageId: ${messageId}]`);
      return;
    } catch (error) {
      this.logger.error(
        `Failed to process message [messageId: ${messageId}, orderId: ${orderId}, attempt: ${payload.attempt}]`,
        error,
      );
    }

    if (payload.attempt < MAX_RETRY_ATTEMPTS) {
      await this.retryMessage(payload);
      channel.ack(msg);
      this.logger.warn(
        `Scheduled retry [messageId: ${messageId}, orderId: ${orderId}, attempt: ${payload.attempt}, nextAttempt: ${payload.attempt + 1}]`,
      );
      return;
    }

    this.publishToDlq(payload);
    channel.ack(msg);
    this.logger.error(
      `Max retry attempts (${MAX_RETRY_ATTEMPTS}) reached for [messageId: ${messageId}, orderId: ${orderId}, attempt: ${payload.attempt}]. Moved to DLQ.`,
    );
  }

  private publishToDlq(payload: OrderProcessMessageDto): void {
    this.rabbitmqService.publish(ORDER_DLQ, payload as unknown as Record<string, unknown>, {
      messageId: payload.messageId,
    });
  }

  private async retryMessage(payload: OrderProcessMessageDto): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

    const retryPayload: OrderProcessMessageDto = {
      ...payload,
      attempt: payload.attempt + 1,
    };

    this.rabbitmqService.publish(
      ORDER_PROCESS_QUEUE,
      retryPayload as unknown as Record<string, unknown>,
      { messageId: retryPayload.messageId },
    );
  }

  private async startConsuming(): Promise<void> {
    const channel = this.rabbitmqService.channel;

    if (!channel) {
      this.logger.error('RabbitMQ channel is not available, cannot start consuming');
      return;
    }

    const { consumerTag } = await channel.consume(
      ORDER_PROCESS_QUEUE,
      (msg) => {
        if (!msg) return;
        this.handleMessage(msg).catch((error) => {
          this.logger.error('Unhandled error in message handler', error);
        });
      },
      { noAck: false }, // manual ack
    );

    this.consumerTag = consumerTag;
    this.logger.log(`Started consuming queue "${ORDER_PROCESS_QUEUE}" [tag: ${consumerTag}]`);
  }

  private async stopConsuming(): Promise<void> {
    const channel = this.rabbitmqService.channel;

    if (channel && this.consumerTag) {
      await channel.cancel(this.consumerTag);
      this.logger.log('Stopped consuming');
    }
  }
}
