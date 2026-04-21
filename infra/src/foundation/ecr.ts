/* eslint-disable perfectionist/sort-modules */

import * as aws from '@pulumi/aws';

import {
  commonTags,
  isSharedInfraOwner,
  projectPrefix,
  repositoryArn,
  repositoryUrl,
  stackName,
} from '../bootstrap';

const retainedTaggedImageCount = 20;
const untaggedImageExpirationDays = 7;
const retainedTagPrefixes = ['sha-', 'development', 'latest'] as const;

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
        countNumber: retainedTaggedImageCount,
        countType: 'imageCountMoreThan',
        tagPrefixList: retainedTagPrefixes,
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
        countNumber: untaggedImageExpirationDays,
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

// Creates one repository plus lifecycle policy so both resources stay coupled.
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

  new aws.ecr.LifecyclePolicy(`${stackName(logicalName)}-lifecycle`, {
    policy: lifecyclePolicy,
    repository: repository.name,
  });

  return repository;
}

// Phase 0.4 orchestrator.
// Shared ECR repos exist once per account, so only owner stack creates physical resources.
export function createFoundationEcr() {
  const paymentsRepository = isSharedInfraOwner
    ? createRepository('payments-ecr', repositoryNames.payments)
    : undefined;

  const shopRepository = isSharedInfraOwner
    ? createRepository('shop-ecr', repositoryNames.shop)
    : undefined;

  return {
    // Helpful for previews: shows whether this stack actually owns physical ECR resources.
    createdSharedRepositories: {
      payments: paymentsRepository?.name ?? null,
      shop: shopRepository?.name ?? null,
    },

    // Export stable repository metadata so CI/CD and later phases do not need to recompute it.
    paymentsRepositoryArn: repositoryArn(repositoryNames.payments),
    paymentsRepositoryName: repositoryNames.payments,
    paymentsRepositoryUrl: repositoryUrl(repositoryNames.payments),
    shopRepositoryArn: repositoryArn(repositoryNames.shop),
    shopRepositoryName: repositoryNames.shop,
    shopRepositoryUrl: repositoryUrl(repositoryNames.shop),
  };
}
