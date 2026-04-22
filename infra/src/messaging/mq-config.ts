import * as pulumi from '@pulumi/pulumi';

import { config, projectPrefix, stack } from '../bootstrap';

const defaultBrokerEngineType = 'RabbitMQ';
const defaultBrokerEngineVersion = '3.13';
const defaultProductionDeploymentMode = 'ACTIVE_STANDBY_MULTI_AZ';
const defaultProductionHostInstanceType = 'mq.m5.large';
const defaultStageDeploymentMode = 'SINGLE_INSTANCE';
const defaultStageHostInstanceType = 'mq.t3.micro';
const previewRabbitMqPassword = 'preview-only-shop-rabbitmq-password';
const previewRabbitMqUser = 'preview-only-shop-rabbitmq-user';

export interface MessageQueueConfig {
  applyImmediately: boolean;
  authenticationStrategy: 'simple';
  autoMinorVersionUpgrade: boolean;
  brokerName: string;
  credentials: MessageQueueCredentials;
  deploymentMode: 'ACTIVE_STANDBY_MULTI_AZ' | 'SINGLE_INSTANCE';
  engineType: 'RabbitMQ';
  engineVersion: string;
  hostInstanceType: string;
  publiclyAccessible: boolean;
}

export interface MessageQueueCredentials {
  password: pulumi.Output<string>;
  username: pulumi.Output<string>;
}

export function getMessageQueueConfig(): MessageQueueConfig {
  const isProduction = stack === 'production';

  return {
    applyImmediately: !isProduction,
    authenticationStrategy: 'simple',
    autoMinorVersionUpgrade: true,
    brokerName: config.get('shopRabbitmqBrokerName') ?? `${projectPrefix}-${stack}-shop-rabbitmq`,
    credentials: getMessageQueueCredentials(),
    deploymentMode:
      config.get('shopRabbitmqDeploymentMode') === 'ACTIVE_STANDBY_MULTI_AZ'
        ? 'ACTIVE_STANDBY_MULTI_AZ'
        : isProduction
          ? defaultProductionDeploymentMode
          : defaultStageDeploymentMode,
    engineType: defaultBrokerEngineType,
    engineVersion: config.get('shopRabbitmqEngineVersion') ?? defaultBrokerEngineVersion,
    hostInstanceType:
      config.get('shopRabbitmqHostInstanceType') ??
      (isProduction ? defaultProductionHostInstanceType : defaultStageHostInstanceType),
    publiclyAccessible: false,
  };
}

export function getMessageQueueCredentials(): MessageQueueCredentials {
  return {
    password: getRequiredNonEmptySecretConfig('shopRabbitmqPassword', previewRabbitMqPassword),
    username: getRequiredNonEmptySecretConfig('shopRabbitmqUser', previewRabbitMqUser),
  };
}

function getRequiredNonEmptySecretConfig(key: string, previewValue: string) {
  const configuredValue = config.getSecret(key);

  if (configuredValue) {
    return validateNonEmptySecret(key, configuredValue);
  }

  if (pulumi.runtime.isDryRun()) {
    return pulumi.secret(previewValue);
  }

  throw new Error(
    `Missing required secret config "${key}". Set it with pulumi config set --secret ${key} <value>.`,
  );
}

function validateNonEmptySecret(key: string, secretValue: pulumi.Output<string>) {
  return secretValue.apply((value) => {
    if (!value.trim()) {
      throw new Error(`${key} cannot be empty.`);
    }

    return value;
  });
}
