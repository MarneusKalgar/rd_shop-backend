import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, ChannelModel, connect, ConsumeMessage, Options } from 'amqplib';

import { ORDER_DLQ, ORDER_PROCESS_QUEUE } from './constants';

/**
 * Low-level RabbitMQ client service that manages the AMQP connection lifecycle,
 * queue declarations, message publishing, and consumer registration.
 *
 * **Lifecycle:**
 * - `onModuleInit` — connects to RabbitMQ, configures prefetch, asserts queues
 * - `onModuleDestroy` — gracefully closes channel and connection
 *
 * **Queue topology:**
 * - `order.process` — main processing queue (durable)
 * - `orders.dlq` — dead-letter queue for exhausted messages (durable)
 *
 * **Reliability:**
 * - Messages published with `persistent: true` by default
 * - `noAck: false` enforced on all consumers (manual ack required)
 * - Prefetch count controlled via `RABBITMQ_PREFETCH_COUNT` env variable
 */
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

  /**
   * Cancels an active consumer by its tag, stopping message delivery.
   * No-op if the channel is not initialized.
   *
   * @param consumerTag - The consumer tag returned by {@link consume}
   */
  async cancelConsumer(consumerTag: string): Promise<void> {
    if (!this._channel) return;
    await this._channel.cancel(consumerTag);
    this.logger.log(`Cancelled consumer [tag: ${consumerTag}]`);
  }

  /**
   * Starts consuming messages from a specific queue.
   *
   * @param queue - Queue name to consume from
   * @param handler - Async message handler callback
   * @param options - Optional consume options (defaults to { noAck: false })
   * @returns Promise resolving to consumerTag
   * @throws {Error} If channel is not initialized
   */
  async consume(
    queue: string,
    handler: (msg: ConsumeMessage, channel: Channel) => Promise<void>,
    options: Options.Consume = { noAck: false },
  ): Promise<{ consumerTag: string }> {
    const channel = this.resolveChannel();

    const { consumerTag } = await channel.consume(
      queue,
      (msg) => {
        if (!msg) return;
        handler(msg, channel).catch((error) => {
          this.logger.error(`Unhandled error in message handler for queue "${queue}":`, error);
        });
      },
      options,
    );

    this.logger.log(`Started consuming queue "${queue}" [tag: ${consumerTag}]`);

    return { consumerTag };
  }

  /** Closes the AMQP channel and connection when the module is torn down. */
  async onModuleDestroy() {
    await this.disconnect();
  }

  /** Establishes the AMQP connection and sets up queues when the module is initialized. */
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
  publish(queue: string, message: object, options?: Options.Publish) {
    const channel = this.resolveChannel();

    try {
      const messageBuffer = Buffer.from(JSON.stringify(message));
      const published = channel.sendToQueue(queue, messageBuffer, {
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

  /**
   * Establishes the AMQP connection and channel.
   * Configures prefetch count and calls {@link setupQueues}.
   * Attaches error/close event listeners for observability.
   *
   * @throws {Error} If connection or channel creation fails
   */
  private async connect(): Promise<void> {
    try {
      const host = this.configService.get<string>('RABBITMQ_HOST');
      const port = this.configService.get<number>('RABBITMQ_PORT');
      const user = this.configService.get<string>('RABBITMQ_USER');
      const password = this.configService.get<string>('RABBITMQ_PASSWORD');
      const prefetchCount = this.configService.get<number>('RABBITMQ_PREFETCH_COUNT', 10);

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

  /**
   * Gracefully closes the AMQP channel and connection.
   * Nullifies internal references to prevent reuse after teardown.
   *
   * @throws {Error} If closing the channel or connection fails
   */
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
   * Returns the active AMQP channel.
   *
   * @throws {Error} If the channel has not been initialized yet
   */
  private resolveChannel(): Channel {
    if (!this._channel) {
      throw new Error('RabbitMQ channel is not initialized');
    }
    return this._channel;
  }

  /**
   * Asserts all required queues during module initialization.
   * Queues are declared as `durable: true` so they survive broker restarts.
   *
   * Queues declared:
   * - `order.process` — primary order processing queue
   * - `orders.dlq` — dead-letter queue for unprocessable messages
   *
   * @throws {Error} If queue assertion fails
   */
  private async setupQueues(): Promise<void> {
    const channel = this.resolveChannel();

    try {
      await channel.assertQueue(ORDER_PROCESS_QUEUE, { durable: true });
      await channel.assertQueue(ORDER_DLQ, { durable: true });

      this.logger.log(`Queue "${ORDER_PROCESS_QUEUE}" setup completed`);
      this.logger.log(`Queue "${ORDER_DLQ}" setup completed`);
    } catch (error) {
      this.logger.error('Error setting up queues:', error);
      throw error;
    }
  }
}
