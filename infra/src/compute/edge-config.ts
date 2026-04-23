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
  apiDomainName?: string;
  enableDeletionProtection: boolean;
  hostedZoneId?: string;
  idleTimeoutSeconds: number;
  publicEdgeMode: PublicEdgeMode;
  rootDomainName?: string;
  shopTargetGroupDeregistrationDelaySeconds: number;
  shopTargetGroupHealthCheckMatcher: string;
  shopTargetGroupHealthCheckPath: string;
  sslPolicy: string;
}

export type PublicEdgeMode = 'cloudfront' | 'custom-domain' | 'disabled';

/**
 * Step 2.4-2.5 edge-config helper.
 * Accepts no arguments.
 * Resolves the public edge mode, ALB settings, and optional custom-domain inputs used by edge provisioning.
 */
export function getComputeEdgeConfig(): ComputeEdgeConfig | undefined {
  const publicDomainConfig = getPublicDomainConfig();
  const publicEdgeMode = resolvePublicEdgeMode(
    normalizeOptionalValue(config.get('publicEdgeMode')),
    publicDomainConfig !== undefined,
  );

  if (publicEdgeMode === 'disabled') {
    return undefined;
  }

  if (publicEdgeMode === 'custom-domain' && !publicDomainConfig) {
    throw new Error(
      'publicEdgeMode=custom-domain requires publicRootDomainName and optional publicHostedZoneId.',
    );
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
    apiDomainName: publicDomainConfig?.apiDomainName,
    enableDeletionProtection,
    hostedZoneId: publicDomainConfig?.hostedZoneId,
    idleTimeoutSeconds,
    publicEdgeMode,
    rootDomainName: publicDomainConfig?.rootDomainName,
    shopTargetGroupDeregistrationDelaySeconds,
    shopTargetGroupHealthCheckMatcher,
    shopTargetGroupHealthCheckPath,
    sslPolicy,
  };
}

/**
 * Step 2.4-2.5 normalization helper.
 * Accepts an optional raw config string.
 * Returns the trimmed value when present, otherwise `undefined`.
 */
function normalizeOptionalValue(value: string | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue && trimmedValue.length > 0 ? trimmedValue : undefined;
}

/**
 * Step 2.4-2.5 edge-mode helper.
 * Accepts the configured public edge mode plus whether domain config exists.
 * Returns the effective edge mode after applying defaults and throws on unknown values.
 */
function resolvePublicEdgeMode(
  configuredMode: string | undefined,
  hasPublicDomainConfig: boolean,
): PublicEdgeMode {
  if (!configuredMode) {
    return hasPublicDomainConfig ? 'custom-domain' : 'disabled';
  }

  if (
    configuredMode === 'cloudfront' ||
    configuredMode === 'custom-domain' ||
    configuredMode === 'disabled'
  ) {
    return configuredMode;
  }

  throw new Error('publicEdgeMode must be one of: disabled, custom-domain, cloudfront.');
}

/**
 * Step 2.4-2.5 validation helper.
 * Accepts the ALB access-logs bucket name.
 * Throws when the bucket name would violate S3 naming rules.
 */
function validateAccessLogsBucketName(bucketName: string) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName)) {
    throw new Error('albAccessLogsBucketName must be a valid S3 bucket name.');
  }
}

/**
 * Step 2.4-2.5 validation helper.
 * Accepts the target-group health-check path.
 * Throws when the path does not start with `/`.
 */
function validateHealthCheckPath(path: string) {
  if (!path.startsWith('/')) {
    throw new Error('shopTargetGroupHealthCheckPath must start with "/".');
  }
}

/**
 * Step 2.4-2.5 validation helper.
 * Accepts the ALB idle timeout in seconds.
 * Throws when the timeout falls outside the supported AWS range.
 */
function validateIdleTimeoutSeconds(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 4000) {
    throw new Error('albIdleTimeoutSeconds must be an integer between 1 and 4000.');
  }
}

/**
 * Step 2.4-2.5 validation helper.
 * Accepts a config label and integer value.
 * Throws when the supplied integer is not positive.
 */
function validatePositiveInteger(label: string, value: number) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

/**
 * Step 2.4-2.5 validation helper.
 * Accepts a config label and string value.
 * Throws when the supplied string is empty after trimming.
 */
function validateString(label: string, value: string) {
  if (value.trim().length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }
}
