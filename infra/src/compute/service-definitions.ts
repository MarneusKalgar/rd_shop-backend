import * as pulumi from '@pulumi/pulumi';

import { region } from '../bootstrap';

const shopContainerPort = 8080;
const paymentsContainerPort = 5001;
const shopContainerCpu = 384;
const shopContainerMemory = 400;
const paymentsContainerCpu = 128;
const paymentsContainerMemory = 300;
const healthCheckIntervalSeconds = 30;
const healthCheckTimeoutSeconds = 5;
const healthCheckRetries = 3;
const healthCheckStartPeriodSeconds = 30;

const paymentsRuntimeSecretKeys = [
  'DATABASE_HOST',
  'DATABASE_URL',
  'POSTGRES_DB',
  'POSTGRES_PASSWORD',
  'POSTGRES_USER',
] as const;

const shopRuntimeSecretKeys = [
  ...paymentsRuntimeSecretKeys,
  'JWT_ACCESS_SECRET',
  'RABBITMQ_PASSWORD',
  'RABBITMQ_USER',
  'TOKEN_HMAC_SECRET',
] as const;

const shopHealthCheckCommand =
  "require('http').get('http://127.0.0.1:8080/health', (response) => process.exit(response.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))";
const paymentsHealthCheckCommand =
  "require('net').createConnection(5001, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1))";

export type RuntimeParameterNames = Record<string, pulumi.Input<string>>;

interface BuildServiceContainerDefinitionArgs {
  imageUri: pulumi.Input<string>;
  logGroupName: pulumi.Input<string>;
  runtimeParameterNames: RuntimeParameterNames;
  runtimeSecretArn: pulumi.Input<string>;
}

export const paymentsServiceDefaults = {
  containerName: 'payments',
  containerPort: paymentsContainerPort,
} as const;

export const shopServiceDefaults = {
  containerName: 'shop',
  containerPort: shopContainerPort,
} as const;

export function buildPaymentsContainerDefinitions({
  imageUri,
  logGroupName,
  runtimeParameterNames,
  runtimeSecretArn,
}: BuildServiceContainerDefinitionArgs) {
  return pulumi.jsonStringify([
    {
      cpu: paymentsContainerCpu,
      essential: true,
      healthCheck: buildNodeHealthCheck(paymentsHealthCheckCommand),
      image: imageUri,
      logConfiguration: buildLogConfiguration(logGroupName, paymentsServiceDefaults.containerName),
      memory: paymentsContainerMemory,
      name: paymentsServiceDefaults.containerName,
      portMappings: [
        {
          containerPort: paymentsServiceDefaults.containerPort,
          hostPort: paymentsServiceDefaults.containerPort,
          protocol: 'tcp',
        },
      ],
      secrets: buildContainerSecrets({
        parameterNames: runtimeParameterNames,
        runtimeSecretArn,
        runtimeSecretKeys: paymentsRuntimeSecretKeys,
      }),
    },
  ]);
}

export function buildShopContainerDefinitions({
  imageUri,
  logGroupName,
  runtimeParameterNames,
  runtimeSecretArn,
}: BuildServiceContainerDefinitionArgs) {
  return pulumi.jsonStringify([
    {
      cpu: shopContainerCpu,
      essential: true,
      healthCheck: buildNodeHealthCheck(shopHealthCheckCommand),
      image: imageUri,
      logConfiguration: buildLogConfiguration(logGroupName, shopServiceDefaults.containerName),
      memory: shopContainerMemory,
      name: shopServiceDefaults.containerName,
      portMappings: [
        {
          containerPort: shopServiceDefaults.containerPort,
          hostPort: 0,
          protocol: 'tcp',
        },
      ],
      secrets: buildContainerSecrets({
        parameterNames: runtimeParameterNames,
        runtimeSecretArn,
        runtimeSecretKeys: shopRuntimeSecretKeys,
      }),
    },
  ]);
}

function buildContainerSecrets({
  parameterNames,
  runtimeSecretArn,
  runtimeSecretKeys,
}: {
  parameterNames: RuntimeParameterNames;
  runtimeSecretArn: pulumi.Input<string>;
  runtimeSecretKeys: readonly string[];
}) {
  const parameterSecrets = Object.entries(parameterNames)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([name, valueFrom]) => ({
      name,
      valueFrom,
    }));

  const runtimeSecrets = runtimeSecretKeys.map((name) => ({
    name,
    valueFrom: pulumi.interpolate`${runtimeSecretArn}:${name}::`,
  }));

  return [...parameterSecrets, ...runtimeSecrets];
}

function buildLogConfiguration(logGroupName: pulumi.Input<string>, streamPrefix: string) {
  return {
    logDriver: 'awslogs',
    options: {
      'awslogs-group': logGroupName,
      'awslogs-region': region,
      'awslogs-stream-prefix': streamPrefix,
    },
  };
}

function buildNodeHealthCheck(command: string) {
  return {
    command: ['CMD', 'node', '-e', command],
    interval: healthCheckIntervalSeconds,
    retries: healthCheckRetries,
    startPeriod: healthCheckStartPeriodSeconds,
    timeout: healthCheckTimeoutSeconds,
  };
}
