import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuditAction, AuditLogService, AuditOutcome } from '@/audit-log';
import { AuthUser } from '@/auth/types';
import { OrdersMetricsService } from '@/observability';
import { User } from '@/users/user.entity';

import { MAX_ORDER_QUANTITY } from '../constants';
import { CreateOrderDto } from '../dto';
import { ORDER_CANCELLED_EVENT, ORDER_CREATED_EVENT } from '../events';
import { Order, OrderStatus } from '../order.entity';
import { OrderItemsRepository, OrdersRepository } from '../repositories';
import { OrderPublisherService } from './order-publisher.service';
import { OrderStockService } from './order-stock.service';
import { OrdersCommandService } from './orders-command.service';
import { PgErrorMapperService } from './pg-error-mapper.service';

// ─── factories ───────────────────────────────────────────────────────────────

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    city: 'NYC',
    country: 'US',
    email: 'buyer@example.com',
    firstName: 'John',
    id: 'user-1',
    lastName: 'Doe',
    phone: '555-0000',
    postcode: '10001',
    ...overrides,
  }) as unknown as User;

const makeOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    id: 'order-1',
    items: [],
    paymentId: null,
    status: OrderStatus.PENDING,
    userId: 'user-1',
    ...overrides,
  }) as unknown as Order;

const makeDto = (overrides: Partial<CreateOrderDto> = {}): CreateOrderDto => ({
  items: [{ productId: 'prod-1', quantity: 2 }],
  ...overrides,
});

const makeAuthUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  email: 'buyer@example.com',
  roles: [],
  scopes: [],
  sub: 'user-1',
  ...overrides,
});

// ─── manager mock builder ─────────────────────────────────────────────────────

const makeManager = (
  overrides: {
    findOneOrder?: jest.Mock;
    saveOrder?: jest.Mock;
  } = {},
) => {
  const findOneOrder = overrides.findOneOrder ?? jest.fn().mockResolvedValue(makeOrder());
  const saveOrder = overrides.saveOrder ?? jest.fn().mockImplementation((o: Order) => o);

  const orderRepo: Partial<Repository<Order>> = { findOne: findOneOrder, save: saveOrder };

  const manager = {
    getRepository: jest.fn().mockReturnValue(orderRepo),
    query: jest.fn().mockResolvedValue(undefined),
  } as unknown as EntityManager;

  return { findOneOrder, manager, saveOrder };
};

// ─── suite ────────────────────────────────────────────────────────────────────

describe('OrdersCommandService', () => {
  let service: OrdersCommandService;

  let userFindOne: jest.Mock;
  let findByIdempotencyKey: jest.Mock;
  let findByIdWithItemRelations: jest.Mock;
  let ordersRepoCreateOrder: jest.Mock;
  let validateExist: jest.Mock;
  let createOrderItems: jest.Mock;
  let transactionFn: jest.Mock;
  let eventEmit: jest.Mock;
  let auditLog: jest.Mock;
  let lockAndRestore: jest.Mock;
  let lockValidateAndDecrement: jest.Mock;
  let publishOrderProcessing: jest.Mock;
  let handleCreationError: jest.Mock;
  let recordOrderCompleted: jest.Mock;
  let recordOrderCreated: jest.Mock;

  beforeEach(async () => {
    userFindOne = jest.fn().mockResolvedValue(makeUser());
    findByIdempotencyKey = jest.fn().mockResolvedValue(null);
    findByIdWithItemRelations = jest.fn().mockResolvedValue(makeOrder());
    ordersRepoCreateOrder = jest.fn().mockResolvedValue(makeOrder());
    validateExist = jest.fn().mockResolvedValue(undefined);
    createOrderItems = jest.fn().mockResolvedValue([]);
    transactionFn = jest.fn();
    eventEmit = jest.fn();
    auditLog = jest.fn().mockResolvedValue(undefined);
    lockAndRestore = jest.fn().mockResolvedValue(undefined);
    lockValidateAndDecrement = jest
      .fn()
      .mockResolvedValue(new Map([['prod-1', { id: 'prod-1', price: 100 }]]));
    publishOrderProcessing = jest.fn();
    handleCreationError = jest.fn();
    recordOrderCompleted = jest.fn();
    recordOrderCreated = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersCommandService,
        { provide: getRepositoryToken(User), useValue: { findOne: userFindOne } },
        {
          provide: OrdersRepository,
          useValue: {
            createOrder: ordersRepoCreateOrder,
            findByIdempotencyKey,
            findByIdWithItemRelations,
          },
        },
        { provide: OrderItemsRepository, useValue: { createOrderItems } },
        { provide: DataSource, useValue: { transaction: transactionFn } },
        { provide: EventEmitter2, useValue: { emit: eventEmit } },
        { provide: AuditLogService, useValue: { log: auditLog } },
        {
          provide: OrderStockService,
          useValue: { lockAndRestore, lockValidateAndDecrement, validateExist },
        },
        { provide: OrderPublisherService, useValue: { publishOrderProcessing } },
        { provide: PgErrorMapperService, useValue: { handleCreationError } },
        { provide: OrdersMetricsService, useValue: { recordOrderCompleted, recordOrderCreated } },
      ],
    }).compile();

    service = module.get(OrdersCommandService);
  });

  // ─── createOrder ─────────────────────────────────────────────────────────────

  describe('createOrder', () => {
    it('returns existing order when idempotency key already used', async () => {
      const existing = makeOrder({ id: 'existing-1' });
      findByIdempotencyKey.mockResolvedValue(existing);

      const result = await service.createOrder('user-1', makeDto({ idempotencyKey: 'k1' }));

      expect(result).toBe(existing);
      expect(transactionFn).not.toHaveBeenCalled();
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.ORDER_IDEMPOTENT_HIT }),
      );
    });

    it('throws BadRequestException when quantity is 0', async () => {
      await expect(
        service.createOrder('user-1', makeDto({ items: [{ productId: 'p1', quantity: 0 }] })),
      ).rejects.toThrow(BadRequestException);

      expect(transactionFn).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when quantity exceeds MAX_ORDER_QUANTITY', async () => {
      await expect(
        service.createOrder(
          'user-1',
          makeDto({ items: [{ productId: 'p1', quantity: MAX_ORDER_QUANTITY + 1 }] }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when user does not exist', async () => {
      userFindOne.mockResolvedValue(null);

      await expect(service.createOrder('unknown', makeDto())).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when a product is not found in pre-check', async () => {
      validateExist.mockRejectedValue(new NotFoundException('Product not found'));

      await expect(service.createOrder('user-1', makeDto())).rejects.toThrow(NotFoundException);
    });

    it('creates order, publishes message, emits event, logs audit on happy path', async () => {
      const createdOrder = makeOrder({ id: 'new-order' });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => {
        const { manager } = makeManager({
          findOneOrder: jest.fn().mockResolvedValue(createdOrder),
        });
        ordersRepoCreateOrder.mockResolvedValue(createdOrder);
        return cb(manager);
      });

      const result = await service.createOrder('user-1', makeDto({ idempotencyKey: 'k2' }));

      expect(result).toBeDefined();
      expect(publishOrderProcessing).toHaveBeenCalledTimes(1);
      expect(recordOrderCreated).toHaveBeenCalledWith(
        expect.objectContaining({ initialStatus: createdOrder.status }),
      );
      expect(eventEmit).toHaveBeenCalledWith(ORDER_CREATED_EVENT, expect.anything());
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ORDER_CREATED,
          outcome: AuditOutcome.SUCCESS,
        }),
      );
    });

    it('calls pgErrorMapperService.handleCreationError on transaction error', async () => {
      const txError = new Error('DB timeout');
      transactionFn.mockRejectedValue(txError);
      const recovered = makeOrder({ id: 'recovered' });
      handleCreationError.mockResolvedValue(recovered);

      const result = await service.createOrder('user-1', makeDto());

      expect(handleCreationError).toHaveBeenCalledWith(txError, 'user-1', undefined);
      expect(result).toBe(recovered);
    });

    it('logs ORDER_CREATION_FAILED and rethrows when pgErrorMapper also throws', async () => {
      transactionFn.mockRejectedValue(new Error('DB error'));
      const finalError = new ConflictException('Cannot recover');
      handleCreationError.mockRejectedValue(finalError);

      await expect(service.createOrder('user-1', makeDto())).rejects.toThrow(finalError);

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ORDER_CREATION_FAILED,
          outcome: AuditOutcome.FAILURE,
        }),
      );
    });
  });

  // ─── cancelOrder ─────────────────────────────────────────────────────────────

  describe('cancelOrder', () => {
    it('throws NotFoundException when order not found (assertOrderOwnership)', async () => {
      const { manager } = makeManager({
        findOneOrder: jest.fn().mockResolvedValue(null),
      });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      await expect(service.cancelOrder(makeAuthUser(), 'order-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when order belongs to different user', async () => {
      const { manager } = makeManager({
        findOneOrder: jest.fn().mockResolvedValue(makeOrder({ userId: 'other-user' })),
      });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      await expect(service.cancelOrder(makeAuthUser({ sub: 'user-1' }), 'order-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when order is already CANCELLED', async () => {
      const { manager } = makeManager({
        findOneOrder: jest.fn().mockResolvedValue(makeOrder({ status: OrderStatus.CANCELLED })),
      });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      await expect(service.cancelOrder(makeAuthUser(), 'order-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException when order is in CREATED state', async () => {
      const { manager } = makeManager({
        findOneOrder: jest.fn().mockResolvedValue(makeOrder({ status: OrderStatus.CREATED })),
      });
      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => cb(manager));

      await expect(service.cancelOrder(makeAuthUser(), 'order-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('cancels order, restores stock, emits event, logs audit on happy path', async () => {
      const cancelledOrder = makeOrder({ id: 'order-1', status: OrderStatus.PENDING });

      transactionFn.mockImplementation((cb: (m: EntityManager) => unknown) => {
        // First findOne (shallow) returns PENDING order with correct userId
        // Second findOne (with relations) returns same order with items
        const findOneOrder = jest
          .fn()
          .mockResolvedValueOnce(cancelledOrder)
          .mockResolvedValueOnce({ ...cancelledOrder, items: [{ productId: 'prod-1' }] });

        const saveOrder = jest.fn().mockImplementation((o: Order) => o);

        const orderRepo = { findOne: findOneOrder, save: saveOrder };
        const manager = {
          getRepository: jest.fn().mockReturnValue(orderRepo),
          query: jest.fn().mockResolvedValue(undefined),
        } as unknown as EntityManager;

        findByIdWithItemRelations.mockResolvedValue(cancelledOrder);

        return cb(manager);
      });

      const result = await service.cancelOrder(makeAuthUser(), 'order-1');

      expect(result).toBeDefined();
      expect(lockAndRestore).toHaveBeenCalledTimes(1);
      expect(recordOrderCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ finalStatus: cancelledOrder.status }),
      );
      expect(eventEmit).toHaveBeenCalledWith(ORDER_CANCELLED_EVENT, expect.anything());
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ORDER_CANCELLED,
          outcome: AuditOutcome.SUCCESS,
        }),
      );
    });
  });
});
