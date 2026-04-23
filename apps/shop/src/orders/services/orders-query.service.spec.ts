import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PaymentsGrpcService } from '../../payments/payments-grpc.service';
import { FindOrdersFilterDto } from '../dto';
import { Order } from '../order.entity';
import { OrdersQueryBuilder, OrdersRepository } from '../repositories';
import { OrdersQueryService } from './orders-query.service';

const makeOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    id: 'order-1',
    items: [],
    paymentId: 'pay-1',
    userId: 'user-1',
    ...overrides,
  }) as Order;

describe('OrdersQueryService', () => {
  let service: OrdersQueryService;

  // Captured mock function references — avoids @typescript-eslint/unbound-method
  let findByIdWithItemRelations: jest.Mock;
  let buildOrderIdsSubquery: jest.Mock;
  let buildMainQuery: jest.Mock;
  let applyCursorPagination: jest.Mock;
  let applyOrderingAndLimit: jest.Mock;
  let getPaymentStatus: jest.Mock;

  beforeEach(async () => {
    findByIdWithItemRelations = jest.fn();
    buildOrderIdsSubquery = jest.fn();
    buildMainQuery = jest.fn();
    applyCursorPagination = jest.fn();
    applyOrderingAndLimit = jest.fn();
    getPaymentStatus = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersQueryService,
        {
          provide: OrdersRepository,
          useValue: { findByIdWithItemRelations },
        },
        {
          provide: OrdersQueryBuilder,
          useValue: {
            applyCursorPagination,
            applyOrderingAndLimit,
            buildMainQuery,
            buildOrderIdsSubquery,
          },
        },
        {
          provide: PaymentsGrpcService,
          useValue: { getPaymentStatus },
        },
      ],
    }).compile();

    service = module.get(OrdersQueryService);
  });

  describe('getOrderById', () => {
    it('returns order when found and owned by user', async () => {
      const order = makeOrder();
      findByIdWithItemRelations.mockResolvedValueOnce(order);

      const result = await service.getOrderById('user-1', 'order-1');

      expect(result).toBe(order);
      expect(findByIdWithItemRelations).toHaveBeenCalledWith('order-1');
    });

    it('throws NotFoundException when order does not belong to user', async () => {
      const order = makeOrder({ userId: 'other-user' });
      findByIdWithItemRelations.mockResolvedValueOnce(order);

      await expect(service.getOrderById('user-1', 'order-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when order is null', async () => {
      findByIdWithItemRelations.mockResolvedValueOnce(null);

      await expect(service.getOrderById('user-1', 'order-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getOrderPayment', () => {
    it('returns payment status when order has a paymentId', async () => {
      const order = makeOrder({ paymentId: 'pay-1' });
      findByIdWithItemRelations.mockResolvedValueOnce(order);
      getPaymentStatus.mockResolvedValueOnce({ paymentId: 'pay-1', status: 'PAID' });

      const result = await service.getOrderPayment('user-1', 'order-1');

      expect(result).toEqual({ paymentId: 'pay-1', status: 'PAID' });
    });

    it('throws BadRequestException when order has no paymentId', async () => {
      const order = makeOrder({ paymentId: null as unknown as string });
      findByIdWithItemRelations.mockResolvedValueOnce(order);

      await expect(service.getOrderPayment('user-1', 'order-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rethrows HttpException from paymentsGrpcService', async () => {
      const order = makeOrder({ paymentId: 'pay-1' });
      findByIdWithItemRelations.mockResolvedValueOnce(order);
      getPaymentStatus.mockRejectedValueOnce(new NotFoundException('not found'));

      await expect(service.getOrderPayment('user-1', 'order-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ServiceUnavailableException on unexpected gRPC error', async () => {
      const order = makeOrder({ paymentId: 'pay-1' });
      findByIdWithItemRelations.mockResolvedValueOnce(order);
      getPaymentStatus.mockRejectedValueOnce(new Error('connection refused'));

      await expect(service.getOrderPayment('user-1', 'order-1')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws NotFoundException when order does not belong to user', async () => {
      const order = makeOrder({ userId: 'other-user' });
      findByIdWithItemRelations.mockResolvedValueOnce(order);

      await expect(service.getOrderPayment('user-1', 'order-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOrdersWithFilters', () => {
    const userId = 'user-1';
    const params: FindOrdersFilterDto = { limit: 2 };

    it('returns empty result when no orders match', async () => {
      const subquery = { getRawMany: jest.fn().mockResolvedValueOnce([]) };
      buildOrderIdsSubquery.mockReturnValueOnce(subquery);

      const result = await service.findOrdersWithFilters(userId, params);

      expect(result).toEqual({ nextCursor: null, orders: [] });
    });

    it('returns orders without nextCursor when result fits within limit', async () => {
      const rows = [{ createdAt: new Date('2024-01-01'), id: 'order-1' }];
      const subquery = { getRawMany: jest.fn().mockResolvedValueOnce(rows) };
      const mainQuery = { getMany: jest.fn().mockResolvedValueOnce([makeOrder()]) };

      buildOrderIdsSubquery.mockReturnValueOnce(subquery);
      buildMainQuery.mockReturnValueOnce(mainQuery);

      const result = await service.findOrdersWithFilters(userId, params);

      expect(result.orders).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it('returns nextCursor when result exceeds limit', async () => {
      // limit=2, return 3 rows → hasNextPage=true, slice=[row1,row2]
      const rows = [
        { createdAt: new Date('2024-01-03'), id: 'order-1' },
        { createdAt: new Date('2024-01-02'), id: 'order-2' },
        { createdAt: new Date('2024-01-01'), id: 'order-3' },
      ];
      const subquery = { getRawMany: jest.fn().mockResolvedValueOnce(rows) };
      const mainQuery = {
        getMany: jest
          .fn()
          .mockResolvedValueOnce([makeOrder({ id: 'order-1' }), makeOrder({ id: 'order-2' })]),
      };

      buildOrderIdsSubquery.mockReturnValueOnce(subquery);
      buildMainQuery.mockReturnValueOnce(mainQuery);

      const result = await service.findOrdersWithFilters(userId, params);

      expect(result.orders).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
    });

    it('applies cursor pagination when cursor param is provided', async () => {
      // Cursor format: `${uuid}|${epochMs}` — CURSOR_SEPARATOR = '|', id must be a valid UUID
      const cursorId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      const createdAt = new Date('2024-01-01T00:00:00.000Z');
      const rawCursor = `${cursorId}|${createdAt.getTime()}`;

      const subquery = { getRawMany: jest.fn().mockResolvedValueOnce([]) };
      buildOrderIdsSubquery.mockReturnValueOnce(subquery);

      await service.findOrdersWithFilters(userId, { ...params, cursor: rawCursor });

      expect(applyCursorPagination).toHaveBeenCalledWith(subquery, {
        createdAt,
        id: cursorId,
      });
    });

    it('calls applyOrderingAndLimit with limit + 1', async () => {
      const subquery = { getRawMany: jest.fn().mockResolvedValueOnce([]) };
      buildOrderIdsSubquery.mockReturnValueOnce(subquery);

      await service.findOrdersWithFilters(userId, { limit: 5 });

      expect(applyOrderingAndLimit).toHaveBeenCalledWith(subquery, 6);
    });
  });
});
