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
}

interface ServiceDatabaseRuntimeConfig {
  databaseName: pulumi.Input<string>;
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

export function createFoundationRuntimeConfig({
  databases,
  fileStorage,
}: CreateFoundationRuntimeConfigArgs) {
  const runtimeConfig = getFoundationRuntimeConfig();

  const shopDatabaseSecretValues = buildDatabaseSecretValues({
    databaseName: databases.shop.databaseName,
    masterUserSecretArn: databases.shop.masterUserSecretArn,
    serviceName: 'shop',
  });
  const paymentsDatabaseSecretValues = buildDatabaseSecretValues({
    databaseName: databases.payments.databaseName,
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
      ...runtimeConfig.shop.parameterValues,
      AWS_REGION: aws.config.region ?? 'eu-central-1',
      AWS_S3_BUCKET: fileStorage.filesBucketName,
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
    shopRuntimeParameterNames: shopParameterNames,
    shopRuntimeSecretArn: shopRuntimeSecret.arn,
    shopRuntimeSecretName: shopRuntimeSecret.name,
  };
}

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
  return `postgresql://${username}:${encodeURIComponent(password)}@${host}:${port}/${databaseName}?sslmode=require`;
}

function buildDatabaseSecretValues({
  databaseName,
  masterUserSecretArn,
  serviceName,
}: {
  databaseName: pulumi.Input<string>;
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
      .all([databaseName, masterUserSecretString])
      .apply(([resolvedDatabaseName, secretString]) => {
        const secretPayload = JSON.parse(secretString) as RdsMasterUserSecretPayload;

        if (!secretPayload.host || !secretPayload.password || !secretPayload.username) {
          throw new Error(`${serviceName} database secret is missing required connection fields.`);
        }

        const databasePort =
          typeof secretPayload.port === 'string'
            ? secretPayload.port
            : String(secretPayload.port ?? 5432);

        return {
          DATABASE_HOST: secretPayload.host,
          DATABASE_URL: buildConnectionUrl({
            databaseName: resolvedDatabaseName,
            host: secretPayload.host,
            password: secretPayload.password,
            port: databasePort,
            username: secretPayload.username,
          }),
          POSTGRES_DB: resolvedDatabaseName,
          POSTGRES_PASSWORD: secretPayload.password,
          POSTGRES_USER: secretPayload.username,
        } satisfies DatabaseSecretValues;
      }),
  );
}

function buildParameterName(parameterPathPrefix: string, key: string) {
  return `${parameterPathPrefix}/${key}`;
}

function buildParameterResourceName(logicalNamePrefix: string, key: string) {
  return `${logicalNamePrefix}-${key.toLowerCase().replace(/_/g, '-')}`;
}

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

  new aws.secretsmanager.SecretVersion(stackName(`${logicalName}-version`), {
    secretId: secret.id,
    secretString,
  });

  return {
    arn: secret.arn,
    name: secret.name,
  };
}

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
