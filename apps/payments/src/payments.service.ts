import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { AuthorizeRequest } from './dto';

export enum PaymentStatus {
  AUTHORIZED = 1,
  CAPTURED = 2,
  REFUNDED = 3,
  FAILED = 4,
  PENDING = 5,
}

export interface PaymentRecord {
  amount: number;
  createdAt: Date;
  currency: string;
  orderId: string;
  paymentId: string;
  status: PaymentStatus;
}

// TODO add logger and error handling to the service methods
@Injectable()
export class PaymentsService {
  private readonly payments = new Map<string, PaymentRecord>();

  authorize(request: AuthorizeRequest): PaymentRecord {
    const paymentId = request.idempotencyKey ?? randomUUID();
    const record: PaymentRecord = {
      amount: request.amount,
      createdAt: new Date(),
      currency: request.currency,
      orderId: request.orderId,
      paymentId,
      status: PaymentStatus.AUTHORIZED,
    };
    this.payments.set(paymentId, record);
    console.log(`Authorized payment ${paymentId} for order ${request.orderId}`);
    return record;
  }

  getPaymentStatus(paymentId: string): PaymentRecord {
    const record = this.payments.get(paymentId);
    if (!record) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }
    return record;
  }
}
