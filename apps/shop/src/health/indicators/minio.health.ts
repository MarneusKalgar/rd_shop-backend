import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { S3Service } from '@/files/s3.service';

@Injectable()
export class MinioHealthIndicator {
  private readonly logger = new Logger(MinioHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly s3Service: S3Service,
  ) {}

  async check(key = 'minio'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      await this.s3Service.healthCheck();
      return indicator.up();
    } catch (error: unknown) {
      this.logger.error('MinIO health check failed: ', error);
      return indicator.down();
    }
  }
}
