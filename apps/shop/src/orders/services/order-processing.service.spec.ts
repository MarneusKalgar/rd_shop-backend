import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuditAction, AuditLogService, AuditOutcome } from '@/audit-log';
import { PaymentsGrpcService } from '@/payments/payments-grpc.service';
import { ProcessedMessage } from '@/rabbitmq/processed-message.entity';

import { OrderProcessMessageDto } from '../dto';
import { ORDER_PAID_EVENT } from '../events';
import { Order, OrderStatus } from '../order.entity';
import { OrdersRepository } from '../repositories';
import { OrderProcessingService } from './order-processing.service';

// ─── factories ───────────────────────────────────────────────────────────────

const makePayload = (overrides: Partial<OrderProcessMessageDto> = {}): OrderProcessMessageDto => ({
  correlationId: 'corr-1',
  messageId: 'msg-1',
  orderId: 'order-1',
  ...overrides,
});

const makeOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    id: 'order-1',
    items: [],
    paymentId: null,
    status: OrderStatus.PENDING,
    user: { email: 'buyer@example.com' },
    userId: 'user-1',
    ...overrides,
  }) as unknown as Order;

// ─── manager mock builder ─────────────────────────────────────────────────────

interface ManagerMocks {
  findOneOrder: jest.Mock;
  findOneProcessedMessage: jest.Mock;
  insertProcessedMessage: jest.Mock;
  manager: EntityManager;
  saveOrder: jest.Mock;
}

const makeManager = (overrides: Partial<ManagerMocks> = {}): ManagerMocks => {
  const findOneProcessedMessage =
    overrides.findOneProcessedMessage ?? jest.fn().mockResolvedValue(null);
  const insertProcessedMessage =
    overrides.insertProcessedMessage ?? jest.fn().mockResolvedValue(undefined);
  const findOneOrder = overrides.findOneOrder ?? jest.fn().mockResolvedValue(makeOrder());
  const saveOrder = overrides.saveOrder ?? jest.fn().mockResolvedValue(undefined);

  const processedMessageRepo: Partial<Repository<ProcessedMessage>> = {
    findOne: findOneProcessedMessage,
  };

  const orderRepo: Partial<Repository<Order>> = {
    findOne: findOneOrder,
    save: saveOrder,
  };

  const manager = {
    getRepository: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === ProcessedMessage) return processedMessageRepo;
      if (entity === Order) return orderRepo;
    }),
    insert: insertProcessedMessage,
  } as unknown as EntityManager;

  return { findOneOrder, findOneProcessedMessage, insertProcessedMessage, manager, saveOrder };
};

// ─── suite ────────────────────────────────────────────────────────────────────

describe('OrderProcessingService', () => {
  let service: OrderProcessingService;

  let configGet: jest.Mock;
  let transactionFn: jest.Mock;
  let findByIdWithRelations: jest.Mock;
  let ordersRepoUpdate: jest.Mock;
  let authorize: jest.Mock;
  let auditLog: jest.Mock;
  let eventEmit: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn().mockReturnValue(undefined);
    transactionFn = jest.fn();
    findByIdWithRelations = jest.fn();
    ordersRepoUpdate = jest.fn().mockResolvedValue(undefined);
    authorize = jest.fn();
    auditLog = jest.fn().mockResolvedValue(undefined);
    eventEmit = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderProcessingService,
        { provide: ConfigService, useValue: { get: configGet } },
        {
          provide: DataSource,
          useValue: {
            transaction: transactionFn,
          },
        },
        {
          provide: OrdersRepository,
          useValue: {
            findByIdWithRelations,
            getRepository: jest.fn().mockReturnValue({ update: ordersRepoUpdate }),
          },
        },
        { provide: PaymentsGrpcService, useValue: { authorize } },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: EventEmitter2, useValue: { emit: eventEmit } },
      ],
    }).compile();

    service = module.get(OrderProcessingService);
  });

  // ─── processOrderMessage ─────────────────────────────────────────────────────

  describe('processOrderMessage', () => {
    it('skips processing when message was already processed', async () => {
      const { findOneProcessedMessage, manager } = makeManager({
        findOneProcessedMessage: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
      });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      await service.processOrderMessage(makePayload());

      expect(findOneProcessedMessage).toHaveBeenCalledTimes(1);
      expect(authorize).not.toHaveBeenCalled();
    });

    it('returns early without throwing on 23505 unique violation during insert', async () => {
      const { manager } = makeManager({
        insertProcessedMessage: jest.fn().mockRejectedValue({ code: '23505' }),
      });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      await expect(service.processOrderMessage(makePayload())).resolves.toBeUndefined();
    });

    it('throws when insert fails with a non-23505 error', async () => {
      const { manager } = makeManager({
        insertProcessedMessage: jest.fn().mockRejectedValue(new Error('DB gone')),
      });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      await expect(service.processOrderMessage(makePayload())).rejects.toThrow(
        'Failed to acquire idempotency lock',
      );
    });

    it('throws NotFoundException when order is not found in DB', async () => {
      const { manager } = makeManager({
        findOneOrder: jest.fn().mockResolvedValue(null),
      });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      await expect(service.processOrderMessage(makePayload())).rejects.toThrow(NotFoundException);
    });

    it('skips without updating when order is already PROCESSED', async () => {
      const { manager, saveOrder } = makeManager({
        findOneOrder: jest.fn().mockResolvedValue(makeOrder({ status: OrderStatus.PROCESSED })),
      });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      await service.processOrderMessage(makePayload());

      expect(saveOrder).not.toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
    });

    it('skips without updating when order has unexpected non-PENDING status', async () => {
      const { manager, saveOrder } = makeManager({
        findOneOrder: jest.fn().mockResolvedValue(makeOrder({ status: OrderStatus.CANCELLED })),
      });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      await service.processOrderMessage(makePayload());

      expect(saveOrder).not.toHaveBeenCalled();
    });

    it('throws simulated failure when RABBITMQ_SIMULATE_FAILURE=true', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === 'RABBITMQ_SIMULATE_FAILURE') return 'true';
        return undefined;
      });

      const { manager } = makeManager();
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      await expect(service.processOrderMessage(makePayload())).rejects.toThrow(
        'Simulated processing failure',
      );
    });

    it('marks order as PROCESSED and calls authorizePayment on happy path', async () => {
      const order = makeOrder();
      const { manager, saveOrder } = makeManager({
        findOneOrder: jest.fn().mockResolvedValue(order),
      });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      const orderWithRelations = makeOrder({
        items: [{ product: { price: 100 }, quantity: 2 }] as never,
      });
      findByIdWithRelations.mockResolvedValue(orderWithRelations);
      authorize.mockResolvedValue({ paymentId: 'pay-1', status: 'APPROVED' });

      await service.processOrderMessage(makePayload());

      expect(saveOrder).toHaveBeenCalled();
      expect(authorize).toHaveBeenCalled();
    });

    it('skips authorizePayment when RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION=true', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === 'RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION') return 'true';
        return undefined;
      });

      const order = makeOrder();
      const { manager } = makeManager({
        findOneOrder: jest.fn().mockResolvedValue(order),
      });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      await service.processOrderMessage(makePayload());

      expect(authorize).not.toHaveBeenCalled();
    });

    it('skips authorizePayment when order already has paymentId', async () => {
      const order = makeOrder({ paymentId: 'existing-pay' });
      const { manager } = makeManager({
        findOneOrder: jest.fn().mockResolvedValue(order),
      });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      await service.processOrderMessage(makePayload());

      expect(authorize).not.toHaveBeenCalled();
    });
  });

  // ─── authorizePayment ─────────────────────────────────────────────────────────

  describe('authorizePayment', () => {
    it('throws NotFoundException when order cannot be reloaded from DB', async () => {
      findByIdWithRelations.mockResolvedValue(null);

      await expect(service.authorizePayment(makeOrder())).rejects.toThrow(NotFoundException);
    });

    it('skips update and event when gRPC response has no paymentId', async () => {
      const orderWithRelations = makeOrder({
        items: [{ product: { price: 500 }, quantity: 1 }] as never,
      });
      findByIdWithRelations.mockResolvedValue(orderWithRelations);
      authorize.mockResolvedValue({ paymentId: null, status: 'PENDING' });

      await service.authorizePayment(makeOrder());

      expect(ordersRepoUpdate).not.toHaveBeenCalled();
      expect(eventEmit).not.toHaveBeenCalled();
    });

    it('updates order to PAID, emits ORDER_PAID_EVENT and logs audit on success', async () => {
      const orderWithRelations = makeOrder({
        items: [{ product: { price: 200 }, quantity: 3 }] as never,
      });
      findByIdWithRelations.mockResolvedValue(orderWithRelations);
      authorize.mockResolvedValue({ paymentId: 'pay-abc', status: 'APPROVED' });

      await service.authorizePayment(makeOrder());

      expect(ordersRepoUpdate).toHaveBeenCalledWith(
        { id: 'order-1' },
        { paymentId: 'pay-abc', status: OrderStatus.PAID },
      );
      expect(eventEmit).toHaveBeenCalledWith(ORDER_PAID_EVENT, expect.anything());
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ORDER_PAYMENT_AUTHORIZED,
          outcome: AuditOutcome.SUCCESS,
        }),
      );
    });

    it('logs ORDER_PAYMENT_FAILED audit and re-throws when gRPC call fails', async () => {
      const orderWithRelations = makeOrder({
        items: [{ product: { price: 100 }, quantity: 1 }] as never,
      });
      findByIdWithRelations.mockResolvedValue(orderWithRelations);
      const grpcError = new Error('gRPC timeout');
      authorize.mockRejectedValue(grpcError);

      await expect(service.authorizePayment(makeOrder())).rejects.toThrow(grpcError);

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ORDER_PAYMENT_FAILED,
          outcome: AuditOutcome.FAILURE,
        }),
      );
      expect(ordersRepoUpdate).not.toHaveBeenCalled();
    });
  });
});
