import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { accountId, commonTags, projectPrefix, region, stack, stackName } from '../bootstrap';
import { getMessageBrokerConfig } from './mq-config';
import { buildMessageBrokerUserData } from './mq-user-data';

const amazonLinuxAmiSsmParameterName =
  '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64';
const brokerBootstrapSecretName = `${projectPrefix}/rabbitmq/${stack}/bootstrap`;
const brokerManagementPort = 15672;
const ssmManagedInstanceCorePolicyArn = 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore';

interface CreateMessageBrokerArgs {
  privateSubnetIds: pulumi.Input<pulumi.Input<string>[]>;
  securityGroupId: pulumi.Input<string>;
}

/**
 * Step 3 / messaging.
 * Accepts the private subnet ids and the RabbitMQ security-group id.
 * Creates the dedicated RabbitMQ EC2 broker, bootstrap secret, instance role/profile, data volume, and returns the broker connection metadata consumed by runtime config.
 */
export function createMessageBroker({
  privateSubnetIds,
  securityGroupId,
}: CreateMessageBrokerArgs) {
  const messageBrokerConfig = getMessageBrokerConfig();
  const selectedSubnetId = pulumi.output(privateSubnetIds).apply((subnetIds) => {
    if (subnetIds.length === 0) {
      throw new Error('Dedicated RabbitMQ broker requires at least one private subnet.');
    }

    return subnetIds[0];
  });
  const brokerAmiId =
    messageBrokerConfig.amiId ??
    aws.ssm.getParameterOutput({
      name: amazonLinuxAmiSsmParameterName,
    }).value;
  const brokerSubnet = aws.ec2.getSubnetOutput({ id: selectedSubnetId });

  const brokerBootstrapSecret = new aws.secretsmanager.Secret(
    stackName('shop-rabbitmq-bootstrap'),
    {
      description: 'Bootstrap secret for the dedicated RabbitMQ broker.',
      name: brokerBootstrapSecretName,
      recoveryWindowInDays: stack === 'production' ? 30 : 0,
      tags: {
        ...commonTags,
        Component: 'queue',
        Name: brokerBootstrapSecretName,
        Scope: 'private',
        Service: 'shop',
      },
    },
  );

  new aws.secretsmanager.SecretVersion(stackName('shop-rabbitmq-bootstrap-version'), {
    secretId: brokerBootstrapSecret.id,
    secretString: pulumi.secret(
      pulumi
        .all([messageBrokerConfig.credentials.username, messageBrokerConfig.credentials.password])
        .apply(([username, password]) =>
          JSON.stringify({
            RABBITMQ_DEFAULT_PASS: password,
            RABBITMQ_DEFAULT_USER: username,
            RABBITMQ_DEFAULT_VHOST: messageBrokerConfig.vhost,
          }),
        ),
    ),
  });

  const brokerInstanceRole = new aws.iam.Role(stackName('shop-rabbitmq-instance-role'), {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: 'ec2.amazonaws.com',
    }),
    name: stackName('shop-rabbitmq-instance-role'),
    tags: {
      ...commonTags,
      Component: 'queue',
      Name: stackName('shop-rabbitmq-instance-role'),
      Scope: 'private',
      Service: 'shop',
    },
  });

  new aws.iam.RolePolicyAttachment(stackName('shop-rabbitmq-instance-ssm-managed-policy'), {
    policyArn: ssmManagedInstanceCorePolicyArn,
    role: brokerInstanceRole.name,
  });

  new aws.iam.RolePolicy(stackName('shop-rabbitmq-instance-runtime-policy'), {
    name: stackName('shop-rabbitmq-instance-runtime-policy'),
    policy: pulumi.jsonStringify({
      Statement: [
        {
          Action: ['secretsmanager:GetSecretValue'],
          Effect: 'Allow',
          Resource: [brokerBootstrapSecret.arn],
        },
      ],
      Version: '2012-10-17',
    }),
    role: brokerInstanceRole.name,
  });

  const brokerInstanceProfile = new aws.iam.InstanceProfile(
    stackName('shop-rabbitmq-instance-profile'),
    {
      name: stackName('shop-rabbitmq-instance-profile'),
      role: brokerInstanceRole.name,
      tags: {
        ...commonTags,
        Component: 'queue',
        Name: stackName('shop-rabbitmq-instance-profile'),
        Scope: 'private',
        Service: 'shop',
      },
    },
  );

  const brokerDataVolume = new aws.ebs.Volume(stackName('shop-rabbitmq-data-volume'), {
    availabilityZone: brokerSubnet.availabilityZone,
    size: messageBrokerConfig.dataVolumeSizeGiB,
    tags: {
      ...commonTags,
      Component: 'queue',
      Name: stackName('shop-rabbitmq-data-volume'),
      Scope: 'private',
      Service: 'shop',
    },
    type: 'gp3',
  });

  const broker = new aws.ec2.Instance(
    stackName('shop-rabbitmq-broker'),
    {
      ami: brokerAmiId,
      associatePublicIpAddress: false,
      iamInstanceProfile: brokerInstanceProfile.name,
      instanceType: messageBrokerConfig.instanceType,
      metadataOptions: {
        httpEndpoint: 'enabled',
        httpTokens: 'required',
      },
      subnetId: selectedSubnetId,
      tags: {
        ...commonTags,
        Component: 'queue',
        Name: messageBrokerConfig.brokerName,
        Scope: 'private',
        Service: 'shop',
      },
      userData: pulumi
        .all([brokerBootstrapSecret.arn, brokerDataVolume.id])
        .apply(([brokerSecretArn, dataVolumeId]) =>
          buildMessageBrokerUserData({
            brokerSecretArn,
            dataVolumeDeviceName: messageBrokerConfig.dataVolumeDeviceName,
            dataVolumeId,
            dataVolumeMountPath: messageBrokerConfig.dataVolumeMountPath,
            image: messageBrokerConfig.image,
            port: messageBrokerConfig.port,
            region,
          }),
        ),
      userDataReplaceOnChange: true,
      vpcSecurityGroupIds: [securityGroupId],
    },
    {
      deleteBeforeReplace: true,
    },
  );

  new aws.ec2.VolumeAttachment(
    stackName('shop-rabbitmq-data-volume-attachment'),
    {
      deviceName: messageBrokerConfig.dataVolumeDeviceName,
      instanceId: broker.id,
      stopInstanceBeforeDetaching: true,
      volumeId: brokerDataVolume.id,
    },
    {
      deleteBeforeReplace: true,
    },
  );

  const brokerArn = pulumi.interpolate`arn:aws:ec2:${region}:${accountId}:instance/${broker.id}`;
  const brokerEndpoint = pulumi.interpolate`amqp://${broker.privateIp}:${messageBrokerConfig.port}`;
  const consoleUrl = pulumi.interpolate`http://${broker.privateIp}:${brokerManagementPort}`;

  return {
    mqBrokerArn: brokerArn,
    mqBrokerConsoleUrl: consoleUrl,
    mqBrokerDeploymentMode: 'SINGLE_INSTANCE',
    mqBrokerEndpoint: brokerEndpoint,
    mqBrokerEngineVersion: messageBrokerConfig.engineVersion,
    mqBrokerHost: broker.privateIp,
    mqBrokerId: broker.id,
    mqBrokerName: messageBrokerConfig.brokerName,
    mqBrokerPort: messageBrokerConfig.port,
  };
}
