# rd_shop — Test Infrastructure

## Tier layout

| Tier        | Suffix                  | Config                                 | Command                         | Notes                                          |
| ----------- | ----------------------- | -------------------------------------- | ------------------------------- | ---------------------------------------------- |
| Unit        | `*.spec.ts`             | `jest.config.js` (root)                | `npm test`                      | `apps/*/src/`; all deps mocked via `jest.fn()` |
| Integration | `*.integration-spec.ts` | `apps/shop/test/jest-integration.json` | `npm run test:integration:shop` | real Postgres via Testcontainers; infra mocked |
| e2e         | `*.e2e-spec.ts`         | `apps/shop/test/jest-e2e.json`         | `npm run test:e2e:shop`         | TBD — full stack                               |

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
  e2e/                     (reserved, empty)
```

## Path aliases in test code

- `@/*` → `apps/shop/src/*`
- `@test/*` → `apps/shop/test/*`

Jest: `moduleNameMapper` in `jest-integration.json`. TS: `paths` in `test/tsconfig.json`.

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
