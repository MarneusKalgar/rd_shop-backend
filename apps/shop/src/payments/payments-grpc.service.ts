import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, Observable, timeout, TimeoutError } from 'rxjs';

import { PAYMENTS_GRPC_CLIENT } from './constants';
import {
  AuthorizeRequest,
  AuthorizeResponse,
  GetPaymentStatusRequest,
  GetPaymentStatusResponse,
} from './interfaces';

interface PaymentsProtoService {
  authorize(request: AuthorizeRequest): Observable<AuthorizeResponse>;
  getPaymentStatus(request: GetPaymentStatusRequest): Observable<GetPaymentStatusResponse>;
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
        throw new GatewayTimeoutException(`Payment authorization timed out after ${timeoutMs}ms`);
      }
      this.logger.error(`Payment authorization failed for order=${request.orderId}`, err);
      this.mapGrpcError(err);
    }
  }

  async getPaymentStatus(paymentId: string): Promise<GetPaymentStatusResponse> {
    const timeoutMs = this.configService.get<number>('PAYMENTS_GRPC_TIMEOUT_MS') ?? 5000;

    if (!paymentId) {
      this.logger.error('getPaymentStatus called without paymentId');
      throw new BadRequestException('paymentId is required');
    }

    try {
      return await firstValueFrom(
        this.paymentsProtoService.getPaymentStatus({ paymentId }).pipe(timeout(timeoutMs)),
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        this.logger.error(
          `Get payment status timed out after ${timeoutMs}ms for paymentId=${paymentId}`,
        );
        throw new GatewayTimeoutException(`Get payment status timed out after ${timeoutMs}ms`);
      }
      this.logger.error(`Get payment status failed for paymentId=${paymentId}`, err);
      this.mapGrpcError(err);
    }
  }

  onModuleInit() {
    this.paymentsProtoService = this.client.getService<PaymentsProtoService>('Payments');
  }

  private mapGrpcError(err: unknown): never {
    const grpc = err as { code?: number; message?: string };
    const message = grpc.message ?? 'Payment service error';

    switch (grpc.code) {
      case GrpcStatus.NOT_FOUND:
        throw new NotFoundException(message);
      case GrpcStatus.INVALID_ARGUMENT:
        throw new BadRequestException(message);
      case GrpcStatus.ALREADY_EXISTS:
        throw new ConflictException(message);
      case GrpcStatus.UNAVAILABLE:
        throw new ServiceUnavailableException('Payment service is unavailable');
      default:
        throw new ServiceUnavailableException(message);
    }
  }
}
