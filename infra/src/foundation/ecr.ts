import * as aws from '@pulumi/aws';

import {
  commonTags,
  isSharedInfraOwner,
  projectPrefix,
  repositoryArn,
  repositoryUrl,
  stackName,
} from '../bootstrap';

// Phase 0.4 foundation:
// create shared image registries once per AWS account, then let later phases push/deploy from them.
const lifecyclePolicy = JSON.stringify({
  rules: [
    {
      action: {
        type: 'expire',
      },
      description: 'Keep last 20 tagged images',
      rulePriority: 1,
      selection: {
        countNumber: 20,
        countType: 'imageCountMoreThan',
        tagPrefixList: ['sha-', 'development', 'latest'],
        tagStatus: 'tagged',
      },
    },
    {
      action: {
        type: 'expire',
      },
      description: 'Expire untagged images after 7 days',
      rulePriority: 2,
      selection: {
        countNumber: 7,
        countType: 'sinceImagePushed',
        countUnit: 'days',
        tagStatus: 'untagged',
      },
    },
  ],
});

// Repository names stay stack-independent because ECR is account-level shared infra.
export const repositoryNames = {
  payments: `${projectPrefix}/payments`,
  shop: `${projectPrefix}/shop`,
} as const;

// Creates one repository plus its lifecycle policy so both resources stay coupled.
function createRepository(logicalName: string, repositoryName: string) {
  const repository = new aws.ecr.Repository(stackName(logicalName), {
    imageScanningConfiguration: {
      scanOnPush: true,
    },
    imageTagMutability: 'MUTABLE',
    name: repositoryName,
    tags: {
      ...commonTags,
      Component: logicalName,
      Scope: 'shared',
    },
  });

  const lifecycle = new aws.ecr.LifecyclePolicy(`${stackName(logicalName)}-lifecycle`, {
    policy: lifecyclePolicy,
    repository: repository.name,
  });

  return { lifecycle, repository };
}

// Only owner stack creates shared repos. Other stacks still export names/arns/urls for reuse.
const paymentsRepository = isSharedInfraOwner
  ? createRepository('payments-ecr', repositoryNames.payments)
  : undefined;

const shopRepository = isSharedInfraOwner
  ? createRepository('shop-ecr', repositoryNames.shop)
  : undefined;

// Helpful for previews: shows whether this stack actually owns physical ECR resources.
export const createdSharedRepositories = {
  payments: paymentsRepository?.repository.name ?? null,
  shop: shopRepository?.repository.name ?? null,
};

// Export stable repository metadata so CI/CD and later phases do not need to recompute it.
export const paymentsRepositoryArn = repositoryArn(repositoryNames.payments);
export const paymentsRepositoryName = repositoryNames.payments;
export const paymentsRepositoryUrl = repositoryUrl(repositoryNames.payments);
export const shopRepositoryArn = repositoryArn(repositoryNames.shop);
export const shopRepositoryName = repositoryNames.shop;
export const shopRepositoryUrl = repositoryUrl(repositoryNames.shop);
