import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, ChannelModel, connect, Options } from 'amqplib';

export const ORDER_PROCESS_QUEUE = 'order.process';

@Injectable()
export class RabbitMQService implements OnModuleDestroy, OnModuleInit {
  get channel(): Channel | null {
    return this._channel;
  }
  get connection(): ChannelModel | null {
    return this._connection;
  }

  private _channel: Channel | null = null;

  private _connection: ChannelModel | null = null;

  private readonly logger = new Logger(RabbitMQService.name);

  constructor(private readonly configService: ConfigService) {}

  async onModuleDestroy() {
    await this.disconnect();
  }

  async onModuleInit() {
    await this.connect();
  }

  /**
   * Publishes a message to a specific queue.
   *
   * @param queue - Queue name
   * @param message - Message object to publish
   * @param options - Optional message options (persistent, priority, etc.)
   * @throws {Error} If channel is not initialized or publishing fails
   */
  publish(queue: string, message: Record<string, unknown>, options?: Options.Publish) {
    if (!this._channel) {
      throw new Error('RabbitMQ channel is not initialized');
    }

    try {
      const messageBuffer = Buffer.from(JSON.stringify(message));
      const published = this._channel.sendToQueue(queue, messageBuffer, {
        contentType: 'application/json',
        persistent: options?.persistent ?? true,
        ...options,
      });

      if (!published) {
        this.logger.warn(`Failed to publish message to queue "${queue}". Channel buffer full.`);
      }

      this.logger.debug(`Message published to queue "${queue}": ${JSON.stringify(message)}`);
    } catch (error) {
      this.logger.error(`Error publishing message to queue "${queue}":`, error);
      throw error;
    }
  }

  private async connect(): Promise<void> {
    try {
      const host = this.configService.get<string>('RABBITMQ_HOST');
      const port = this.configService.get<number>('RABBITMQ_PORT');
      const user = this.configService.get<string>('RABBITMQ_USER');
      const password = this.configService.get<string>('RABBITMQ_PASSWORD');
      const prefetchCount = this.configService.get<number>('RABBITMQ_PREFETCH_COUNT', 10);
      // const vhost = this.configService.get<string>('RABBITMQ_VHOST');

      const url = `amqp://${user}:${password}@${host}:${port}`;

      this._connection = await connect(url);
      this._channel = await this._connection.createChannel();

      await this._channel.prefetch(prefetchCount);

      await this.setupQueues();

      this._connection.on('error', (err) => {
        this.logger.error('RabbitMQ connection error:', err);
      });

      this._connection.on('close', () => {
        this.logger.warn('RabbitMQ connection closed');
      });

      this.logger.log('RabbitMQ connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ:', error);
      throw error;
    }
  }

  private async disconnect(): Promise<void> {
    try {
      if (this._channel) {
        await this._channel.close();
        this._channel = null;
      }

      if (this._connection) {
        await this._connection.close();
        this._connection = null;
      }

      this.logger.log('RabbitMQ disconnected successfully');
    } catch (error) {
      this.logger.error('Error disconnecting from RabbitMQ:', error);
      throw error;
    }
  }

  /**
   * Sets up required queues during module initialization.
   * Declares queues with durable option enabled for persistence.
   */
  private async setupQueues(): Promise<void> {
    if (!this._channel) {
      throw new Error('RabbitMQ channel is not initialized');
    }

    try {
      await this._channel.assertQueue(ORDER_PROCESS_QUEUE, {
        durable: true,
      });

      this.logger.log(`Queue "${ORDER_PROCESS_QUEUE}" setup completed`);
    } catch (error) {
      this.logger.error('Error setting up queues:', error);
      throw error;
    }
  }
}
