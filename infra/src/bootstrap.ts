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
export const resourcePrefix = `${projectPrefix}-${stack}`;

export const commonTags = {
  ManagedBy: 'Pulumi',
  Project: projectPrefix,
  Repository: 'rd_shop-backend',
  Stack: stack,
};

export function repositoryArn(repositoryName: string) {
  return pulumi.interpolate`arn:aws:ecr:${region}:${caller.accountId}:repository/${repositoryName}`;
}

export function repositoryUrl(repositoryName: string) {
  return pulumi.interpolate`${caller.accountId}.dkr.ecr.${region}.amazonaws.com/${repositoryName}`;
}

export function stackName(name: string): string {
  return `${resourcePrefix}-${name}`;
}
