import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { firstValueFrom, Observable, timeout } from 'rxjs';

import { PAYMENTS_GRPC_CLIENT } from '@/payments/constants';
import { PaymentsGrpcClient } from '@/payments/payments-grpc-client.service';

interface PaymentsPingService {
  ping(request: Record<string, never>): Observable<{ status: string }>;
}

@Injectable()
export class PaymentsHealthIndicator implements OnModuleInit {
  private readonly logger = new Logger(PaymentsHealthIndicator.name);
  private pingService: PaymentsPingService;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(PAYMENTS_GRPC_CLIENT) private readonly client: PaymentsGrpcClient,
    private readonly configService: ConfigService,
  ) {}

  async check(key = 'payments'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const timeoutMs = this.configService.get<number>('PAYMENTS_GRPC_TIMEOUT_MS') ?? 5000;

    try {
      await firstValueFrom(this.pingService.ping({}).pipe(timeout(timeoutMs)));
      return indicator.up();
    } catch (error: unknown) {
      this.logger.error('Payments health check failed: ', error);
      return indicator.down();
    }
  }

  onModuleInit() {
    this.pingService = this.client.getService<PaymentsPingService>('Payments');
  }
}
