import { TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';

import { PaymentStatus } from './payment.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

const mockPayment = {
  amount: '100.00',
  createdAt: new Date(),
  currency: 'USD',
  orderId: 'order-1',
  paymentId: 'uuid-1',
  status: PaymentStatus.AUTHORIZED,
  updatedAt: new Date(),
};

const mockPaymentsService = {
  authorize: jest.fn().mockResolvedValue(mockPayment),
  getPaymentStatus: jest.fn().mockResolvedValue(mockPayment),
};

const mockTypeOrmHealthIndicator = {
  pingCheck: jest.fn().mockResolvedValue({ postgres: { status: 'up' } }),
};

describe('PaymentsController', () => {
  let paymentsController: PaymentsController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: TypeOrmHealthIndicator, useValue: mockTypeOrmHealthIndicator },
      ],
    }).compile();

    paymentsController = app.get<PaymentsController>(PaymentsController);
    jest.clearAllMocks();
  });

  describe('authorize', () => {
    it('should return paymentId and status', async () => {
      const request = { amount: 100, currency: 'USD', orderId: 'order-1' };
      const result = await paymentsController.authorize(request);
      expect(mockPaymentsService.authorize).toHaveBeenCalledWith(request);
      expect(result).toEqual({ paymentId: mockPayment.paymentId, status: mockPayment.status });
    });
  });

  describe('getPaymentStatus', () => {
    it('should return paymentId and status', async () => {
      const request = { paymentId: 'uuid-1' };
      const result = await paymentsController.getPaymentStatus(request);
      expect(mockPaymentsService.getPaymentStatus).toHaveBeenCalledWith(request.paymentId);
      expect(result).toEqual({ paymentId: mockPayment.paymentId, status: mockPayment.status });
    });
  });

  describe('ping', () => {
    it('should return status ok', async () => {
      const result = await paymentsController.ping();
      expect(mockTypeOrmHealthIndicator.pingCheck).toHaveBeenCalledWith('postgres');
      expect(result).toEqual({ status: 'ok' });
    });
  });
});
