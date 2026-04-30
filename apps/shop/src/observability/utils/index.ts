import { ConfigService } from '@nestjs/config';

export const shouldEnableObservabilityMetrics = (configService: ConfigService): boolean => {
  const deploymentEnvironment = configService.get<string>('DEPLOYMENT_ENVIRONMENT')?.toLowerCase();
  const metricsEnabled = configService.get<string>('OBSERVABILITY_METRICS_ENABLED') === 'true';

  return metricsEnabled && deploymentEnvironment === 'production';
};
