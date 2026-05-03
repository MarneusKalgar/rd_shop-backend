import * as pulumi from '@pulumi/pulumi';

import { config, projectPrefix, stack } from '../bootstrap';

const defaultBrokerDataVolumeDeviceName = '/dev/xvdf';
const defaultBrokerDataVolumeMountPath = '/var/lib/rabbitmq';
const defaultBrokerEngineVersion = '3.13';
const defaultBrokerImage = 'rabbitmq:3.13-management-alpine';
const defaultBrokerPort = 5672;
const defaultBrokerVhost = '/';
const defaultProductionBrokerDataVolumeSizeGiB = 20;
const defaultProductionBrokerInstanceType = 't3.small';
const defaultStageBrokerDataVolumeSizeGiB = 10;
const defaultStageBrokerInstanceType = 't3.micro';
const previewRabbitMqPassword = 'preview-only-shop-rabbitmq-password';
const previewRabbitMqUser = 'preview-only-shop-rabbitmq-user';

export interface MessageBrokerConfig {
  amiId?: string;
  brokerName: string;
  credentials: MessageQueueCredentials;
  dataVolumeDeviceName: string;
  dataVolumeMountPath: string;
  dataVolumeSizeGiB: number;
  engineVersion: string;
  image: string;
  instanceType: string;
  port: number;
  vhost: string;
}

export interface MessageQueueCredentials {
  password: pulumi.Output<string>;
  username: pulumi.Output<string>;
}

/**
 * Step 3 broker-config helper.
 * Accepts no arguments.
 * Resolves the RabbitMQ EC2 broker defaults and stack overrides, then returns the normalized broker configuration used by provisioning.
 */
export function getMessageBrokerConfig(): MessageBrokerConfig {
  const isProduction = stack === 'production';

  return {
    amiId: config.get('shopRabbitmqAmiId') ?? undefined,
    brokerName: config.get('shopRabbitmqBrokerName') ?? `${projectPrefix}-${stack}-shop-rabbitmq`,
    credentials: getMessageQueueCredentials(),
    dataVolumeDeviceName:
      config.get('shopRabbitmqDataVolumeDeviceName') ?? defaultBrokerDataVolumeDeviceName,
    dataVolumeMountPath:
      config.get('shopRabbitmqDataVolumeMountPath') ?? defaultBrokerDataVolumeMountPath,
    dataVolumeSizeGiB:
      config.getNumber('shopRabbitmqDataVolumeSizeGiB') ??
      (isProduction
        ? defaultProductionBrokerDataVolumeSizeGiB
        : defaultStageBrokerDataVolumeSizeGiB),
    engineVersion: config.get('shopRabbitmqEngineVersion') ?? defaultBrokerEngineVersion,
    image: config.get('shopRabbitmqImage') ?? defaultBrokerImage,
    instanceType:
      config.get('shopRabbitmqInstanceType') ??
      (isProduction ? defaultProductionBrokerInstanceType : defaultStageBrokerInstanceType),
    port: config.getNumber('shopRabbitmqPort') ?? defaultBrokerPort,
    vhost: config.get('shopRabbitmqVhost') ?? defaultBrokerVhost,
  };
}

/**
 * Step 3 credential helper.
 * Accepts no arguments.
 * Returns the RabbitMQ username and password outputs used by both broker bootstrap and runtime config wiring.
 */
export function getMessageQueueCredentials(): MessageQueueCredentials {
  return {
    password: getRequiredNonEmptySecretConfig('shopRabbitmqPassword', previewRabbitMqPassword),
    username: getRequiredNonEmptySecretConfig('shopRabbitmqUser', previewRabbitMqUser),
  };
}

/**
 * Step 3 secret helper.
 * Accepts the Pulumi config key name and the preview-only fallback value.
 * Returns the configured secret when present, a preview placeholder during dry runs, and throws on apply when the secret is missing.
 */
function getRequiredNonEmptySecretConfig(key: string, previewValue: string) {
  const configuredValue = config.getSecret(key);

  if (configuredValue) {
    return validateNonEmptySecret(key, configuredValue);
  }

  if (pulumi.runtime.isDryRun()) {
    return pulumi.secret(previewValue);
  }

  throw new Error(
    `Missing required secret config "${key}". Provide it via stack-local config or an imported Pulumi ESC environment (fallback: pulumi config set --secret ${key} <value>).`,
  );
}

/**
 * Step 3 validation helper.
 * Accepts the RabbitMQ secret key name and resolved secret output.
 * Returns the secret output unchanged after ensuring the value is not blank.
 */
function validateNonEmptySecret(key: string, secretValue: pulumi.Output<string>) {
  return secretValue.apply((value) => {
    if (!value.trim()) {
      throw new Error(`${key} cannot be empty.`);
    }

    return value;
  });
}
