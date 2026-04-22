import { config, resourcePrefix, stack } from '../bootstrap';
import { getPublicDomainConfig } from '../public-domain';

const defaultAlbAccessLogsPrefix = 'alb';
const defaultAlbIdleTimeoutSeconds = 60;
const defaultHttpsSslPolicy = 'ELBSecurityPolicy-TLS13-1-2-2021-06';
const defaultShopTargetGroupDeregistrationDelaySeconds = 30;
const defaultShopTargetGroupHealthCheckMatcher = '200-399';
const defaultShopTargetGroupHealthCheckPath = '/ready';

export interface ComputeEdgeConfig {
  albAccessLogsBucketName: string;
  albAccessLogsPrefix: string;
  apiDomainName: string;
  enableDeletionProtection: boolean;
  hostedZoneId?: string;
  idleTimeoutSeconds: number;
  rootDomainName: string;
  shopTargetGroupDeregistrationDelaySeconds: number;
  shopTargetGroupHealthCheckMatcher: string;
  shopTargetGroupHealthCheckPath: string;
  sslPolicy: string;
}

export function getComputeEdgeConfig(): ComputeEdgeConfig | undefined {
  const publicDomainConfig = getPublicDomainConfig();

  if (!publicDomainConfig) {
    return undefined;
  }

  const albAccessLogsBucketName =
    normalizeOptionalValue(config.get('albAccessLogsBucketName')) ?? `${resourcePrefix}-alb-logs`;
  const albAccessLogsPrefix =
    normalizeOptionalValue(config.get('albAccessLogsPrefix')) ?? defaultAlbAccessLogsPrefix;
  const enableDeletionProtection =
    config.getBoolean('albDeletionProtectionEnabled') ?? stack === 'production';
  const idleTimeoutSeconds =
    config.getNumber('albIdleTimeoutSeconds') ?? defaultAlbIdleTimeoutSeconds;
  const shopTargetGroupDeregistrationDelaySeconds =
    config.getNumber('shopTargetGroupDeregistrationDelaySeconds') ??
    defaultShopTargetGroupDeregistrationDelaySeconds;
  const shopTargetGroupHealthCheckMatcher =
    normalizeOptionalValue(config.get('shopTargetGroupHealthCheckMatcher')) ??
    defaultShopTargetGroupHealthCheckMatcher;
  const shopTargetGroupHealthCheckPath =
    normalizeOptionalValue(config.get('shopTargetGroupHealthCheckPath')) ??
    defaultShopTargetGroupHealthCheckPath;
  const sslPolicy = normalizeOptionalValue(config.get('albSslPolicy')) ?? defaultHttpsSslPolicy;

  validateAccessLogsBucketName(albAccessLogsBucketName);
  validateIdleTimeoutSeconds(idleTimeoutSeconds);
  validateString('albAccessLogsPrefix', albAccessLogsPrefix);
  validateString('albSslPolicy', sslPolicy);
  validateString('shopTargetGroupHealthCheckMatcher', shopTargetGroupHealthCheckMatcher);
  validateHealthCheckPath(shopTargetGroupHealthCheckPath);
  validatePositiveInteger(
    'shopTargetGroupDeregistrationDelaySeconds',
    shopTargetGroupDeregistrationDelaySeconds,
  );

  return {
    albAccessLogsBucketName,
    albAccessLogsPrefix,
    apiDomainName: publicDomainConfig.apiDomainName,
    enableDeletionProtection,
    hostedZoneId: publicDomainConfig.hostedZoneId,
    idleTimeoutSeconds,
    rootDomainName: publicDomainConfig.rootDomainName,
    shopTargetGroupDeregistrationDelaySeconds,
    shopTargetGroupHealthCheckMatcher,
    shopTargetGroupHealthCheckPath,
    sslPolicy,
  };
}

function normalizeOptionalValue(value: string | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue && trimmedValue.length > 0 ? trimmedValue : undefined;
}

function validateAccessLogsBucketName(bucketName: string) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName)) {
    throw new Error('albAccessLogsBucketName must be a valid S3 bucket name.');
  }
}

function validateHealthCheckPath(path: string) {
  if (!path.startsWith('/')) {
    throw new Error('shopTargetGroupHealthCheckPath must start with "/".');
  }
}

function validateIdleTimeoutSeconds(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 4000) {
    throw new Error('albIdleTimeoutSeconds must be an integer between 1 and 4000.');
  }
}

function validatePositiveInteger(label: string, value: number) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function validateString(label: string, value: string) {
  if (value.trim().length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }
}
