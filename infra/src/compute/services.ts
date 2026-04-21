import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { accountId, commonTags, projectPrefix, stack, stackName } from '../bootstrap';
import {
  buildPaymentsContainerDefinitions,
  buildShopContainerDefinitions,
  paymentsServiceDefaults,
  RuntimeParameterNames,
} from './service-definitions';
import { getComputeServicesConfig } from './services-config';

interface CreateComputeServicesArgs {
  capacityProviderName: pulumi.Input<string>;
  clusterArn: pulumi.Input<string>;
  ecr: {
    paymentsRepositoryUrl: pulumi.Input<string>;
    shopRepositoryUrl: pulumi.Input<string>;
  };
  fileStorage: {
    filesBucketArn: pulumi.Input<string>;
  };
  network: {
    vpcId: pulumi.Input<string>;
  };
  runtimeConfig: {
    paymentsRuntimeParameterNames: RuntimeParameterNames;
    paymentsRuntimeSecretArn: pulumi.Input<string>;
    shopRuntimeParameterNames: RuntimeParameterNames;
    shopRuntimeSecretArn: pulumi.Input<string>;
  };
  ses: {
    shopSesIdentityArn: pulumi.Input<string>;
  };
}

const ecsManagedExecutionPolicyArn =
  'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy';
const paymentsDiscoveryServiceName = 'payments';
const serviceDiscoveryRecordTtlSeconds = 10;

export function createComputeServices({
  capacityProviderName,
  clusterArn,
  ecr,
  fileStorage,
  network,
  runtimeConfig,
  ses,
}: CreateComputeServicesArgs) {
  const servicesConfig = getComputeServicesConfig();

  const taskExecutionRole = createRole({
    description: 'Shared ECS task execution role for runtime secret and image pull access.',
    logicalName: 'ecs-task-execution-role',
    service: 'shared',
  });

  const taskExecutionManagedPolicy = new aws.iam.RolePolicyAttachment(
    stackName('ecs-task-execution-managed-policy'),
    {
      policyArn: ecsManagedExecutionPolicyArn,
      role: taskExecutionRole.name,
    },
  );

  const taskExecutionRuntimePolicy = new aws.iam.RolePolicy(
    stackName('ecs-task-execution-runtime-policy'),
    {
      name: stackName('ecs-task-execution-runtime-policy'),
      policy: pulumi.jsonStringify({
        Statement: [
          {
            Action: ['secretsmanager:GetSecretValue'],
            Effect: 'Allow',
            Resource: [runtimeConfig.shopRuntimeSecretArn, runtimeConfig.paymentsRuntimeSecretArn],
          },
          {
            Action: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
            Effect: 'Allow',
            Resource: [buildRuntimeParameterPathArn()],
          },
        ],
        Version: '2012-10-17',
      }),
      role: taskExecutionRole.name,
    },
  );

  const shopTaskRole = createRole({
    description: 'Application role for shop ECS tasks.',
    logicalName: 'shop-task-role',
    service: 'shop',
  });

  const shopTaskPolicy = new aws.iam.RolePolicy(stackName('shop-task-policy'), {
    name: stackName('shop-task-policy'),
    policy: pulumi.jsonStringify({
      Statement: [
        {
          Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload'],
          Effect: 'Allow',
          Resource: [pulumi.interpolate`${fileStorage.filesBucketArn}/*`],
        },
        {
          Action: ['s3:ListBucket'],
          Effect: 'Allow',
          Resource: [fileStorage.filesBucketArn],
        },
        {
          Action: ['ses:SendEmail', 'ses:SendRawEmail'],
          Effect: 'Allow',
          Resource: [ses.shopSesIdentityArn],
        },
      ],
      Version: '2012-10-17',
    }),
    role: shopTaskRole.name,
  });

  const paymentsTaskRole = createRole({
    description: 'Application role for payments ECS tasks.',
    logicalName: 'payments-task-role',
    service: 'payments',
  });

  const paymentsTaskPolicy = new aws.iam.RolePolicy(stackName('payments-task-policy'), {
    name: stackName('payments-task-policy'),
    policy: pulumi.jsonStringify({
      Statement: [
        {
          Action: ['secretsmanager:GetSecretValue'],
          Effect: 'Allow',
          Resource: [runtimeConfig.paymentsRuntimeSecretArn],
        },
      ],
      Version: '2012-10-17',
    }),
    role: paymentsTaskRole.name,
  });

  const shopLogGroupName = `/ecs/${projectPrefix}/${stack}/shop`;
  const paymentsLogGroupName = `/ecs/${projectPrefix}/${stack}/payments`;

  const shopLogGroup = createLogGroup('shop-log-group', shopLogGroupName, 'shop');
  const paymentsLogGroup = createLogGroup('payments-log-group', paymentsLogGroupName, 'payments');

  const serviceDiscoveryNamespace = new aws.servicediscovery.PrivateDnsNamespace(
    stackName('cloud-map-namespace'),
    {
      description: 'Private DNS namespace for ECS service discovery.',
      name: servicesConfig.cloudMapNamespaceName,
      tags: {
        ...commonTags,
        Component: 'compute',
        Name: servicesConfig.cloudMapNamespaceName,
        Scope: 'private',
      },
      vpc: network.vpcId,
    },
  );

  const paymentsDiscoveryService = new aws.servicediscovery.Service(
    stackName('payments-discovery-service'),
    {
      description: 'Cloud Map service for internal payments gRPC discovery.',
      dnsConfig: {
        dnsRecords: [
          {
            ttl: serviceDiscoveryRecordTtlSeconds,
            type: 'A',
          },
        ],
        namespaceId: serviceDiscoveryNamespace.id,
        routingPolicy: 'MULTIVALUE',
      },
      forceDestroy: stack !== 'production',
      // AWS fixes custom health-check threshold to 1 now, so keep the block empty.
      healthCheckCustomConfig: {},
      name: paymentsDiscoveryServiceName,
      tags: {
        ...commonTags,
        Component: 'compute',
        Name: paymentsDiscoveryServiceName,
        Scope: 'private',
        Service: 'payments',
      },
    },
  );

  const shopImageUri = resolveImageUri({
    explicitImageUri: servicesConfig.shopImageUri,
    repositoryUrl: ecr.shopRepositoryUrl,
    tag: servicesConfig.shopImageTag,
  });
  const paymentsImageUri = resolveImageUri({
    explicitImageUri: servicesConfig.paymentsImageUri,
    repositoryUrl: ecr.paymentsRepositoryUrl,
    tag: servicesConfig.paymentsImageTag,
  });

  const shopTaskDefinition = new aws.ecs.TaskDefinition(stackName('shop-task-definition'), {
    containerDefinitions: buildShopContainerDefinitions({
      imageUri: shopImageUri,
      logGroupName: shopLogGroup.name,
      runtimeParameterNames: runtimeConfig.shopRuntimeParameterNames,
      runtimeSecretArn: runtimeConfig.shopRuntimeSecretArn,
    }),
    executionRoleArn: taskExecutionRole.arn,
    family: stackName('shop-task'),
    networkMode: 'bridge',
    requiresCompatibilities: ['EC2'],
    tags: {
      ...commonTags,
      Component: 'compute',
      Name: stackName('shop-task'),
      Scope: 'private',
      Service: 'shop',
    },
    taskRoleArn: shopTaskRole.arn,
  });

  const paymentsTaskDefinition = new aws.ecs.TaskDefinition(stackName('payments-task-definition'), {
    containerDefinitions: buildPaymentsContainerDefinitions({
      imageUri: paymentsImageUri,
      logGroupName: paymentsLogGroup.name,
      runtimeParameterNames: runtimeConfig.paymentsRuntimeParameterNames,
      runtimeSecretArn: runtimeConfig.paymentsRuntimeSecretArn,
    }),
    executionRoleArn: taskExecutionRole.arn,
    family: stackName('payments-task'),
    networkMode: 'bridge',
    requiresCompatibilities: ['EC2'],
    tags: {
      ...commonTags,
      Component: 'compute',
      Name: stackName('payments-task'),
      Scope: 'private',
      Service: 'payments',
    },
    taskRoleArn: paymentsTaskRole.arn,
  });

  const serviceDependencies = [
    taskExecutionManagedPolicy,
    taskExecutionRuntimePolicy,
    shopTaskPolicy,
    paymentsTaskPolicy,
  ];

  // Image push, RabbitMQ cutover, and ALB come in later phases, so service creation should not
  // block the whole stack on ECS steady-state during early applies.
  const shopService = new aws.ecs.Service(
    stackName('shop-service'),
    {
      capacityProviderStrategies: [
        {
          base: 1,
          capacityProvider: capacityProviderName,
          weight: 100,
        },
      ],
      cluster: clusterArn,
      deploymentMaximumPercent: 100,
      deploymentMinimumHealthyPercent: 0,
      desiredCount: servicesConfig.shopDesiredCount,
      enableEcsManagedTags: true,
      forceDelete: stack !== 'production',
      name: stackName('shop-service'),
      taskDefinition: shopTaskDefinition.arn,
      waitForSteadyState: false,
    },
    {
      dependsOn: [...serviceDependencies, shopTaskDefinition],
    },
  );

  const paymentsService = new aws.ecs.Service(
    stackName('payments-service'),
    {
      capacityProviderStrategies: [
        {
          base: 1,
          capacityProvider: capacityProviderName,
          weight: 100,
        },
      ],
      cluster: clusterArn,
      deploymentMaximumPercent: 100,
      deploymentMinimumHealthyPercent: 0,
      desiredCount: servicesConfig.paymentsDesiredCount,
      enableEcsManagedTags: true,
      forceDelete: stack !== 'production',
      name: stackName('payments-service'),
      serviceRegistries: {
        containerName: paymentsServiceDefaults.containerName,
        containerPort: paymentsServiceDefaults.containerPort,
        registryArn: paymentsDiscoveryService.arn,
      },
      taskDefinition: paymentsTaskDefinition.arn,
      waitForSteadyState: false,
    },
    {
      dependsOn: [
        ...serviceDependencies,
        paymentsTaskDefinition,
        serviceDiscoveryNamespace,
        paymentsDiscoveryService,
      ],
    },
  );

  return {
    ecsTaskExecutionRoleArn: taskExecutionRole.arn,
    ecsTaskExecutionRoleName: taskExecutionRole.name,
    paymentsDiscoveryServiceArn: paymentsDiscoveryService.arn,
    paymentsDiscoveryServiceId: paymentsDiscoveryService.id,
    paymentsDiscoveryServiceName: paymentsDiscoveryService.name,
    paymentsImageUri,
    paymentsLogGroupName: paymentsLogGroup.name,
    paymentsServiceArn: paymentsService.arn,
    paymentsServiceDiscoveryHost: pulumi.interpolate`${paymentsDiscoveryServiceName}.${serviceDiscoveryNamespace.name}`,
    paymentsServiceName: paymentsService.name,
    paymentsTaskDefinitionArn: paymentsTaskDefinition.arn,
    paymentsTaskRoleArn: paymentsTaskRole.arn,
    paymentsTaskRoleName: paymentsTaskRole.name,
    privateDnsNamespaceArn: serviceDiscoveryNamespace.arn,
    privateDnsNamespaceId: serviceDiscoveryNamespace.id,
    privateDnsNamespaceName: serviceDiscoveryNamespace.name,
    shopImageUri,
    shopLogGroupName: shopLogGroup.name,
    shopServiceArn: shopService.arn,
    shopServiceName: shopService.name,
    shopTaskDefinitionArn: shopTaskDefinition.arn,
    shopTaskRoleArn: shopTaskRole.arn,
    shopTaskRoleName: shopTaskRole.name,
  };
}

function buildRuntimeParameterPathArn() {
  return pulumi.interpolate`arn:aws:ssm:${aws.config.region ?? 'eu-central-1'}:${accountId}:parameter/${projectPrefix}/${stack}/*`;
}

function createLogGroup(logicalName: string, logGroupName: string, service: 'payments' | 'shop') {
  return new aws.cloudwatch.LogGroup(stackName(logicalName), {
    name: logGroupName,
    tags: {
      ...commonTags,
      Component: 'compute',
      Name: logGroupName,
      Scope: 'private',
      Service: service,
    },
  });
}

function createRole({
  description,
  logicalName,
  service,
}: {
  description: string;
  logicalName: string;
  service: 'payments' | 'shared' | 'shop';
}) {
  return new aws.iam.Role(stackName(logicalName), {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: 'ecs-tasks.amazonaws.com',
    }),
    description,
    name: stackName(logicalName),
    tags: {
      ...commonTags,
      Component: 'compute',
      Name: stackName(logicalName),
      Scope: 'private',
      Service: service,
    },
  });
}

function resolveImageUri({
  explicitImageUri,
  repositoryUrl,
  tag,
}: {
  explicitImageUri?: string;
  repositoryUrl: pulumi.Input<string>;
  tag: string;
}) {
  return explicitImageUri ?? pulumi.interpolate`${repositoryUrl}:${tag}`;
}
