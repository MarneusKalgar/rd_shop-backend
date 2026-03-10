import { status as GrpcStatus } from '@grpc/grpc-js';
import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
// import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';

import { AuthorizeRequest } from './dto';
import { Payment, PaymentStatus } from './payment.entity';

// export enum PaymentStatus {
//   AUTHORIZED = 1,
//   CAPTURED = 2,
//   REFUNDED = 3,
//   FAILED = 4,
//   PENDING = 5,
// }

// export interface PaymentRecord {
//   amount: number;
//   createdAt: Date;
//   currency: string;
//   orderId: string;
//   paymentId: string;
//   status: PaymentStatus;
// }

// TODO add logger and error handling to the service methods
@Injectable()
export class PaymentsService {
  // private readonly payments = new Map<string, PaymentRecord>();
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
  ) {}

  async authorize(request: AuthorizeRequest): Promise<Payment> {
    // const paymentId = request.idempotencyKey;
    // const record: PaymentRecord = {
    //   amount: request.amount,
    //   createdAt: new Date(),
    //   currency: request.currency,
    //   orderId: request.orderId,
    //   paymentId,
    //   status: PaymentStatus.AUTHORIZED,
    // };

    // TODO add validation pipe and error handling
    if (!request.orderId || !request.idempotencyKey) {
      this.logger.error(
        'Invalid authorize request: orderId and idempotencyKey are required',
        request,
      );
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: 'orderId and idempotencyKey are required',
      });
    }

    if (request.idempotencyKey) {
      const existing = await this.paymentRepository.findOne({
        where: { paymentId: request.idempotencyKey },
      });

      if (existing) {
        this.logger.log(
          `Payment with idempotency key ${request.idempotencyKey} already exists, returning existing payment ${existing.paymentId}`,
        );
        return existing;
      }
    }

    const payment = this.paymentRepository.create({
      amount: request.amount.toString(),
      currency: request.currency,
      orderId: request.orderId,
      paymentId: request.idempotencyKey,
      status: PaymentStatus.AUTHORIZED,
    });

    // this.payments.set(paymentId, record);
    await this.paymentRepository.save(payment);
    this.logger.log(`Authorized payment ${request.idempotencyKey} for order ${request.orderId}`);

    return payment;
  }

  async getPaymentStatus(paymentId: string): Promise<Payment> {
    // const record = this.payments.get(paymentId);
    // if (!record) {
    //   throw new NotFoundException(`Payment ${paymentId} not found`);
    // }

    const payment = await this.paymentRepository.findOne({
      where: { paymentId },
    });
    if (!payment) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: `Payment ${paymentId} not found`,
      });
    }
    return payment;
  }
}
