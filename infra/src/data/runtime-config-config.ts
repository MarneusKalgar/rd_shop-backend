/* eslint-disable perfectionist/sort-modules */

import * as pulumi from '@pulumi/pulumi';

import { config, projectPrefix, region, stack } from '../bootstrap';
import { getMessageQueueCredentials } from '../messaging/mq-config';
import { getPublicDomainConfig } from '../public-domain';

const defaultPaymentsAppLogLevel = stack === 'production' ? 'log' : 'debug';
const defaultPaymentsDatabaseProvider = 'postgres';
const defaultPaymentsGrpcBindHost = '0.0.0.0';
const defaultPaymentsGrpcPort = 5001;
const defaultShopAllowSeedInProduction = 'false';
const defaultShopAppLogLevel = stack === 'production' ? 'log' : 'debug';
const configuredPublicDomain = getPublicDomainConfig();
const defaultShopAppUrl = configuredPublicDomain
  ? `https://${configuredPublicDomain.apiDomainName}`
  : stack === 'production'
    ? `https://${projectPrefix}.example.com`
    : `https://${stack}.${projectPrefix}.example.com`;
const defaultShopBcryptSaltRounds = 10;
const defaultShopCorsAllowedOrigins = configuredPublicDomain
  ? `https://${configuredPublicDomain.apiDomainName}`
  : stack === 'production'
    ? `https://${projectPrefix}.example.com`
    : `https://${stack}.${projectPrefix}.example.com`;
const defaultShopDatabaseProvider = 'postgres';
const defaultShopDbPoolSize = 10;
const defaultShopDbSlowQueryThresholdMs = 500;
const defaultShopEmailVerificationExpiresIn = '24h';
const defaultShopEventLoopLagThresholdMs = 100;
const defaultShopJwtAccessExpiresIn = '1h';
const defaultShopJwtRefreshExpiresIn = '7d';
const defaultShopPasswordResetExpiresIn = '1h';
const defaultShopPaymentsGrpcHost = 'payments.rd-shop.local';
const defaultShopPaymentsGrpcPort = 5001;
const defaultShopPaymentsGrpcTimeoutMs = 5000;
const defaultShopPort = 8080;
const defaultShopRabbitmqDisablePaymentsAuthorization = 'false';
const defaultShopRabbitmqHost = `pending-${stack}-rabbitmq-broker`;
const defaultShopRabbitmqPort = 5672;
const defaultShopRabbitmqPrefetchCount = 10;
const defaultShopRabbitmqVhost = '/';
const defaultShopS3PresignedUrlDownloadExpiration = 3600;
const defaultShopS3PresignedUrlExpiration = 900;
const defaultShopSesFromAddress = 'noreply@rdshop.com';
const defaultShopThrottleSkip = 'false';
const defaultShopVerboseTestLogs = 'false';
const defaultRuntimeNodeEnv = 'production';
const minimumJwtAccessSecretLength = 32;
const minimumTokenHmacSecretLength = 32;

type ParameterValues = Record<string, pulumi.Input<string> | undefined>;

interface ServiceSecretValues {
  JWT_ACCESS_SECRET?: pulumi.Output<string>;
  RABBITMQ_PASSWORD?: pulumi.Output<string>;
  RABBITMQ_USER?: pulumi.Output<string>;
  TOKEN_HMAC_SECRET?: pulumi.Output<string>;
}

interface ServiceRuntimeConfig {
  parameterValues: ParameterValues;
  secretValues?: ServiceSecretValues;
}

export interface FoundationRuntimeConfig {
  parameterPathPrefix: string;
  payments: ServiceRuntimeConfig;
  secretRecoveryWindowInDays: number;
  shop: ServiceRuntimeConfig;
}

/**
 * Step 1.3-1.4 runtime-config helper.
 * Accepts no arguments.
 * Resolves the full set of SSM parameter values and secret-backed runtime values that later provisioning writes for both services.
 */
export function getFoundationRuntimeConfig(): FoundationRuntimeConfig {
  const messageQueueCredentials = getMessageQueueCredentials();

  return {
    parameterPathPrefix: `/${projectPrefix}/${stack}`,
    payments: {
      parameterValues: {
        APP: 'payments',
        APP_LOG_LEVEL: config.get('paymentsAppLogLevel') ?? defaultPaymentsAppLogLevel,
        DATABASE_PROVIDER:
          config.get('paymentsDatabaseProvider') ?? defaultPaymentsDatabaseProvider,
        NODE_ENV: config.get('paymentsNodeEnv') ?? defaultRuntimeNodeEnv,
        PAYMENTS_GRPC_HOST: config.get('paymentsGrpcHost') ?? defaultPaymentsGrpcBindHost,
        PAYMENTS_GRPC_PORT: String(config.getNumber('paymentsGrpcPort') ?? defaultPaymentsGrpcPort),
      },
    },
    secretRecoveryWindowInDays: stack === 'production' ? 30 : 0,
    shop: {
      parameterValues: {
        ALLOW_SEED_IN_PRODUCTION:
          config.get('shopAllowSeedInProduction') ?? defaultShopAllowSeedInProduction,
        APP: 'shop',
        APP_LOG_LEVEL: config.get('shopAppLogLevel') ?? defaultShopAppLogLevel,
        APP_URL: config.get('shopAppUrl') ?? defaultShopAppUrl,
        AWS_CLOUDFRONT_URL: config.get('shopCloudFrontUrl'),
        AWS_S3_PRESIGNED_URL_DOWNLOAD_EXPIRATION: String(
          config.getNumber('shopS3PresignedUrlDownloadExpiration') ??
            defaultShopS3PresignedUrlDownloadExpiration,
        ),
        AWS_S3_PRESIGNED_URL_EXPIRATION: String(
          config.getNumber('shopS3PresignedUrlExpiration') ?? defaultShopS3PresignedUrlExpiration,
        ),
        AWS_SES_REGION: config.get('shopSesRegion') ?? region,
        BCRYPT_SALT_ROUNDS: String(
          config.getNumber('shopBcryptSaltRounds') ?? defaultShopBcryptSaltRounds,
        ),
        CORS_ALLOWED_ORIGINS: config.get('shopCorsAllowedOrigins') ?? defaultShopCorsAllowedOrigins,
        DATABASE_PROVIDER: config.get('shopDatabaseProvider') ?? defaultShopDatabaseProvider,
        DB_POOL_SIZE: String(config.getNumber('shopDbPoolSize') ?? defaultShopDbPoolSize),
        DB_SLOW_QUERY_THRESHOLD_MS: String(
          config.getNumber('shopDbSlowQueryThresholdMs') ?? defaultShopDbSlowQueryThresholdMs,
        ),
        DEPLOYMENT_ENVIRONMENT: stack,
        EMAIL_VERIFICATION_EXPIRES_IN:
          config.get('shopEmailVerificationExpiresIn') ?? defaultShopEmailVerificationExpiresIn,
        EVENT_LOOP_LAG_THRESHOLD_MS: String(
          config.getNumber('shopEventLoopLagThresholdMs') ?? defaultShopEventLoopLagThresholdMs,
        ),
        JWT_ACCESS_EXPIRES_IN:
          config.get('shopJwtAccessExpiresIn') ?? defaultShopJwtAccessExpiresIn,
        JWT_REFRESH_EXPIRES_IN:
          config.get('shopJwtRefreshExpiresIn') ?? defaultShopJwtRefreshExpiresIn,
        NODE_ENV: config.get('shopNodeEnv') ?? defaultRuntimeNodeEnv,
        PASSWORD_RESET_EXPIRES_IN:
          config.get('shopPasswordResetExpiresIn') ?? defaultShopPasswordResetExpiresIn,
        PAYMENTS_GRPC_HOST: config.get('shopPaymentsGrpcHost') ?? defaultShopPaymentsGrpcHost,
        PAYMENTS_GRPC_PORT: String(
          config.getNumber('shopPaymentsGrpcPort') ?? defaultShopPaymentsGrpcPort,
        ),
        PAYMENTS_GRPC_TIMEOUT_MS: String(
          config.getNumber('shopPaymentsGrpcTimeoutMs') ?? defaultShopPaymentsGrpcTimeoutMs,
        ),
        PORT: String(config.getNumber('shopPort') ?? defaultShopPort),
        RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION:
          config.get('shopRabbitmqDisablePaymentsAuthorization') ??
          defaultShopRabbitmqDisablePaymentsAuthorization,
        RABBITMQ_HOST: config.get('shopRabbitmqHost') ?? defaultShopRabbitmqHost,
        RABBITMQ_PORT: String(config.getNumber('shopRabbitmqPort') ?? defaultShopRabbitmqPort),
        RABBITMQ_PREFETCH_COUNT: String(
          config.getNumber('shopRabbitmqPrefetchCount') ?? defaultShopRabbitmqPrefetchCount,
        ),
        RABBITMQ_VHOST: config.get('shopRabbitmqVhost') ?? defaultShopRabbitmqVhost,
        SES_FROM_ADDRESS: config.get('shopSesFromAddress') ?? defaultShopSesFromAddress,
        THROTTLE_SKIP: config.get('shopThrottleSkip') ?? defaultShopThrottleSkip,
        VERBOSE_TEST_LOGS: config.get('shopVerboseTestLogs') ?? defaultShopVerboseTestLogs,
      },
      secretValues: {
        JWT_ACCESS_SECRET: getRequiredSecretConfig(
          'shopJwtAccessSecret',
          minimumJwtAccessSecretLength,
        ),
        RABBITMQ_PASSWORD: messageQueueCredentials.password,
        RABBITMQ_USER: messageQueueCredentials.username,
        TOKEN_HMAC_SECRET: getRequiredSecretConfig(
          'shopTokenHmacSecret',
          minimumTokenHmacSecretLength,
        ),
      },
    },
  };
}

/**
 * Step 1.3-1.4 secret helper.
 * Accepts the Pulumi config key name and its minimum required length.
 * Returns the configured secret value, or a preview-only placeholder during dry runs, and throws when no real value exists for apply.
 */
function getRequiredSecretConfig(key: string, minimumLength: number) {
  const configuredValue = config.getSecret(key);

  if (configuredValue) {
    return validateSecretLength(key, configuredValue, minimumLength);
  }

  if (pulumi.runtime.isDryRun()) {
    return pulumi.secret(buildPreviewSecretValue(key, minimumLength));
  }

  throw new Error(
    `Missing required secret config "${key}". Set it with pulumi config set --secret ${key} <value>.`,
  );
}

/**
 * Step 1.3-1.4 preview helper.
 * Accepts the secret key name and minimum length.
 * Returns a deterministic preview placeholder string long enough for validation during `pulumi preview`.
 */
function buildPreviewSecretValue(key: string, minimumLength: number) {
  const repeatedValue = `preview-only-${key}-`;

  while (repeatedValue.length < minimumLength) {
    return repeatedValue.repeat(Math.ceil(minimumLength / repeatedValue.length));
  }

  return repeatedValue;
}

/**
 * Step 1.3-1.4 validation helper.
 * Accepts the secret config key, resolved secret output, and minimum length.
 * Returns the secret output unchanged after enforcing the minimum required length.
 */
function validateSecretLength(
  key: string,
  secretValue: pulumi.Output<string>,
  minimumLength: number,
) {
  return secretValue.apply((value) => {
    if (value.length < minimumLength) {
      throw new Error(`${key} must be at least ${minimumLength} characters long.`);
    }

    return value;
  });
}
