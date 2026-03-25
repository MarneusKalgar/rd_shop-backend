# rd_shop — Project Instructions

## Structure

NestJS monorepo. Two independently deployed services:

- `apps/shop` — HTTP REST + GraphQL (Apollo) + RabbitMQ consumer; port 8080
- `apps/payments` — gRPC only; port 5001

## Key Conventions

- Path alias `@/*` → `apps/<service>/src/*` in both app and test code
- Path alias `@test/*` → `apps/shop/test/*` (test code only, depth-independent)
- DTOs use `class-validator`; all controllers use `ValidationPipe` with `whitelist: true`
- URI versioning, default `v1`; global prefix `api` (health endpoints bypass it)

## Commands

```
npm test                        # unit tests (shop + payments)
npm run test:integration:shop   # integration tests — requires Docker
npm run lint:ci                 # ESLint (no --fix)
npm run type-check              # tsc --noEmit for both services
npm run build                   # nest build
```

## Test Tiers

| Tier        | Suffix                  | Location                      | Notes                                                    |
| ----------- | ----------------------- | ----------------------------- | -------------------------------------------------------- |
| Unit        | `*.spec.ts`             | `apps/*/src/`                 | All deps mocked                                          |
| Integration | `*.integration-spec.ts` | `apps/shop/test/integration/` | Real Postgres via Testcontainers; RabbitMQ + gRPC mocked |
| e2e         | `*.e2e-spec.ts`         | `apps/shop/test/e2e/`         | TBD — full stack, zero mocks                             |

## Infrastructure Mocked in Integration Tests

`RabbitMQService`, `PAYMENTS_GRPC_CLIENT`, `PaymentsGrpcService`, `PaymentsHealthIndicator` — all overridden in `Test.createTestingModule`. Reason: RabbitMQ connects eagerly; proto file (`apps/shop/src/proto/`) is a gitignored build artifact absent on CI.

## CI (GitHub Actions)

PR gate: `install → code-quality → [integration-tests ‖ docker-preview-build] → all-checks-passed`
`node_modules` cached by `actions/cache@v4` keyed on `hash(package-lock.json)`.

## Knowledge Base

Detailed architecture notes live in `docs/architecture/`. Read the relevant file(s) before working on each area:

- `monorepo.md` — two-app structure, tsconfig hierarchy, shared vs. separate, build, inter-service network
- `order-creation-flow.md` — complete order lifecycle: HTTP → RabbitMQ → worker → gRPC → PAID, all idempotency layers
- `order-querying-flow.md` — REST + GraphQL querying, filters, cursor pagination, payment status via gRPC
- `test-infrastructure.md` — test tiers, bootstrap pattern, always-overridden providers
- `db-layer.md` — entity graph, FK constraints, order status flow, adapter pattern, migrations
- `grpc-payments.md` — proto contract, PaymentsGrpcModule/Service, error mapping, health check
- `auth-rbac.md` — JWT strategy, 4 guards, decorators, userId-from-token rule
- `graphql-dataloader.md` — Apollo setup, cursor pagination, 4 DataLoaders
- `rabbitmq-async.md` — queue topology, worker flow, idempotency, mock shape
- `files-s3.md` — 3-step presigned upload flow, FileRecord lifecycle, S3Service, env vars
- `users.md` — User entity, profile CRUD, password change, avatar flow, cursor pagination, search, soft-delete, GraphQL
- `docker-compose.md` — multi-stage Dockerfile, all compose services, networks, dev vs. prod
- `ci-pipeline.md` — 4 workflows, job graph, 7 composite actions, image tag strategy

## Notes

- Newer ask to install deps. Only inform about new packages to add to `package.json` if needed.
- Focus on writing the implementation code, do not:
  - Do not fix import/object keys ordering or formatting issues. This will be handled by ESLint and Prettier.
  - Do not try to launch type-check and test scripts. These are expected to fail until the relevant code is implemented.
  - Do not try to generate a migration file if you create new TypeORM entity. Focus on defining the entity and its relations correctly. Also register it in the `apps/shop/src/config/typeORM.ts` or `apps/payments/src/config/typeORM.ts` depending on the service.
- Never throw from controllers; throw from the service layer instead.
- Each new env var should be added to `apps/shop/.env.example`/`apps/shop/.env.development` or `apps/payments/.env.example`/`apps/payments/.env.development` with a default value and register in the `apps/shop/src/core/environment/schema.ts` or `apps/payments/src/core/environment/schema.ts` depending on the service.
- If you need to create constants - create `constants/index.ts` file in the relevant domain and export them from there. Do not create multiple constants files unless there is a very good reason to do so.
