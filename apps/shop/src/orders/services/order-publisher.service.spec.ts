import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { ORDER_PROCESS_QUEUE } from '@/rabbitmq/constants';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';

import { OrderProcessMessageDto } from '../dto';
import { Order } from '../order.entity';
import { OrderPublisherService } from './order-publisher.service';

const makeOrder = (overrides: Partial<Order> = {}): Order =>
  ({ id: 'order-uuid-1', ...overrides }) as Order;

describe('OrderPublisherService', () => {
  let service: OrderPublisherService;

  let configGet: jest.Mock;
  let publish: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn().mockReturnValue(undefined);
    publish = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderPublisherService,
        { provide: ConfigService, useValue: { get: configGet } },
        { provide: RabbitMQService, useValue: { publish } },
      ],
    }).compile();

    service = module.get(OrderPublisherService);
  });

  describe('publishOrderProcessing', () => {
    it('publishes to ORDER_PROCESS_QUEUE with the order id', () => {
      const order = makeOrder();

      service.publishOrderProcessing(order);

      expect(publish).toHaveBeenCalledTimes(1);
      const [queue, message] = publish.mock.calls[0] as [string, OrderProcessMessageDto];
      expect(queue).toBe(ORDER_PROCESS_QUEUE);
      expect(message.orderId).toBe(order.id);
    });

    it('sets correlationId on the message when provided', () => {
      const order = makeOrder();

      service.publishOrderProcessing(order, 'my-correlation-id');

      const [, message] = publish.mock.calls[0] as [string, OrderProcessMessageDto];
      expect(message.correlationId).toBe('my-correlation-id');
    });

    it('passes messageId option to publish matching the message messageId', () => {
      const order = makeOrder();

      service.publishOrderProcessing(order);

      const [, message, options] = publish.mock.calls[0] as [
        string,
        OrderProcessMessageDto,
        { messageId: string },
      ];
      expect(options.messageId).toBe(message.messageId);
    });

    it('uses forced messageId from config when RABBITMQ_SIMULATE_DUPLICATE_MESSAGE_ID is set', () => {
      configGet.mockReturnValue('forced-id-123');
      const order = makeOrder();

      service.publishOrderProcessing(order);

      const [, message, options] = publish.mock.calls[0] as [
        string,
        OrderProcessMessageDto,
        { messageId: string },
      ];
      expect(message.messageId).toBe('forced-id-123');
      expect(options.messageId).toBe('forced-id-123');
    });

    it('does not force messageId when config returns empty string', () => {
      configGet.mockReturnValue('');
      const order = makeOrder();

      service.publishOrderProcessing(order);

      const [, message] = publish.mock.calls[0] as [string, OrderProcessMessageDto];
      expect(message.messageId).not.toBe('');
      expect(message.messageId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });
});
