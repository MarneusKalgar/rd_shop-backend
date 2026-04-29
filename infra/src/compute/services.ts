import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { accountId, commonTags, projectPrefix, stack, stackName } from '../bootstrap';
import {
  buildPaymentsContainerDefinitions,
  buildShopContainerDefinitions,
  paymentsServiceDefaults,
  RuntimeParameterNames,
  shopServiceDefaults,
} from './service-definitions';
import { getComputeServicesConfig } from './services-config';

interface CreateComputeServicesArgs {
  capacityProviderName: pulumi.Input<string>;
  clusterArn: pulumi.Input<string>;
  ecr: {
    paymentsRepositoryUrl: pulumi.Input<string>;
    shopRepositoryUrl: pulumi.Input<string>;
  };
  edge?: {
    shopLoadBalancerDependency: pulumi.Resource;
    shopTargetGroupArn: pulumi.Input<string>;
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
    paymentsRuntimeSecretVersionId: pulumi.Input<string>;
    shopRuntimeParameterNames: RuntimeParameterNames;
    shopRuntimeSecretArn: pulumi.Input<string>;
    shopRuntimeSecretVersionId: pulumi.Input<string>;
  };
  ses: {
    shopSesIdentityArn: pulumi.Input<string>;
  };
}

const ecsManagedExecutionPolicyArn =
  'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy';
const paymentsDiscoveryServiceName = 'payments';
const serviceDiscoveryRecordTtlSeconds = 10;

/**
 * Step 2.3-2.4 / compute services.
 * Accepts the ECS cluster/capacity metadata plus ECR, edge, runtime config, SES, and bucket dependencies.
 * Creates task roles, log groups, Cloud Map namespace, ECS task definitions, and both ECS services, then returns the exported service metadata.
 */
export function createComputeServices({
  capacityProviderName,
  clusterArn,
  ecr,
  edge,
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
            type: 'SRV',
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
    service: 'shop',
    tag: servicesConfig.shopImageTag,
  });
  const paymentsImageUri = resolveImageUri({
    explicitImageUri: servicesConfig.paymentsImageUri,
    repositoryUrl: ecr.paymentsRepositoryUrl,
    service: 'payments',
    tag: servicesConfig.paymentsImageTag,
  });

  const shopTaskDefinition = new aws.ecs.TaskDefinition(stackName('shop-task-definition'), {
    containerDefinitions: buildShopContainerDefinitions({
      imageUri: shopImageUri,
      logGroupName: shopLogGroup.name,
      runtimeParameterNames: runtimeConfig.shopRuntimeParameterNames,
      runtimeSecretArn: runtimeConfig.shopRuntimeSecretArn,
      runtimeSecretVersionId: runtimeConfig.shopRuntimeSecretVersionId,
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
      runtimeSecretVersionId: runtimeConfig.paymentsRuntimeSecretVersionId,
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

  const shopServiceArgs: aws.ecs.ServiceArgs = {
    capacityProviderStrategies: [
      {
        base: 1,
        capacityProvider: capacityProviderName,
        weight: 100,
      },
    ],
    cluster: clusterArn,
    deploymentMaximumPercent: servicesConfig.shopDeploymentMaximumPercent,
    deploymentMinimumHealthyPercent: servicesConfig.shopDeploymentMinimumHealthyPercent,
    desiredCount: servicesConfig.shopDesiredCount,
    enableEcsManagedTags: true,
    forceDelete: stack !== 'production',
    name: stackName('shop-service'),
    taskDefinition: shopTaskDefinition.arn,
    waitForSteadyState: false,
  };

  if (edge?.shopTargetGroupArn) {
    shopServiceArgs.healthCheckGracePeriodSeconds =
      servicesConfig.shopHealthCheckGracePeriodSeconds;
    shopServiceArgs.loadBalancers = [
      {
        containerName: shopServiceDefaults.containerName,
        containerPort: shopServiceDefaults.containerPort,
        targetGroupArn: edge.shopTargetGroupArn,
      },
    ];
  }

  const shopServiceDependencies = edge?.shopLoadBalancerDependency
    ? [...serviceDependencies, shopTaskDefinition, edge.shopLoadBalancerDependency]
    : [...serviceDependencies, shopTaskDefinition];

  // Image push, RabbitMQ cutover, and public ingress may come after the first apply, so keep
  // ECS service creation non-blocking while the phase 2 stack is still coming together.
  const shopService = new aws.ecs.Service(stackName('shop-service'), shopServiceArgs, {
    dependsOn: shopServiceDependencies,
  });

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
      deploymentMaximumPercent: servicesConfig.paymentsDeploymentMaximumPercent,
      deploymentMinimumHealthyPercent: servicesConfig.paymentsDeploymentMinimumHealthyPercent,
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
    paymentsDesiredCount: servicesConfig.paymentsDesiredCount,
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
    shopDesiredCount: servicesConfig.shopDesiredCount,
    shopImageUri,
    shopLogGroupName: shopLogGroup.name,
    shopServiceArn: shopService.arn,
    shopServiceName: shopService.name,
    shopTaskDefinitionArn: shopTaskDefinition.arn,
    shopTaskRoleArn: shopTaskRole.arn,
    shopTaskRoleName: shopTaskRole.name,
  };
}

/**
 * Step 2.3-2.4 IAM helper.
 * Accepts no arguments.
 * Returns the SSM parameter ARN prefix that ECS task execution roles need in order to read runtime parameters for the current stack.
 */
function buildRuntimeParameterPathArn() {
  return pulumi.interpolate`arn:aws:ssm:${aws.config.region ?? 'eu-central-1'}:${accountId}:parameter/${projectPrefix}/${stack}/*`;
}

/**
 * Step 2.3 log helper.
 * Accepts the logical Pulumi name, concrete log group name, and owning service tag.
 * Creates one CloudWatch log group for an ECS service and returns the resource.
 */
function createLogGroup(logicalName: string, logGroupName: string, service: 'payments' | 'shop') {
  return new aws.cloudwatch.LogGroup(stackName(logicalName), {
    name: logGroupName,
    retentionInDays: stack === 'production' ? 90 : 30,
    tags: {
      ...commonTags,
      Component: 'compute',
      Name: logGroupName,
      Scope: 'private',
      Service: service,
    },
  });
}

/**
 * Step 2.3 IAM helper.
 * Accepts the role description, logical name, and owning service tag.
 * Creates one ECS task IAM role and returns the role resource.
 */
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

/**
 * Step 2.3 image helper.
 * Accepts the explicit image URI, repository URL, service label, and optional image tag.
 * Returns the final container image URI used by ECS, enforcing explicit image-source policy.
 */
function resolveImageUri({
  explicitImageUri,
  repositoryUrl,
  service,
  tag,
}: {
  explicitImageUri?: string;
  repositoryUrl: pulumi.Input<string>;
  service: 'payments' | 'shop';
  tag?: string;
}) {
  if (explicitImageUri) {
    return explicitImageUri;
  }

  if (tag) {
    return pulumi.interpolate`${repositoryUrl}:${tag}`;
  }

  throw new Error(
    `${service}ImageTag or ${service}ImageUri must be set explicitly. Implicit latest image fallback is not allowed.`,
  );
}
