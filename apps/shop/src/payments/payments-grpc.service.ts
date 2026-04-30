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
import CircuitBreaker from 'opossum';
import { firstValueFrom, Observable, timeout, TimeoutError } from 'rxjs';

import { GrpcClientMetricsService } from '@/observability';

import { BREAKER_OPTIONS, PAYMENTS_GRPC_CLIENT } from './constants';
import {
  AuthorizeRequest,
  AuthorizeResponse,
  GetPaymentStatusRequest,
  GetPaymentStatusResponse,
} from './interfaces';
import { PaymentsGrpcClient } from './payments-grpc-client.service';
import { mapGrpcError } from './utils';

interface PaymentsProtoService {
  authorize(request: AuthorizeRequest): Observable<AuthorizeResponse>;
  getPaymentStatus(request: GetPaymentStatusRequest): Observable<GetPaymentStatusResponse>;
}

@Injectable()
export class PaymentsGrpcService implements OnModuleInit {
  private static readonly PEER_SERVICE = 'payments';
  private authorizeBreaker: CircuitBreaker<[AuthorizeRequest], AuthorizeResponse>;
  private getPaymentStatusBreaker: CircuitBreaker<
    [GetPaymentStatusRequest],
    GetPaymentStatusResponse
  >;
  private readonly logger = new Logger(PaymentsGrpcService.name);
  private paymentsProtoService: PaymentsProtoService;

  constructor(
    @Inject(PAYMENTS_GRPC_CLIENT) private readonly client: PaymentsGrpcClient,
    private readonly configService: ConfigService,
    private readonly grpcClientMetricsService: GrpcClientMetricsService,
  ) {}

  async authorize(request: AuthorizeRequest): Promise<AuthorizeResponse> {
    const startNs = process.hrtime.bigint();

    try {
      const response = await this.authorizeBreaker.fire(request);

      this.recordClientMetrics({
        durationMs: this.getDurationMs(startNs),
        method: 'authorize',
        outcome: 'success',
      });

      return response;
    } catch (err) {
      if (err instanceof TimeoutError) {
        this.recordClientMetrics({
          durationMs: this.getDurationMs(startNs),
          method: 'authorize',
          outcome: 'timeout',
        });
        this.logger.error(`Payment authorization timed out for order=${request.orderId}`);
        throw new GatewayTimeoutException('Payment authorization timed out');
      }

      this.recordClientMetrics({
        durationMs: this.getDurationMs(startNs),
        method: 'authorize',
        outcome: 'error',
      });

      if ((err as { code?: string }).code === 'EOPENBREAKER') {
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

    const startNs = process.hrtime.bigint();

    try {
      const response = await this.getPaymentStatusBreaker.fire({ paymentId });

      this.recordClientMetrics({
        durationMs: this.getDurationMs(startNs),
        method: 'getPaymentStatus',
        outcome: 'success',
      });

      return response;
    } catch (err) {
      if (err instanceof TimeoutError) {
        this.recordClientMetrics({
          durationMs: this.getDurationMs(startNs),
          method: 'getPaymentStatus',
          outcome: 'timeout',
        });
        this.logger.error(`Get payment status timed out for paymentId=${paymentId}`);
        throw new GatewayTimeoutException('Get payment status timed out');
      }

      this.recordClientMetrics({
        durationMs: this.getDurationMs(startNs),
        method: 'getPaymentStatus',
        outcome: 'error',
      });

      if ((err as { code?: string }).code === 'EOPENBREAKER') {
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

  /**
   * Converts a monotonic start time to milliseconds for metric emission.
   */
  private getDurationMs(startNs: bigint): number {
    return Number(process.hrtime.bigint() - startNs) / 1_000_000;
  }

  /**
   * Emits both gRPC client count and duration metrics for one outbound RPC.
   */
  private recordClientMetrics(args: {
    durationMs: number;
    method: string;
    outcome: 'error' | 'success' | 'timeout';
  }): void {
    this.grpcClientMetricsService.recordRequest({
      method: args.method,
      outcome: args.outcome,
      peerService: PaymentsGrpcService.PEER_SERVICE,
    });
    this.grpcClientMetricsService.recordDuration({
      durationMs: args.durationMs,
      method: args.method,
      peerService: PaymentsGrpcService.PEER_SERVICE,
    });
  }
}
