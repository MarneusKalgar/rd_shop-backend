import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { commonTags, stackName } from '../bootstrap';
import { getMessageQueueConfig } from './mq-config';

interface CreateMessageQueueArgs {
  privateSubnetIds: pulumi.Input<pulumi.Input<string>[]>;
  securityGroupId: pulumi.Input<string>;
}

export function createMessageQueue({ privateSubnetIds, securityGroupId }: CreateMessageQueueArgs) {
  const messageQueueConfig = getMessageQueueConfig();
  const selectedSubnetIds = pulumi.output(privateSubnetIds).apply((subnetIds) => {
    const requiredSubnetCount =
      messageQueueConfig.deploymentMode === 'ACTIVE_STANDBY_MULTI_AZ' ? 2 : 1;

    if (subnetIds.length < requiredSubnetCount) {
      throw new Error(
        `AmazonMQ deployment mode ${messageQueueConfig.deploymentMode} requires at least ${requiredSubnetCount} private subnet(s).`,
      );
    }

    return subnetIds.slice(0, requiredSubnetCount);
  });

  const broker = new aws.mq.Broker(stackName('shop-rabbitmq-broker'), {
    applyImmediately: messageQueueConfig.applyImmediately,
    authenticationStrategy: messageQueueConfig.authenticationStrategy,
    autoMinorVersionUpgrade: messageQueueConfig.autoMinorVersionUpgrade,
    brokerName: messageQueueConfig.brokerName,
    deploymentMode: messageQueueConfig.deploymentMode,
    engineType: messageQueueConfig.engineType,
    engineVersion: messageQueueConfig.engineVersion,
    hostInstanceType: messageQueueConfig.hostInstanceType,
    publiclyAccessible: messageQueueConfig.publiclyAccessible,
    securityGroups: [securityGroupId],
    subnetIds: selectedSubnetIds,
    tags: {
      ...commonTags,
      Component: 'queue',
      Name: messageQueueConfig.brokerName,
      Scope: 'private',
      Service: 'shop',
    },
    users: [
      {
        password: messageQueueConfig.credentials.password,
        username: messageQueueConfig.credentials.username,
      },
    ],
  });

  const brokerEndpoint = broker.instances.apply((instances) => {
    const endpoint = instances[0]?.endpoints[0];

    if (!endpoint) {
      throw new Error('AmazonMQ broker endpoint is not available.');
    }

    return endpoint;
  });

  const brokerHost = brokerEndpoint.apply((endpoint) => new URL(endpoint).hostname);
  const brokerPort = brokerEndpoint.apply((endpoint) => {
    const parsedEndpoint = new URL(endpoint);

    return Number(parsedEndpoint.port || '5671');
  });
  const consoleUrl = broker.instances.apply((instances) => {
    const resolvedConsoleUrl = instances[0]?.consoleUrl;

    if (!resolvedConsoleUrl) {
      throw new Error('AmazonMQ broker console URL is not available.');
    }

    return resolvedConsoleUrl;
  });

  return {
    mqBrokerArn: broker.arn,
    mqBrokerConsoleUrl: consoleUrl,
    mqBrokerDeploymentMode: broker.deploymentMode,
    mqBrokerEndpoint: brokerEndpoint,
    mqBrokerEngineVersion: broker.engineVersion,
    mqBrokerHost: brokerHost,
    mqBrokerId: broker.id,
    mqBrokerName: broker.brokerName,
    mqBrokerPort: brokerPort,
  };
}
