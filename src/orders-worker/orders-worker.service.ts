import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';

import { OrderProcessMessageDto } from '@/orders/dto';
import { OrdersService } from '@/orders/orders.service';
import { ORDER_PROCESS_QUEUE, RabbitMQService } from '@/rabbitmq/rabbitmq.service';

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
      // TODO implement DLQ later
      this.logger.error('Failed to parse message, sending to dead-letter / nacking permanently');
      channel.nack(msg, false, false); // discard unparseable messages
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
    } catch (error) {
      this.logger.error(`Failed to process message [messageId: ${messageId}]`, error);
      // requeue: false → goes to dead-letter queue if configured, or discarded
      channel.nack(msg, false, false);
    }
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
