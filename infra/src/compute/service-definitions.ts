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
const distrolessNodeBinaryPath = '/nodejs/bin/node';

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
  runtimeSecretVersionId: pulumi.Input<string>;
}

export const paymentsServiceDefaults = {
  containerName: 'payments',
  containerPort: paymentsContainerPort,
} as const;

export const shopServiceDefaults = {
  containerName: 'shop',
  containerPort: shopContainerPort,
} as const;

/**
 * Step 2.3 task-definition helper.
 * Accepts the payments image, log group name, runtime parameter names, and runtime secret ARN.
 * Returns the JSON-serialized ECS container definition for the payments gRPC task.
 */
export function buildPaymentsContainerDefinitions({
  imageUri,
  logGroupName,
  runtimeParameterNames,
  runtimeSecretArn,
  runtimeSecretVersionId,
}: BuildServiceContainerDefinitionArgs) {
  return pulumi.jsonStringify([
    {
      cpu: paymentsContainerCpu,
      environment: buildRuntimeVersionEnvironment(runtimeSecretVersionId),
      essential: true,
      healthCheck: buildNodeHealthCheck(paymentsHealthCheckCommand),
      image: imageUri,
      logConfiguration: buildLogConfiguration(logGroupName, paymentsServiceDefaults.containerName),
      memory: paymentsContainerMemory,
      name: paymentsServiceDefaults.containerName,
      portMappings: [
        {
          containerPort: paymentsServiceDefaults.containerPort,
          // Payments keeps a fixed host port so ECS bridge-mode tasks and Cloud Map SRV discovery
          // always expose gRPC on the same east-west port. That limits scheduling to one task per host.
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

/**
 * Step 2.3 task-definition helper.
 * Accepts the shop image, log group name, runtime parameter names, and runtime secret ARN.
 * Returns the JSON-serialized ECS container definition for the public shop task.
 */
export function buildShopContainerDefinitions({
  imageUri,
  logGroupName,
  runtimeParameterNames,
  runtimeSecretArn,
  runtimeSecretVersionId,
}: BuildServiceContainerDefinitionArgs) {
  return pulumi.jsonStringify([
    {
      cpu: shopContainerCpu,
      environment: buildRuntimeVersionEnvironment(runtimeSecretVersionId),
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

/**
 * Step 2.3 container helper.
 * Accepts the runtime parameter-name map plus the runtime secret ARN and required secret keys.
 * Returns the combined ECS secret descriptors that wire both SSM parameters and Secrets Manager entries into a container.
 */
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

/**
 * Step 2.3 logging helper.
 * Accepts the CloudWatch log group name and stream prefix.
 * Returns the ECS awslogs configuration block for a container definition.
 */
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

/**
 * Step 2.3 health-check helper.
 * Accepts the Node.js one-liner command used to probe the container.
 * Returns the ECS health-check block applied to container definitions.
 */
function buildNodeHealthCheck(command: string) {
  return {
    command: ['CMD', distrolessNodeBinaryPath, '-e', command],
    interval: healthCheckIntervalSeconds,
    retries: healthCheckRetries,
    startPeriod: healthCheckStartPeriodSeconds,
    timeout: healthCheckTimeoutSeconds,
  };
}

/**
 * Step 2.3 container helper.
 * Accepts the current runtime secret version id.
 * Returns a harmless environment marker so task definitions roll whenever the backing runtime secret version changes.
 */
function buildRuntimeVersionEnvironment(runtimeSecretVersionId: pulumi.Input<string>) {
  return [
    {
      name: 'RUNTIME_SECRET_VERSION',
      value: runtimeSecretVersionId,
    },
  ];
}
