# rd-shop Infra

Pulumi TypeScript program for the AWS migration of rd_shop. This stack provisions the shared network, ECS-on-EC2 compute, edge routing, RDS, S3, SES wiring, Secrets Manager / SSM runtime config, and the dedicated RabbitMQ EC2 broker.

## Scope

- `stage` stack: budget-first environment, single-host ECS on `t3.micro`, CloudFront default-domain HTTPS option, 1-day RDS backup retention override
- `production` stack: same architecture shape, larger DB classes, custom-domain public edge by default when domain config is present, currently also pinned to 1-day RDS backup retention by explicit stack override

## Layout

- `index.ts` — top-level composition and exported outputs
- `src/bootstrap.ts` — shared stack/config helpers, naming, tags
- `src/foundation/` — VPC, subnets, route tables, endpoints, security groups
- `src/data/` — RDS, S3, SES config, Secrets Manager, SSM runtime parameters
- `src/compute/` — ECS cluster, EC2 capacity, task definitions, services, ALB / CloudFront edge
- `src/messaging/` — dedicated RabbitMQ EC2 broker, bootstrap, credentials
- `src/public-domain.ts` — public-domain config and validation

## Prerequisites

- Pulumi CLI v3+
- Node.js 24 compatible npm environment
- AWS credentials with rights to preview/apply the stack
- Existing Pulumi stacks: `stage`, `production`
- Deploy-time Pulumi secrets resolved via imported Pulumi ESC environments:
  - `stage` -> `rd-shop/stage`
  - `production` -> `rd-shop/production`

Verify the attached environment and resolved secrets before a real apply:

```bash
cd infra
pulumi config env ls --stack stage
pulumi config --stack stage --show-secrets
```

## Install

```bash
cd infra
npm ci
```

## Type-check

```bash
npx tsc --noEmit -p tsconfig.json
```

Root workspace shortcut:

```bash
npm run type-check
```

## Common Pulumi Commands

Preview stage:

```bash
cd infra
pulumi preview --stack stage
```

Apply stage:

```bash
cd infra
pulumi up --stack stage
```

Preview production:

```bash
cd infra
pulumi preview --stack production
```

Apply production:

```bash
cd infra
pulumi up --stack production
```

Destroy non-production stack:

```bash
cd infra
pulumi destroy --stack stage
```

## Important Config Keys

Core:

- `aws:region`
- `rd-shop-infra:projectPrefix`
- `rd-shop-infra:sharedInfraOwnerStack`

Network / compute:

- `rd-shop-infra:vpcCidr`
- `rd-shop-infra:publicSubnetCidrs`
- `rd-shop-infra:privateSubnetCidrs`
- `rd-shop-infra:natInstanceType`
- `rd-shop-infra:ecsInstanceType`
- `rd-shop-infra:ecsDesiredCapacity`
- `rd-shop-infra:ecsMinSize`
- `rd-shop-infra:ecsMaxSize`

Databases:

- `rd-shop-infra:databaseAllocatedStorageGiB`
- `rd-shop-infra:databaseBackupRetentionDays`
- `rd-shop-infra:databaseEngineMajorVersion`
- `rd-shop-infra:databaseMultiAz`
- `rd-shop-infra:shopDatabaseInstanceClass`
- `rd-shop-infra:paymentsDatabaseInstanceClass`

Public edge:

- `rd-shop-infra:publicEdgeMode`
- `rd-shop-infra:publicRootDomainName`
- `rd-shop-infra:publicApiDomainName`
- `rd-shop-infra:publicHostedZoneId`

Images:

- `rd-shop-infra:shopImageTag` or `rd-shop-infra:shopImageUri`
- `rd-shop-infra:paymentsImageTag` or `rd-shop-infra:paymentsImageUri`

These image-source keys are required for production applies.
For non-production bootstrap, the stack can use a fixed placeholder tag and force ECS desired count to `0` until real images are wired in.
Production previews can still use preview-only placeholder tags so non-image infra diffs can be inspected before real image refs are set.

Secrets:

- `rd-shop-infra:shopJwtAccessSecret`
- `rd-shop-infra:shopTokenHmacSecret`
- `rd-shop-infra:shopRabbitmqUser`
- `rd-shop-infra:shopRabbitmqPassword`

## Safety Notes

- Do not rely on implicit image tags or mutable `latest` deploys.
- Non-production bootstrap can proceed without manual image config: ECS uses a fixed placeholder tag and desired count `0` until real images are configured.
- `production` still requires an explicit image tag or full image URI for both services before `pulumi up`.
- `stage` CloudFront mode is viewer-HTTPS only; CloudFront -> ALB remains HTTP until custom-domain mode is used.
- Payments uses fixed host port `5001` in bridge mode. That keeps internal gRPC/service-discovery wiring simple, but it limits scheduling to one payments task per EC2 host.
- RDS backup retention is explicitly pinned to `1` day in both stack YAML files right now. This is an intentional cost/budget tradeoff, not the production code default.

## Workflow

Typical safe sequence:

```bash
cd infra
npx tsc --noEmit -p tsconfig.json
pulumi preview --stack stage
pulumi up --stack stage
```

For production, run `preview` first and review all replacements carefully before `up`.

## Related Docs

- `docs/backend/requirements/aws-migration-plan.md`
- `docs/backend/architecture/infra-pulumi-source-map.md`
- `docs/backend/architecture/infra-ci-pipeline.md`
