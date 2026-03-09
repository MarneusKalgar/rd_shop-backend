import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, Observable, timeout, TimeoutError } from 'rxjs';

import { PAYMENTS_GRPC_CLIENT } from './constants';

interface AuthorizeRequest {
  amount: number;
  currency: string;
  idempotencyKey?: string;
  orderId: string;
}

interface AuthorizeResponse {
  paymentId: string;
  status: number;
}

interface PaymentsProtoService {
  authorize(request: AuthorizeRequest): Observable<AuthorizeResponse>;
  // TODO add getPaymentStatus, capture and refund methods
}

@Injectable()
export class PaymentsGrpcService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsGrpcService.name);
  private paymentsProtoService: PaymentsProtoService;

  constructor(
    @Inject(PAYMENTS_GRPC_CLIENT) private readonly client: ClientGrpc,
    private readonly configService: ConfigService,
  ) {}

  async authorize(request: AuthorizeRequest): Promise<AuthorizeResponse> {
    const timeoutMs = this.configService.get<number>('PAYMENTS_GRPC_TIMEOUT_MS') ?? 5000;

    try {
      return await firstValueFrom(
        this.paymentsProtoService.authorize(request).pipe(timeout(timeoutMs)),
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        this.logger.error(
          `Payment authorization timed out after ${timeoutMs}ms for order=${request.orderId}`,
        );
        throw new Error('Payment authorization timed out');
      }
      this.logger.error(`Payment authorization failed for order=${request.orderId}`, err);
      throw err;
    }
  }

  onModuleInit() {
    this.paymentsProtoService = this.client.getService<PaymentsProtoService>('Payments');
  }
}
