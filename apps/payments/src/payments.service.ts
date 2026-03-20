import { status as GrpcStatus } from '@grpc/grpc-js';
import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';

import { AuthorizeRequest } from './dto';
import { Payment, PaymentStatus } from './payment.entity';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
  ) {}

  async authorize(request: AuthorizeRequest): Promise<Payment> {
    // TODO add validation pipe and global exception filter to return proper gRPC error codes
    if (!request.orderId) {
      this.logger.error('Invalid authorize request: orderId is required', request);
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: 'orderId is required',
      });
    }

    if (!request.amount || request.amount <= 0) {
      this.logger.error('Invalid authorize request: amount must be greater than 0', request);
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: 'amount must be greater than 0',
      });
    }

    const existing = await this.paymentRepository.findOne({
      where: { orderId: request.orderId },
    });

    if (existing) {
      this.logger.log(
        `Payment for order ${request.orderId} already exists, returning existing payment ${existing.paymentId}`,
      );
      return existing;
    }

    const payment = this.paymentRepository.create({
      amount: (request.amount / 100).toFixed(2), // convert cents to dollars
      currency: request.currency,
      orderId: request.orderId,
      paymentId: randomUUID(),
      status: PaymentStatus.AUTHORIZED,
    });

    await this.paymentRepository.save(payment);
    this.logger.log(
      `Authorized payment ${payment.paymentId} for order ${request.orderId} with amount ${payment.amount} ${payment.currency}`,
    );

    return payment;
  }

  async getPaymentStatus(paymentId: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { paymentId },
    });

    if (!payment) {
      throw new RpcException({
        code: GrpcStatus.DEADLINE_EXCEEDED,
        message: `Payment ${paymentId} not found`,
      });
    }

    return payment;
  }
}
