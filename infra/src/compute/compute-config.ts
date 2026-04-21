import { config, projectPrefix, stack, stackName } from '../bootstrap';

const defaultClusterCapacity = 1;
const defaultClusterName = `${projectPrefix}-${stack}`;
const defaultEcsInstanceType = 't3.micro';
const defaultEcsOptimizedAmiSsmParameterName =
  '/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id';

export interface FoundationComputeConfig {
  autoScalingGroupName: string;
  capacityProviderName: string;
  clusterName: string;
  desiredCapacity: number;
  ecsOptimizedAmiSsmParameterName: string;
  instanceProfileName: string;
  instanceRoleName: string;
  instanceType: string;
  keyPairName?: string;
  launchTemplateName: string;
  maxSize: number;
  minSize: number;
}

export function getFoundationComputeConfig(): FoundationComputeConfig {
  const clusterName = config.get('ecsClusterName') ?? defaultClusterName;
  const desiredCapacity = config.getNumber('ecsDesiredCapacity') ?? defaultClusterCapacity;
  const instanceType = config.get('ecsInstanceType') ?? defaultEcsInstanceType;
  const keyPairName = config.get('ecsKeyPairName') ?? undefined;
  const maxSize = config.getNumber('ecsMaxSize') ?? defaultClusterCapacity;
  const minSize = config.getNumber('ecsMinSize') ?? defaultClusterCapacity;
  const ecsOptimizedAmiSsmParameterName =
    config.get('ecsOptimizedAmiSsmParameterName') ?? defaultEcsOptimizedAmiSsmParameterName;

  validateClusterName(clusterName);
  validateCapacity({ desiredCapacity, maxSize, minSize });
  validateInstanceType(instanceType);
  validateOptionalName('ecsKeyPairName', keyPairName);
  validateSsmParameterName(ecsOptimizedAmiSsmParameterName);

  return {
    autoScalingGroupName: stackName('ecs-asg'),
    capacityProviderName: stackName('ecs-capacity-provider'),
    clusterName,
    desiredCapacity,
    ecsOptimizedAmiSsmParameterName,
    instanceProfileName: stackName('ecs-instance-profile'),
    instanceRoleName: stackName('ecs-instance-role'),
    instanceType,
    keyPairName,
    launchTemplateName: stackName('ecs-launch-template'),
    maxSize,
    minSize,
  };
}

function validateCapacity({
  desiredCapacity,
  maxSize,
  minSize,
}: {
  desiredCapacity: number;
  maxSize: number;
  minSize: number;
}) {
  if (minSize < 1) {
    throw new Error('ecsMinSize must be at least 1.');
  }

  if (desiredCapacity < minSize) {
    throw new Error('ecsDesiredCapacity must be greater than or equal to ecsMinSize.');
  }

  if (desiredCapacity > maxSize) {
    throw new Error('ecsDesiredCapacity must be less than or equal to ecsMaxSize.');
  }
}

function validateClusterName(clusterName: string) {
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(clusterName)) {
    throw new Error('ecsClusterName must contain only letters, numbers, hyphens, and underscores.');
  }
}

function validateInstanceType(instanceType: string) {
  if (!/^[a-z0-9]+\.[a-z0-9]+$/.test(instanceType)) {
    throw new Error('ecsInstanceType must look like a valid EC2 instance type, e.g. t3.micro.');
  }
}

function validateOptionalName(label: string, value: string | undefined) {
  if (value?.trim().length === 0) {
    throw new Error(`${label} cannot be empty when provided.`);
  }
}

function validateSsmParameterName(parameterName: string) {
  if (!parameterName.startsWith('/')) {
    throw new Error('ecsOptimizedAmiSsmParameterName must be an absolute SSM parameter path.');
  }
}
