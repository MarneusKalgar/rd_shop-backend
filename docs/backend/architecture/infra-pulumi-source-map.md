# rd_shop - Pulumi Source Map

Purpose: keep [infra/index.ts](../../../infra/index.ts) thin.
Use this page when you need to find which file owns a migration step, resource family, or Pulumi helper.

## Reading Order

1. Start at `infra/index.ts` for top-level composition and exported outputs.
2. Jump to `infra/src/bootstrap.ts` for stack naming, tags, stack/region helpers, and shared identifiers.
3. Follow the relevant phase below to the owning module group.
4. Use `pulumi preview` only after the matching TypeScript slice is clean.

## Phase Map

| Step    | Infra responsibility                                                                       | Entry function from `infra/index.ts` | Primary owner files                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.2-0.4 | Shared foundation orchestration for ECR, VPC, subnets, NAT, endpoints, and security groups | `createFoundation()`                 | `infra/src/foundation/index.ts`, `infra/src/foundation/ecr.ts`, `infra/src/foundation/network.ts`, `infra/src/foundation/security-groups.ts` |
| 1.1     | RDS instances, subnet group, parameter group                                               | `createFoundationDatabases(...)`     | `infra/src/data/database-config.ts`, `infra/src/data/databases.ts`                                                                           |
| 1.2     | Private S3 file bucket                                                                     | `createFoundationFileStorage()`      | `infra/src/data/file-storage-config.ts`, `infra/src/data/file-storage.ts`                                                                    |
| 1.3-1.4 | Secrets Manager + SSM runtime config for both services                                     | `createFoundationRuntimeConfig(...)` | `infra/src/data/runtime-config.ts`                                                                                                           |
| 1.5     | SES sender identity wiring                                                                 | `createFoundationSes()`              | `infra/src/data/ses-config.ts`, `infra/src/data/ses.ts`                                                                                      |
| 2.2     | ECS cluster, EC2 hosts, launch template, ASG, capacity provider                            | `createFoundationCompute(...)`       | `infra/src/compute/compute-config.ts`, `infra/src/compute/compute-user-data.ts`, `infra/src/compute/compute.ts`                              |
| 2.3-2.4 | ECS task defs, IAM roles, CloudWatch logs, Cloud Map, ECS services                         | `createComputeServices(...)`         | `infra/src/compute/service-definitions.ts`, `infra/src/compute/services-config.ts`, `infra/src/compute/services.ts`                          |
| 2.4-2.5 | ALB, access logs bucket, CloudFront/custom-domain public edge                              | `createComputeEdge(...)`             | `infra/src/compute/edge-config.ts`, `infra/src/compute/edge.ts`, `infra/src/public-domain.ts`                                                |
| 3       | Dedicated RabbitMQ broker on EC2 with EBS-backed data volume                               | `createMessageBroker(...)`           | `infra/src/messaging/mq-config.ts`, `infra/src/messaging/mq-user-data.ts`, `infra/src/messaging/mq.ts`                                       |

## Module Ownership

### `infra/index.ts`

- Owns phase ordering.
- Owns cross-phase wiring between outputs and inputs.
- Owns exported stack outputs.
- Should not become the home for resource-specific validation or implementation details.

### `infra/src/bootstrap.ts`

- Owns stack name helpers.
- Owns common tags.
- Owns account, region, stack, and shared-infra-owner helpers.
- Safe place for shared naming/resource identity helpers used by multiple phases.

### `infra/src/foundation/`

- `index.ts` is the folder entrypoint and owns Step 0.2-0.4 orchestration.
- Owns network and security primitives.
- Changes here affect almost every later phase.
- Usual reasons to edit:
  - CIDR layout changes
  - subnet count/AZ changes
  - NAT behavior changes
  - security-group rule changes
  - interface endpoint changes

### `infra/src/data/`

- `index.ts` is the folder entrypoint used by `infra/index.ts`.
- Owns durable data services and runtime secret/parameter publication.
- `runtime-config.ts` is the bridge between provisioned infrastructure and application env wiring.
- Edit here for DB sizing, bucket behavior, runtime parameter names, secret payload shape, or SES sender config.

### `infra/src/compute/`

- `index.ts` is the folder entrypoint used by `infra/index.ts`.
- Owns ECS host capacity, task definitions, services, service discovery, logging, and public ingress.
- Split by concern:
  - `compute*.ts`: ECS cluster + EC2 hosts
  - `service-definitions.ts`: container JSON definitions
  - `services-config.ts`: deploy rules, desired counts, image source validation
  - `services.ts`: IAM roles, task defs, ECS services, Cloud Map
  - `edge-config.ts` and `edge.ts`: ALB / CloudFront / custom-domain ingress

### `infra/src/messaging/`

- `index.ts` is the folder entrypoint used by `infra/index.ts`.
- Owns dedicated RabbitMQ broker config, credentials, and host bootstrap.
- Edit here for broker image/version, instance sizing, storage, bootstrap flow, or connection endpoint behavior.

### `infra/src/public-domain.ts`

- Owns normalization and validation of public API domain inputs.
- Shared by edge provisioning when custom-domain or CloudFront modes are enabled.

## Common Change Routes

| You need to change...                            | Start here                                 | Then check                                                         |
| ------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------ |
| VPC/subnet shape                                 | `infra/src/foundation/network.ts`          | `infra/src/foundation/subnets.ts`, `infra/index.ts`                |
| Security-group rules                             | `infra/src/foundation/security-groups.ts`  | dependent phase inputs in `infra/index.ts`                         |
| DB instance shape or retention                   | `infra/src/data/database-config.ts`        | stack YAML overrides, `infra/src/data/databases.ts`                |
| Runtime secret keys or parameter names           | `infra/src/data/runtime-config.ts`         | app env schemas and deploy expectations                            |
| ECS host count/instance type                     | `infra/src/compute/compute-config.ts`      | `infra/src/compute/compute.ts`, deployment settings                |
| Container env/secrets/health checks              | `infra/src/compute/service-definitions.ts` | `infra/src/compute/services.ts`                                    |
| Desired counts/deployment policy/image selection | `infra/src/compute/services-config.ts`     | CI image publishing and stack config                               |
| Public ALB / CloudFront / certs / DNS            | `infra/src/compute/edge-config.ts`         | `infra/src/compute/edge.ts`, `infra/src/public-domain.ts`          |
| RabbitMQ host sizing/bootstrap                   | `infra/src/messaging/mq-config.ts`         | `infra/src/messaging/mq-user-data.ts`, `infra/src/messaging/mq.ts` |

## Guardrails

- Keep resource implementation in the owning module, not in `infra/index.ts`.
- Put shared naming/tag logic in `infra/src/bootstrap.ts` only when at least two areas need it.
- When a change crosses phases, update the local step comments in `infra/index.ts` so the wiring still reads in deployment order.
- If a function accepts stack config, document and validate it in the nearest config module before it reaches the resource builder.

## Verification

Minimal safe loop after infra edits:

```bash
cd infra
npx tsc --noEmit -p tsconfig.json
pulumi preview --stack stage
```

Use `pulumi up` only after the preview matches the intended blast radius.
