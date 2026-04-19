# rd_shop — Test Infrastructure

## Tier layout

| Tier        | Suffix                  | Config                                 | Command                         | Notes                                          |
| ----------- | ----------------------- | -------------------------------------- | ------------------------------- | ---------------------------------------------- |
| Unit        | `*.spec.ts`             | `jest.config.js` (root)                | `npm test`                      | `apps/*/src/`; all deps mocked via `jest.fn()` |
| Integration | `*.integration-spec.ts` | `apps/shop/test/jest-integration.json` | `npm run test:integration:shop` | real Postgres via Testcontainers; infra mocked |
| e2e         | `*.e2e-spec.ts`         | `apps/shop/test/jest-e2e.json`         | `npm run test:e2e:shop`         | full docker-compose stack; real HTTP calls     |

## File layout under `apps/shop/test/`

```
test/
  jest-e2e.json            testRegex: .e2e-spec.ts$
  jest-integration.json    testRegex: .integration-spec.ts$; setupFiles: integration/test-env-setup.ts
  paths.ts                 exports MIGRATIONS_GLOB (anchored to test/ — no ../ traversals)
  tsconfig.json            extends ../tsconfig.app.json; sets @/* and @test/* path aliases
  integration/
    test-env-setup.ts      loads apps/shop/test/integration/.env.test before module eval
    orders/
      __mock__/index.ts    ordersMockData (userId, productId, 6 orderIds, 6 itemIds — fixed UUIDs)
      graphql-orders-pagination.integration-spec.ts
  e2e/
    .env.e2e               shop env vars for e2e stack (gitignored)
    .env.e2e.payments      payments env vars for e2e stack (gitignored)
    test-env-setup.ts      loads .env.e2e; sets globalSetup for e2e suite
    helpers/
      index.ts             barrel — re-exports all 4 helpers
      auth.ts              signupAndSignin(email, password) → JWT token
      cart.ts              addToCartAndCheckout(token, productId, quantity?, idempotencyKey?) → { order, token }
      poll.ts              poll<T>(fn, opts) — retries until truthy or timeout
      wait-for-ready.ts    waitForReady(baseUrl) — polls /health until 200
    cart/
      cart-flow.e2e-spec.ts
    orders/
      constants.ts         BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8092'
      interfaces.ts        OrderBody, PaymentBody, ProductBody, OrdersListBody, OrderItemBody
      order-lifecycle.e2e-spec.ts
      orders-querying.e2e-spec.ts
    scripts/
      e2e-migrate.sh       runs shop + payments migrations against e2e Postgres containers
      e2e-seed.sh          seeds shop DB with products/users/orders via TypeORM data-source
```

## Path aliases in test code

- `@/*` → `apps/shop/src/*`
- `@test/*` → `apps/shop/test/*`

Jest: `moduleNameMapper` in both `jest-integration.json` and `jest-e2e.json`. TS: `paths` in `test/tsconfig.json`.

## Integration test bootstrap pattern

1. Start `PostgreSqlContainer('postgres:16-alpine')` in `beforeAll`
2. Set `process.env.DATABASE_URL = container.getConnectionUri()`
3. Run migrations via separate `DataSource` using `MIGRATIONS_GLOB` from `@test/paths`
4. `Test.createTestingModule({ imports: [AppModule] })` with 4 overrides (see below)
5. Mirror `main.ts` bootstrap (versioning, global prefix, ValidationPipe)
6. Seed rows; sign JWT via `app.get(JwtService)`
7. `afterAll`: delete in FK order → `app.close()` → `container.stop()`

## Providers always overridden (integration tests)

| Provider                  | Reason                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `RabbitMQService`         | AMQP connects eagerly in `onModuleInit`                                                    |
| `PAYMENTS_GRPC_CLIENT`    | `ClientProxyFactory.create()` reads `.proto` file — gitignored build artifact absent on CI |
| `PaymentsGrpcService`     | `onModuleInit` calls `client.getService()` on the real client                              |
| `PaymentsHealthIndicator` | Same — also calls `client.getService()` in `onModuleInit`                                  |

Proto file path: `apps/shop/src/proto/` — gitignored, populated at build time from root `proto/payments.proto` via `nest-cli.json` assets copy.

## `test-env-setup.ts`

- Lives at `apps/shop/test/integration/test-env-setup.ts`
- Referenced as `setupFiles` in `jest-integration.json`
- Runs before any spec file is imported → ensures `NODE_ENV=test` and `.env.test` loaded before `AppModule` eval
- `.env.test` path: `apps/shop/test/integration/.env.test` (allowlisted in `.gitignore` via `!` exception)

## e2e test stack

### Infrastructure (`compose.e2e.yml`)

Full docker-compose stack in `apps/shop/compose.e2e.yml`, project name `rd_shop_e2e`. Ports isolated from dev (8080/5432/5672) and perf (8090/5433/5673):

| Service                 | Port(s)      | Notes                                                        |
| ----------------------- | ------------ | ------------------------------------------------------------ |
| `postgres-shop-e2e`     | 5436         | tmpfs storage — ephemeral                                    |
| `postgres-payments-e2e` | 5437         | tmpfs storage — ephemeral                                    |
| `rabbitmq-e2e`          | 5675 / 15675 | AMQP + management UI                                         |
| `minio-e2e`             | 9002 / 9003  | tmpfs storage; bucket init via `minio-init-e2e` one-shot     |
| `payments-e2e`          | —            | profile: `app`; built from Dockerfile `prod-payments` target |
| `shop-e2e`              | 8092         | profile: `app`; built from Dockerfile `prod-shop` target     |

Migration/seed containers use profile `migrate` / `seed` respectively, run via shell scripts.

### npm scripts (from `apps/shop/`)

```
e2e:up       start infra containers (postgres + rabbitmq + minio + minio-init)
e2e:migrate  bash test/e2e/scripts/e2e-migrate.sh  — runs both DB migrations
e2e:seed     bash test/e2e/scripts/e2e-seed.sh     — seeds shop DB
e2e:app      docker compose --profile app up        — starts payments-e2e + shop-e2e
e2e:fresh    e2e:up && e2e:migrate && e2e:seed && e2e:app || e2e:down
e2e:down     docker compose --profile app down -v --remove-orphans --rmi local
```

`--rmi local` on `e2e:down` removes locally-built `shop-e2e` and `payments-e2e` images. `--profile app` required so compose includes app containers in the down scope (otherwise their images cannot be deleted — "still in use").

### e2e spec structure

| File                                 | Coverage                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `orders/order-lifecycle.e2e-spec.ts` | PENDING→PAID flow; cancellation + stock restore; idempotency                               |
| `orders/orders-querying.e2e-spec.ts` | GET by ID; list with pagination/cursor; 401/404 edge cases                                 |
| `cart/cart-flow.e2e-spec.ts`         | add/upsert/remove items; checkout; empty-cart 400; validates `addToCartAndCheckout` helper |

### Type-safety pattern

Supertest responses are typed `any`. Cast via `unknown` to avoid ESLint `@typescript-eslint/no-unsafe-member-access`:

```ts
// Correct
const { data } = res.body as unknown as { data: OrderBody };

// Wrong — flagged by linter
const data = res.body.data as OrderBody;
```
