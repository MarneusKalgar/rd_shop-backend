/* eslint-disable perfectionist/sort-modules */

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { commonTags, projectPrefix, stack, stackName } from '../bootstrap';
import { getFoundationRuntimeConfig } from './runtime-config-config';

interface CreateFoundationRuntimeConfigArgs {
  databases: {
    payments: ServiceDatabaseRuntimeConfig;
    shop: ServiceDatabaseRuntimeConfig;
  };
  fileStorage: {
    filesBucketName: pulumi.Input<string>;
  };
  messageQueue: {
    host: pulumi.Input<string>;
    port: pulumi.Input<number>;
  };
  publicAppUrl?: pulumi.Input<string>;
}

interface ServiceDatabaseRuntimeConfig {
  databaseHost: pulumi.Input<string>;
  databaseName: pulumi.Input<string>;
  databasePort: pulumi.Input<number>;
  databaseUsername: pulumi.Input<string>;
  masterUserSecretArn: pulumi.Input<null | string>;
}

interface DatabaseSecretValues {
  DATABASE_HOST: string;
  DATABASE_URL: string;
  POSTGRES_DB: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_USER: string;
}

interface RdsMasterUserSecretPayload {
  host?: string;
  password?: string;
  port?: number | string;
  username?: string;
}

type ParameterNameMap = Record<string, string>;

/**
 * Step 1.3-1.4 / runtime config.
 * Accepts resolved database endpoints, bucket name, broker endpoint, and optional public app URL.
 * Creates the service runtime Secrets Manager entries and SSM parameters, then returns the secret ARNs and parameter-name maps consumed by ECS.
 */
export function createFoundationRuntimeConfig({
  databases,
  fileStorage,
  messageQueue,
  publicAppUrl,
}: CreateFoundationRuntimeConfigArgs) {
  const runtimeConfig = getFoundationRuntimeConfig();

  const shopDatabaseSecretValues = buildDatabaseSecretValues({
    databaseHost: databases.shop.databaseHost,
    databaseName: databases.shop.databaseName,
    databasePort: databases.shop.databasePort,
    databaseUsername: databases.shop.databaseUsername,
    masterUserSecretArn: databases.shop.masterUserSecretArn,
    serviceName: 'shop',
  });
  const paymentsDatabaseSecretValues = buildDatabaseSecretValues({
    databaseHost: databases.payments.databaseHost,
    databaseName: databases.payments.databaseName,
    databasePort: databases.payments.databasePort,
    databaseUsername: databases.payments.databaseUsername,
    masterUserSecretArn: databases.payments.masterUserSecretArn,
    serviceName: 'payments',
  });

  const shopRuntimeSecret = createRuntimeSecret({
    description: 'Runtime secrets for shop service.',
    logicalName: 'shop-runtime-secret',
    secretName: `${projectPrefix}/shop/${stack}`,
    secretRecoveryWindowInDays: runtimeConfig.secretRecoveryWindowInDays,
    secretString: pulumi.secret(
      pulumi
        .all([
          shopDatabaseSecretValues,
          runtimeConfig.shop.secretValues!.JWT_ACCESS_SECRET!,
          runtimeConfig.shop.secretValues!.TOKEN_HMAC_SECRET!,
          runtimeConfig.shop.secretValues!.RABBITMQ_USER!,
          runtimeConfig.shop.secretValues!.RABBITMQ_PASSWORD!,
        ])
        .apply(
          ([
            databaseSecretValues,
            jwtAccessSecret,
            tokenHmacSecret,
            rabbitmqUser,
            rabbitmqPassword,
          ]) =>
            JSON.stringify({
              ...databaseSecretValues,
              JWT_ACCESS_SECRET: jwtAccessSecret,
              RABBITMQ_PASSWORD: rabbitmqPassword,
              RABBITMQ_USER: rabbitmqUser,
              TOKEN_HMAC_SECRET: tokenHmacSecret,
            }),
        ),
    ),
    serviceName: 'shop',
  });

  const paymentsRuntimeSecret = createRuntimeSecret({
    description: 'Runtime secrets for payments service.',
    logicalName: 'payments-runtime-secret',
    secretName: `${projectPrefix}/payments/${stack}`,
    secretRecoveryWindowInDays: runtimeConfig.secretRecoveryWindowInDays,
    secretString: pulumi.secret(
      paymentsDatabaseSecretValues.apply((databaseSecretValues) =>
        JSON.stringify(databaseSecretValues),
      ),
    ),
    serviceName: 'payments',
  });

  const shopParameterNames = createStringParameters({
    logicalNamePrefix: 'shop-parameter',
    parameterPathPrefix: `${runtimeConfig.parameterPathPrefix}/shop`,
    serviceName: 'shop',
    values: {
      APP_URL: publicAppUrl ?? runtimeConfig.shop.parameterValues.APP_URL,
      ...runtimeConfig.shop.parameterValues,
      AWS_REGION: aws.config.region ?? 'eu-central-1',
      AWS_S3_BUCKET: fileStorage.filesBucketName,
      CORS_ALLOWED_ORIGINS: publicAppUrl ?? runtimeConfig.shop.parameterValues.CORS_ALLOWED_ORIGINS,
      RABBITMQ_HOST: messageQueue.host,
      RABBITMQ_PORT: pulumi.output(messageQueue.port).apply((port) => String(port)),
    },
  });

  const paymentsParameterNames = createStringParameters({
    logicalNamePrefix: 'payments-parameter',
    parameterPathPrefix: `${runtimeConfig.parameterPathPrefix}/payments`,
    serviceName: 'payments',
    values: runtimeConfig.payments.parameterValues,
  });

  return {
    paymentsRuntimeParameterNames: paymentsParameterNames,
    paymentsRuntimeSecretArn: paymentsRuntimeSecret.arn,
    paymentsRuntimeSecretName: paymentsRuntimeSecret.name,
    paymentsRuntimeSecretVersionId: paymentsRuntimeSecret.versionId,
    shopRuntimeParameterNames: shopParameterNames,
    shopRuntimeSecretArn: shopRuntimeSecret.arn,
    shopRuntimeSecretName: shopRuntimeSecret.name,
    shopRuntimeSecretVersionId: shopRuntimeSecret.versionId,
  };
}

/**
 * Step 1.3-1.4 connection helper.
 * Accepts the resolved database host, port, name, username, and password.
 * Returns the SSL-enforced PostgreSQL connection URL stored in runtime secrets.
 */
function buildConnectionUrl({
  databaseName,
  host,
  password,
  port,
  username,
}: {
  databaseName: string;
  host: string;
  password: string;
  port: string;
  username: string;
}) {
  // URI userinfo must keep reserved characters encoded; the pg connection parser decodes before auth.
  // Keep libpq-compatible `require` semantics so ECS tools use TLS without failing on the
  // managed RDS certificate chain unless the URL explicitly asks for stricter verification.
  return `postgresql://${username}:${encodeURIComponent(password)}@${host}:${port}/${databaseName}?uselibpqcompat=true&sslmode=require`;
}

/**
 * Step 1.3-1.4 database-secret helper.
 * Accepts the resolved database endpoint metadata plus the RDS master-user secret ARN.
 * Reads the AWS-managed master secret, applies safe fallbacks, and returns the normalized database secret payload written into service runtime secrets.
 */
function buildDatabaseSecretValues({
  databaseHost,
  databaseName,
  databasePort,
  databaseUsername,
  masterUserSecretArn,
  serviceName,
}: {
  databaseHost: pulumi.Input<string>;
  databaseName: pulumi.Input<string>;
  databasePort: pulumi.Input<number>;
  databaseUsername: pulumi.Input<string>;
  masterUserSecretArn: pulumi.Input<null | string>;
  serviceName: string;
}) {
  const normalizedSecretArn = pulumi.output(masterUserSecretArn).apply((secretArn) => {
    if (!secretArn) {
      throw new Error(`${serviceName} database master secret ARN is not available.`);
    }

    return secretArn;
  });

  const masterUserSecretString = pulumi.secret(
    aws.secretsmanager.getSecretVersionOutput({
      secretId: normalizedSecretArn,
    }).secretString,
  );

  return pulumi.secret(
    pulumi
      .all([databaseHost, databaseName, databasePort, databaseUsername, masterUserSecretString])
      .apply(
        ([
          resolvedDatabaseHost,
          resolvedDatabaseName,
          resolvedDatabasePort,
          resolvedDatabaseUsername,
          secretString,
        ]) => {
          const secretPayload = JSON.parse(secretString) as RdsMasterUserSecretPayload;

          if (!secretPayload.password) {
            throw new Error(`${serviceName} database secret is missing required password field.`);
          }

          const databaseHostValue = secretPayload.host ?? resolvedDatabaseHost;
          const databasePortValue =
            typeof secretPayload.port === 'string'
              ? secretPayload.port
              : String(secretPayload.port ?? resolvedDatabasePort);
          const databaseUsernameValue = secretPayload.username ?? resolvedDatabaseUsername;

          if (!databaseHostValue || !databaseUsernameValue) {
            throw new Error(
              `${serviceName} database connection values are incomplete after fallback resolution.`,
            );
          }

          return {
            DATABASE_HOST: databaseHostValue,
            DATABASE_URL: buildConnectionUrl({
              databaseName: resolvedDatabaseName,
              host: databaseHostValue,
              password: secretPayload.password,
              port: databasePortValue,
              username: databaseUsernameValue,
            }),
            POSTGRES_DB: resolvedDatabaseName,
            POSTGRES_PASSWORD: secretPayload.password,
            POSTGRES_USER: databaseUsernameValue,
          } satisfies DatabaseSecretValues;
        },
      ),
  );
}

/**
 * Step 1.3-1.4 parameter helper.
 * Accepts the SSM parameter path prefix and environment variable key.
 * Returns the full SSM parameter name stored for that runtime setting.
 */
function buildParameterName(parameterPathPrefix: string, key: string) {
  return `${parameterPathPrefix}/${key}`;
}

/**
 * Step 1.3-1.4 parameter helper.
 * Accepts the logical Pulumi resource prefix and environment variable key.
 * Returns the stable Pulumi logical name used for the SSM parameter resource.
 */
function buildParameterResourceName(logicalNamePrefix: string, key: string) {
  return `${logicalNamePrefix}-${key.toLowerCase().replace(/_/g, '-')}`;
}

/**
 * Step 1.3-1.4 secret helper.
 * Accepts the secret metadata, recovery window, generated payload, and service tag.
 * Creates a Secrets Manager secret plus its current version and returns the secret identifiers.
 */
function createRuntimeSecret({
  description,
  logicalName,
  secretName,
  secretRecoveryWindowInDays,
  secretString,
  serviceName,
}: {
  description: string;
  logicalName: string;
  secretName: string;
  secretRecoveryWindowInDays: number;
  secretString: pulumi.Input<string>;
  serviceName: string;
}) {
  const secret = new aws.secretsmanager.Secret(stackName(logicalName), {
    description,
    name: secretName,
    recoveryWindowInDays: secretRecoveryWindowInDays,
    tags: {
      ...commonTags,
      Component: 'runtime-config',
      Name: secretName,
      Scope: 'private',
      Service: serviceName,
    },
  });

  const secretVersion = new aws.secretsmanager.SecretVersion(stackName(`${logicalName}-version`), {
    secretId: secret.id,
    secretString,
  });

  return {
    arn: secret.arn,
    name: secret.name,
    versionId: secretVersion.versionId,
  };
}

/**
 * Step 1.3-1.4 parameter helper.
 * Accepts the logical-name prefix, SSM path prefix, target service tag, and key/value map.
 * Creates one String SSM parameter per defined value and returns the map of environment keys to parameter names.
 */
function createStringParameters({
  logicalNamePrefix,
  parameterPathPrefix,
  serviceName,
  values,
}: {
  logicalNamePrefix: string;
  parameterPathPrefix: string;
  serviceName: string;
  values: Record<string, pulumi.Input<string> | undefined>;
}) {
  const parameterNames: ParameterNameMap = {};

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      continue;
    }

    const parameterName = buildParameterName(parameterPathPrefix, key);

    new aws.ssm.Parameter(stackName(buildParameterResourceName(logicalNamePrefix, key)), {
      description: `${serviceName} runtime config parameter ${key}.`,
      name: parameterName,
      tags: {
        ...commonTags,
        Component: 'runtime-config',
        Name: parameterName,
        Scope: 'private',
        Service: serviceName,
      },
      tier: 'Standard',
      type: 'String',
      value,
    });

    parameterNames[key] = parameterName;
  }

  return parameterNames;
}
