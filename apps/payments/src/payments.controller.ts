import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';

import {
  AuthorizeRequest,
  AuthorizeResponse,
  GetPaymentStatusRequest,
  GetPaymentStatusResponse,
} from './dto';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @GrpcMethod('Payments', 'Authorize')
  authorize(data: AuthorizeRequest): AuthorizeResponse {
    const record = this.paymentsService.authorize(data);
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
  getPaymentStatus(data: GetPaymentStatusRequest): GetPaymentStatusResponse {
    const record = this.paymentsService.getPaymentStatus(data.paymentId);
    return { paymentId: record.paymentId, status: record.status };
  }

  @GrpcMethod('Payments', 'Refund')
  refund() {
    return {
      message: 'Refund stub',
      ok: true,
    };
  }
}
