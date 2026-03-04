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

  private publishToDlq(payload: OrderProcessMessageDto): void {
    this.rabbitmqService.publish(ORDER_DLQ, payload, {
      messageId: payload.messageId,
    });
  }

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

  private async stopConsuming(): Promise<void> {
    if (this.consumerTag) {
      await this.rabbitmqService.cancelConsumer(this.consumerTag);
      this.consumerTag = null;
    }
  }
}
