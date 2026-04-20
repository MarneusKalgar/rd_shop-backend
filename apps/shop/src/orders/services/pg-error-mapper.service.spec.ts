import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { Order } from '../order.entity';
import { OrdersRepository } from '../repositories';
import { PgErrorMapperService } from './pg-error-mapper.service';

const makeOrder = (overrides: Partial<Order> = {}): Order =>
  ({ id: 'order-uuid-1', userId: 'user-1', ...overrides }) as Order;

describe('PgErrorMapperService', () => {
  let service: PgErrorMapperService;

  let findByIdempotencyKey: jest.Mock;

  beforeEach(async () => {
    findByIdempotencyKey = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PgErrorMapperService,
        { provide: OrdersRepository, useValue: { findByIdempotencyKey } },
      ],
    }).compile();

    service = module.get(PgErrorMapperService);
  });

  describe('handleCreationError', () => {
    describe('23505 — unique violation (idempotency race)', () => {
      it('returns existing order when idempotencyKey is provided and order found', async () => {
        const existing = makeOrder();
        findByIdempotencyKey.mockResolvedValueOnce(existing);

        const result = await service.handleCreationError({ code: '23505' }, 'user-1', 'idem-key-1');

        expect(result).toBe(existing);
        expect(findByIdempotencyKey).toHaveBeenCalledWith('idem-key-1');
      });

      it('re-throws original error when found order belongs to a different user (IDOR prevention)', async () => {
        const existing = makeOrder({ userId: 'user-other' });
        findByIdempotencyKey.mockResolvedValueOnce(existing);
        const error = { code: '23505' };

        await expect(service.handleCreationError(error, 'user-1', 'idem-key-1')).rejects.toBe(
          error,
        );
      });

      it('re-throws when idempotencyKey is absent', async () => {
        const error = { code: '23505' };

        await expect(service.handleCreationError(error, 'user-1')).rejects.toBe(error);
        expect(findByIdempotencyKey).not.toHaveBeenCalled();
      });

      it('re-throws original error when idempotencyKey provided but no order found', async () => {
        findByIdempotencyKey.mockResolvedValueOnce(null);
        const error = { code: '23505' };

        await expect(service.handleCreationError(error, 'user-1', 'idem-key-1')).rejects.toBe(
          error,
        );
      });
    });

    describe('57014 — statement timeout', () => {
      it('throws Error with timeout message on pg code 57014', async () => {
        await expect(service.handleCreationError({ code: '57014' }, 'user-1')).rejects.toThrow(
          'Order creation timed out',
        );
      });

      it('throws Error with timeout message when error message contains "statement timeout"', async () => {
        await expect(
          service.handleCreationError({ message: 'statement timeout exceeded' }, 'user-1'),
        ).rejects.toThrow('Order creation timed out');
      });
    });

    describe('55P03 — lock timeout', () => {
      it('throws ConflictException on pg code 55P03', async () => {
        await expect(service.handleCreationError({ code: '55P03' }, 'user-1')).rejects.toThrow(
          ConflictException,
        );
      });

      it('throws ConflictException when error message contains "lock timeout"', async () => {
        await expect(
          service.handleCreationError({ message: 'lock timeout exceeded' }, 'user-1'),
        ).rejects.toThrow(ConflictException);
      });
    });

    describe('unknown errors', () => {
      it('re-throws the original error unchanged', async () => {
        const error = new Error('some unknown db error');

        await expect(service.handleCreationError(error, 'user-1')).rejects.toBe(error);
      });
    });
  });
});
