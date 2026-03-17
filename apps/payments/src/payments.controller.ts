import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { TypeOrmHealthIndicator } from '@nestjs/terminus';

import {
  AuthorizeRequest,
  AuthorizeResponse,
  GetPaymentStatusRequest,
  GetPaymentStatusResponse,
} from './dto';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @GrpcMethod('Payments', 'Authorize')
  async authorize(data: AuthorizeRequest): Promise<AuthorizeResponse> {
    const record = await this.paymentsService.authorize(data);
    return { paymentId: record.paymentId, status: record.status };
  }

  @GrpcMethod('Payments', 'Capture')
  capture() {
    return {
      message: 'Capture stub',
      ok: true,
    };
  }

  @GrpcMethod('Payments', 'GetPaymentStatus')
  async getPaymentStatus(data: GetPaymentStatusRequest): Promise<GetPaymentStatusResponse> {
    const record = await this.paymentsService.getPaymentStatus(data.paymentId);
    return { paymentId: record.paymentId, status: record.status };
  }

  @GrpcMethod('Payments', 'Ping')
  async ping(): Promise<{ status: string }> {
    await this.db.pingCheck('postgres');
    return { status: 'ok' };
  }

  @GrpcMethod('Payments', 'Refund')
  refund() {
    return {
      message: 'Refund stub',
      ok: true,
    };
  }
}
