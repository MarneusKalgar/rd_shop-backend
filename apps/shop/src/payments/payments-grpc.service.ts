import {
  BadRequestException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import CircuitBreaker from 'opossum';
import { firstValueFrom, Observable, timeout, TimeoutError } from 'rxjs';

import { BREAKER_OPTIONS, PAYMENTS_GRPC_CLIENT } from './constants';
import {
  AuthorizeRequest,
  AuthorizeResponse,
  GetPaymentStatusRequest,
  GetPaymentStatusResponse,
} from './interfaces';
import { mapGrpcError } from './utils';

interface PaymentsProtoService {
  authorize(request: AuthorizeRequest): Observable<AuthorizeResponse>;
  getPaymentStatus(request: GetPaymentStatusRequest): Observable<GetPaymentStatusResponse>;
}

@Injectable()
export class PaymentsGrpcService implements OnModuleInit {
  private authorizeBreaker: CircuitBreaker<[AuthorizeRequest], AuthorizeResponse>;
  private getPaymentStatusBreaker: CircuitBreaker<
    [GetPaymentStatusRequest],
    GetPaymentStatusResponse
  >;
  private readonly logger = new Logger(PaymentsGrpcService.name);
  private paymentsProtoService: PaymentsProtoService;

  constructor(
    @Inject(PAYMENTS_GRPC_CLIENT) private readonly client: ClientGrpc,
    private readonly configService: ConfigService,
  ) {}

  async authorize(request: AuthorizeRequest): Promise<AuthorizeResponse> {
    try {
      return await this.authorizeBreaker.fire(request);
    } catch (err) {
      if (err instanceof TimeoutError) {
        this.logger.error(`Payment authorization timed out for order=${request.orderId}`);
        throw new GatewayTimeoutException('Payment authorization timed out');
      }
      if ((err as Error).message === 'Breaker is open') {
        this.logger.warn(`authorize circuit breaker OPEN for order=${request.orderId}`);
        throw new ServiceUnavailableException('Payment service unavailable');
      }
      this.logger.error(`Payment authorization failed for order=${request.orderId}`, err);
      mapGrpcError(err);
    }
  }

  async getPaymentStatus(paymentId: string): Promise<GetPaymentStatusResponse> {
    if (!paymentId) {
      this.logger.error('getPaymentStatus called without paymentId');
      throw new BadRequestException('paymentId is required');
    }

    try {
      return await this.getPaymentStatusBreaker.fire({ paymentId });
    } catch (err) {
      if (err instanceof TimeoutError) {
        this.logger.error(`Get payment status timed out for paymentId=${paymentId}`);
        throw new GatewayTimeoutException('Get payment status timed out');
      }
      if ((err as Error).message === 'Breaker is open') {
        this.logger.warn(`getPaymentStatus circuit breaker OPEN for paymentId=${paymentId}`);
        throw new ServiceUnavailableException('Payment service unavailable');
      }
      this.logger.error(`Get payment status failed for paymentId=${paymentId}`, err);
      mapGrpcError(err);
    }
  }

  onModuleInit() {
    this.paymentsProtoService = this.client.getService<PaymentsProtoService>('Payments');
    const timeoutMs = this.configService.get<number>('PAYMENTS_GRPC_TIMEOUT_MS') ?? 5000;

    this.authorizeBreaker = new CircuitBreaker(
      (req: AuthorizeRequest) =>
        firstValueFrom(this.paymentsProtoService.authorize(req).pipe(timeout(timeoutMs))),
      BREAKER_OPTIONS,
    ) as CircuitBreaker<[AuthorizeRequest], AuthorizeResponse>;

    this.getPaymentStatusBreaker = new CircuitBreaker(
      (req: GetPaymentStatusRequest) =>
        firstValueFrom(this.paymentsProtoService.getPaymentStatus(req).pipe(timeout(timeoutMs))),
      BREAKER_OPTIONS,
    ) as CircuitBreaker<[GetPaymentStatusRequest], GetPaymentStatusResponse>;

    this.authorizeBreaker.on('open', () => this.logger.warn('authorize circuit breaker → OPEN'));
    this.authorizeBreaker.on('halfOpen', () =>
      this.logger.log('authorize circuit breaker → HALF-OPEN'),
    );
    this.authorizeBreaker.on('close', () => this.logger.log('authorize circuit breaker → CLOSED'));

    this.getPaymentStatusBreaker.on('open', () =>
      this.logger.warn('getPaymentStatus circuit breaker → OPEN'),
    );
    this.getPaymentStatusBreaker.on('halfOpen', () =>
      this.logger.log('getPaymentStatus circuit breaker → HALF-OPEN'),
    );
    this.getPaymentStatusBreaker.on('close', () =>
      this.logger.log('getPaymentStatus circuit breaker → CLOSED'),
    );
  }
}
