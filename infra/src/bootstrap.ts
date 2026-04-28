import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

export const config = new pulumi.Config();
export const stack = pulumi.getStack();

export const projectPrefix = config.get('projectPrefix') ?? 'rd-shop';
export const sharedInfraOwnerStack = config.get('sharedInfraOwnerStack') ?? 'stage';
export const region = aws.config.region ?? 'eu-central-1';
export const caller = aws.getCallerIdentityOutput({});

export const accountId = caller.accountId;
export const isSharedInfraOwner = stack === sharedInfraOwnerStack;
export const resourceStackName = stack === 'production' ? 'prod' : stack;
export const resourcePrefix = `${projectPrefix}-${resourceStackName}`;

export const commonTags = {
  ManagedBy: 'Pulumi',
  Project: projectPrefix,
  Repository: 'rd_shop-backend',
  Stack: stack,
};

/**
 * Shared bootstrap helper used by every step.
 * Accepts a repository name without registry host information.
 * Returns the full ECR repository ARN for IAM policies and exports.
 */
export function repositoryArn(repositoryName: string) {
  return pulumi.interpolate`arn:aws:ecr:${region}:${caller.accountId}:repository/${repositoryName}`;
}

/**
 * Shared bootstrap helper used by every step.
 * Accepts a repository name without registry host information.
 * Returns the fully qualified ECR registry URL consumed by ECS image references and CI.
 */
export function repositoryUrl(repositoryName: string) {
  return pulumi.interpolate`${caller.accountId}.dkr.ecr.${region}.amazonaws.com/${repositoryName}`;
}

/**
 * Shared naming helper used by all steps.
 * Accepts a logical resource suffix.
 * Returns the stack-scoped physical name prefix applied to Pulumi-managed AWS resources.
 */
export function stackName(name: string): string {
  return `${resourcePrefix}-${name}`;
}
