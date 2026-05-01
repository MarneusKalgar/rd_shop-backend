import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { commonTags, stack, stackName } from '../bootstrap';
import { getFoundationComputeConfig } from './compute-config';
import { buildComputeUserData } from './compute-user-data';

const ecsManagedInstancePolicyArn =
  'arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role';
const ssmManagedInstanceCorePolicyArn = 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore';

interface CreateFoundationComputeArgs {
  privateSubnetIds: pulumi.Input<pulumi.Input<string>[]>;
  securityGroupId: pulumi.Input<string>;
}

/**
 * Step 2.2 / compute foundation.
 * Accepts the ECS host subnet ids and the shared ECS security-group id.
 * Creates the ECS cluster, instance role/profile, launch template, Auto Scaling group, and ECS capacity provider, then returns the compute metadata later steps export.
 */
export function createFoundationCompute({
  privateSubnetIds,
  securityGroupId,
}: CreateFoundationComputeArgs) {
  const computeConfig = getFoundationComputeConfig();
  const singleHostCapacity =
    computeConfig.desiredCapacity === 1 &&
    computeConfig.maxSize === 1 &&
    computeConfig.minSize === 1;
  const ecsOptimizedAmiId =
    computeConfig.ecsOptimizedAmiId ??
    aws.ssm.getParameterOutput({
      name: computeConfig.ecsOptimizedAmiSsmParameterName,
    }).value;

  const cluster = new aws.ecs.Cluster(stackName('ecs-cluster'), {
    name: computeConfig.clusterName,
    settings: [
      {
        name: 'containerInsights',
        value: 'enabled',
      },
    ],
    tags: {
      ...commonTags,
      Component: 'compute',
      Name: computeConfig.clusterName,
      Scope: 'private',
    },
  });

  const instanceRole = new aws.iam.Role(stackName('ecs-instance-role'), {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: 'ec2.amazonaws.com',
    }),
    name: computeConfig.instanceRoleName,
    tags: {
      ...commonTags,
      Component: 'compute',
      Name: computeConfig.instanceRoleName,
      Scope: 'private',
    },
  });

  new aws.iam.RolePolicyAttachment(stackName('ecs-instance-role-ecs-managed-policy'), {
    policyArn: ecsManagedInstancePolicyArn,
    role: instanceRole.name,
  });

  new aws.iam.RolePolicyAttachment(stackName('ecs-instance-role-ssm-managed-policy'), {
    policyArn: ssmManagedInstanceCorePolicyArn,
    role: instanceRole.name,
  });

  const instanceProfile = new aws.iam.InstanceProfile(stackName('ecs-instance-profile'), {
    name: computeConfig.instanceProfileName,
    role: instanceRole.name,
    tags: {
      ...commonTags,
      Component: 'compute',
      Name: computeConfig.instanceProfileName,
      Scope: 'private',
    },
  });

  const launchTemplate = new aws.ec2.LaunchTemplate(stackName('ecs-launch-template'), {
    description: 'Launch template for ECS EC2 capacity.',
    iamInstanceProfile: {
      name: instanceProfile.name,
    },
    imageId: ecsOptimizedAmiId,
    instanceType: computeConfig.instanceType,
    keyName: computeConfig.keyPairName,
    metadataOptions: {
      httpEndpoint: 'enabled',
      httpTokens: 'required',
    },
    name: computeConfig.launchTemplateName,
    tags: {
      ...commonTags,
      Component: 'compute',
      Name: computeConfig.launchTemplateName,
      Scope: 'private',
    },
    updateDefaultVersion: true,
    userData: Buffer.from(buildComputeUserData(computeConfig.clusterName)).toString('base64'),
    vpcSecurityGroupIds: [securityGroupId],
  });

  const autoScalingGroup = new aws.autoscaling.Group(stackName('ecs-asg'), {
    desiredCapacity: computeConfig.desiredCapacity,
    forceDelete: stack !== 'production',
    healthCheckType: 'EC2',
    instanceRefresh: {
      preferences: {
        instanceWarmup: '120',
        minHealthyPercentage: singleHostCapacity ? 0 : 50,
      },
      strategy: 'Rolling',
    },
    launchTemplate: {
      id: launchTemplate.id,
      version: launchTemplate.latestVersion.apply((version) => version.toString()),
    },
    maxSize: computeConfig.maxSize,
    minSize: computeConfig.minSize,
    name: computeConfig.autoScalingGroupName,
    tags: buildAutoScalingGroupTags(computeConfig.clusterName),
    vpcZoneIdentifiers: privateSubnetIds,
  });

  const capacityProvider = new aws.ecs.CapacityProvider(stackName('ecs-capacity-provider'), {
    autoScalingGroupProvider: {
      autoScalingGroupArn: autoScalingGroup.arn,
      managedScaling: {
        maximumScalingStepSize: 1,
        minimumScalingStepSize: 1,
        status: 'ENABLED',
        targetCapacity: 100,
      },
      managedTerminationProtection: 'DISABLED',
    },
    name: computeConfig.capacityProviderName,
    tags: {
      ...commonTags,
      Component: 'compute',
      Name: computeConfig.capacityProviderName,
      Scope: 'private',
    },
  });

  new aws.ecs.ClusterCapacityProviders(stackName('ecs-cluster-capacity-providers'), {
    capacityProviders: [capacityProvider.name],
    clusterName: cluster.name,
    defaultCapacityProviderStrategies: [
      {
        base: 1,
        capacityProvider: capacityProvider.name,
        weight: 100,
      },
    ],
  });

  return {
    ecsAutoScalingGroupArn: autoScalingGroup.arn,
    ecsAutoScalingGroupName: autoScalingGroup.name,
    ecsCapacityProviderArn: capacityProvider.arn,
    ecsCapacityProviderName: capacityProvider.name,
    ecsClusterArn: cluster.arn,
    ecsClusterName: cluster.name,
    ecsInstanceProfileArn: instanceProfile.arn,
    ecsInstanceProfileName: instanceProfile.name,
    ecsInstanceRoleArn: instanceRole.arn,
    ecsInstanceRoleName: instanceRole.name,
    ecsLaunchTemplateId: launchTemplate.id,
    ecsLaunchTemplateLatestVersion: launchTemplate.latestVersion,
    ecsOptimizedAmiId,
  };
}

/**
 * Step 2.2 tagging helper.
 * Accepts the ECS cluster name.
 * Returns the propagated Auto Scaling group tags required for ECS-managed EC2 capacity.
 */
function buildAutoScalingGroupTags(clusterName: string) {
  return [
    ...Object.entries(commonTags).map(([key, value]) => ({
      key,
      propagateAtLaunch: true,
      value,
    })),
    {
      key: 'AmazonECSManaged',
      propagateAtLaunch: true,
      value: 'true',
    },
    {
      key: 'Component',
      propagateAtLaunch: true,
      value: 'compute',
    },
    {
      key: 'Name',
      propagateAtLaunch: true,
      value: clusterName,
    },
    {
      key: 'Scope',
      propagateAtLaunch: true,
      value: 'private',
    },
  ];
}
