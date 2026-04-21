import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

// What this baseline does:
// 1. Reads stack context and optional config with safe defaults.
// 2. Derives stack-aware names and common tags.
// 3. Creates shared ECR repositories from a single owner stack.
// 4. Exports repository metadata for later workflow/app wiring.

// Step 1: read runtime context and optional stack config.
const stack = pulumi.getStack();
const config = new pulumi.Config();

const projectPrefix = config.get('projectPrefix') ?? 'rd-shop';
const sharedInfraOwnerStack = config.get('sharedInfraOwnerStack') ?? 'stage';
const region = aws.config.region ?? 'eu-central-1';
const caller = aws.getCallerIdentityOutput({});

// Step 2: derive names/tags once and reuse everywhere.
const isSharedInfraOwner = stack === sharedInfraOwnerStack;
const resourcePrefix = `${projectPrefix}-${stack}`;

const commonTags = {
  ManagedBy: 'Pulumi',
  Project: projectPrefix,
  Repository: 'rd_shop-backend',
  Stack: stack,
};

const repositoryNames = {
  payments: `${projectPrefix}/payments`,
  shop: `${projectPrefix}/shop`,
} as const;

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

// Step 3: create shared account-level ECR repositories.
// ECR repositories are shared account-level resources, so only one stack
// should manage them to avoid duplicate-name conflicts across stage/production.
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

function stackName(name: string): string {
  return `${resourcePrefix}-${name}`;
}

const shopRepository = isSharedInfraOwner
  ? createRepository('shop-ecr', repositoryNames.shop)
  : undefined;

const paymentsRepository = isSharedInfraOwner
  ? createRepository('payments-ecr', repositoryNames.payments)
  : undefined;

function repositoryArn(repositoryName: string) {
  return pulumi.interpolate`arn:aws:ecr:${region}:${caller.accountId}:repository/${repositoryName}`;
}

function repositoryUrl(repositoryName: string) {
  return pulumi.interpolate`${caller.accountId}.dkr.ecr.${region}.amazonaws.com/${repositoryName}`;
}

// Step 4: export values needed by later phases and CI/CD wiring.
export const accountId = caller.accountId;
export const sharedInfraManagedByThisStack = isSharedInfraOwner;
export const sharedInfraOwner = sharedInfraOwnerStack;
export const currentStack = stack;
export const project = projectPrefix;
export const resourceNamePrefix = resourcePrefix;
export const shopRepositoryName = repositoryNames.shop;
export const shopRepositoryUrl = repositoryUrl(repositoryNames.shop);
export const shopRepositoryArn = repositoryArn(repositoryNames.shop);
export const paymentsRepositoryName = repositoryNames.payments;
export const paymentsRepositoryUrl = repositoryUrl(repositoryNames.payments);
export const paymentsRepositoryArn = repositoryArn(repositoryNames.payments);
export const createdSharedRepositories = {
  payments: paymentsRepository?.repository.name ?? null,
  shop: shopRepository?.repository.name ?? null,
};
export { region };
