# Orders Module — Testing Plan

Comprehensive coverage strategy for the **orders** domain — the project's primary end-to-end loop. Targets all four test tiers (unit, integration, e2e, contract) and pairs them with a refactor recommendation for [`apps/shop/src/orders/orders.service.ts`](../../../apps/shop/src/orders/orders.service.ts) (currently 809 LOC, growing toward 1k).

---

## Why orders specifically

- **Touches every cross-cutting concern**: HTTP/GraphQL → JWT auth → DB transaction with row locks → RabbitMQ → worker → gRPC → email events → audit log. If orders pass, the integration surface of the whole system passes.
- **Highest business value**: stock oversell, double-charge, or lost-order bugs are the most expensive failure modes.
- **Highest concurrency risk**: pessimistic locking, idempotency keys, message replay, worker retries — every one of these has a non-obvious failure mode that only tests catch.

---

## Part A — Critical surfaces (ranked by business risk × bug likelihood)

### Tier 1 — MUST cover (oversell, double-charge, money-losing bugs)

| #   | Surface                                                        | Risk if untested                                                            | Best tier       |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------- |
| 1   | `executeOrderTransaction` — pessimistic lock + stock decrement | Oversell under concurrent orders → real money loss                          | **Integration** |
| 2   | `processOrderMessage` — `ProcessedMessage` idempotency         | Duplicate processing → double-charge customer                               | **Integration** |
| 3   | `createOrder` — idempotency-key short-circuit                  | Double-submit creates two orders → double-charge                            | **Unit + Int**  |
| 4   | `authorizePayment` — gRPC call + DB update + audit + event     | Failure mid-flow → order in PROCESSED forever, money taken but not recorded | **Integration** |
| 5   | `cancelOrder` — stock restore for PENDING/PROCESSED/PAID       | Cancel without restore → lost inventory; restore on already-cancelled = bug | **Integration** |
| 6   | `assertOrderOwnership` — userId check on read paths            | IDOR — user A reads/cancels user B's order                                  | **Unit + e2e**  |

### Tier 2 — SHOULD cover (correctness, UX)

| #   | Surface                                                            | Risk if untested                             | Best tier       |
| --- | ------------------------------------------------------------------ | -------------------------------------------- | --------------- |
| 7   | `validateOrderItems` — quantity > 0, ≤ MAX_ORDER_QUANTITY          | 400 not returned → bad data committed        | **Unit**        |
| 8   | `findOrdersWithFilters` — cursor pagination + filters              | Wrong slice / missed pages / N+1             | **Integration** |
| 9   | `handleOrderCreationPgErrors` — 57014/55P03/23505 mapping          | Wrong HTTP status → client retries wrong way | **Unit**        |
| 10  | `publishOrderProcessingMessage` — message published with messageId | Worker never runs → order stuck in PENDING   | **Unit (mock)** |
| 11  | `getOrderPayment` — gRPC error → HTTP mapping                      | 5xx leaks → client-side error explosion      | **Unit + Int**  |
| 12  | Email events emitted on creation/paid/cancelled                    | Silent loss of customer comms                | **Unit**        |

### Tier 3 — NICE to have (defensive)

| #   | Surface                                                 | Test tier            |
| --- | ------------------------------------------------------- | -------------------- |
| 13  | `getTotalSumInCents` utility — money math precision     | Unit (pure function) |
| 14  | `buildOrderNextCursor` — cursor encoding edge cases     | Unit (pure function) |
| 15  | `OrdersQueryBuilder` — SQL query shape per filter combo | Unit (snapshot)      |
| 16  | Worker retry/DLQ flow                                   | Integration (worker) |

---

## Part B — Test tier blueprint

### Unit tests — `apps/shop/src/orders/**/*.spec.ts`

**Goal**: pure logic + branch coverage. All deps mocked via `jest.fn()`. Fast (< 5 s for whole suite).

**Files to add:**

```
orders/
  orders.service.spec.ts           # createOrder, cancelOrder, processOrderMessage branches
  utils/
    get-total-sum-in-cents.spec.ts
    build-order-next-cursor.spec.ts
  repositories/
    orders-query-builder.spec.ts   # SQL snapshot per filter combination
```

**Branches that MUST be exercised in `orders.service.spec.ts`** (these are the ones currently untested and most likely to break silently on refactor):

- `createOrder` → idempotency hit returns existing order (no DB write, no publish)
- `createOrder` → invalid quantity throws `BadRequestException` _before_ transaction
- `createOrder` → product disappears between pre-check and lock → `NotFoundException`
- `createOrder` → insufficient stock → `ConflictException` rolled back
- `processOrderMessage` → `messageId` already in `ProcessedMessage` → early return, no DB writes
- `processOrderMessage` → 23505 unique violation on insert → safe duplicate, return without throw
- `processOrderMessage` → order not in PENDING → guard skips work
- `processOrderMessage` → `RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION=true` → skips `authorizePayment`
- `authorizePayment` → response missing `paymentId` → no DB update, no event
- `authorizePayment` → gRPC throws → audit `ORDER_PAYMENT_FAILED` logged, error re-thrown
- `cancelOrder` → already CANCELLED → 409
- `cancelOrder` → CREATED legacy state → 400
- `cancelOrder` → ownership mismatch → 404 (NOT 403 — info-leak prevention)
- `getOrderPayment` → no `paymentId` → 400

### Integration tests — `apps/shop/test/integration/orders/*.integration-spec.ts`

**Goal**: real Postgres via Testcontainers; RabbitMQ + gRPC mocked at provider boundary (existing convention — see [test-infrastructure.md](../architecture/test-infrastructure.md)).

**Files to add** (one already exists: `graphql-orders-pagination.integration-spec.ts`):

```
integration/orders/
  create-order.integration-spec.ts
  create-order-concurrency.integration-spec.ts    # ← the most important file in the suite
  cancel-order.integration-spec.ts
  process-order-message.integration-spec.ts
  process-order-message-idempotency.integration-spec.ts
  authorize-payment.integration-spec.ts
  find-orders.integration-spec.ts
  get-order-payment.integration-spec.ts
```

**Key scenarios per file:**

- **create-order** — happy path (PENDING + RabbitMQ publish mock called once + correct stock decrement); idempotency-key replay returns same order; product not found; product inactive; user not found.
- **create-order-concurrency** — fire 10 parallel `createOrder()` calls for the same product with stock=5. Assert: exactly 5 succeed, 5 throw `ConflictException`, final stock = 0, no orders created beyond stock. **This proves the pessimistic lock works in real Postgres** — impossible to assert in unit tests.
- **cancel-order** — cancel PENDING / PROCESSED / PAID → stock restored; double-cancel → 409; cancel other user's order → 404.
- **process-order-message** — message processed end-to-end → order PROCESSED → mocked gRPC returns paymentId → order PAID. Assert audit log rows exist.
- **process-order-message-idempotency** — same `messageId` processed twice (parallel + sequential) → only one DB write, no duplicate `ProcessedMessage`, gRPC mock called once.
- **authorize-payment** — gRPC mock throws → order stays PROCESSED, `ORDER_PAYMENT_FAILED` audit written; gRPC returns no `paymentId` → no update, no event.
- **find-orders** — cursor pagination correctness (10 items, limit=3, walk all 4 pages, no duplicates, no gaps); status filter; date range filter; another user's orders never returned.
- **get-order-payment** — order with paymentId → gRPC mock returns status; order without paymentId → 400.

**Why integration over unit for these**: every one of them depends on Postgres semantics (`FOR UPDATE`, unique index `23505`, transaction isolation) that mocks cannot faithfully simulate.

### e2e tests — pick **one or two** flows only

**Goal**: zero mocks, full deployed stack, verifies the whole loop the TOR section 4 requires.

**Recommended flows:**

#### Flow 1 (mandatory) — Happy-path order lifecycle

```
POST /api/v1/auth/signin                       → 200, accessToken
POST /api/v1/orders                            → 201, status=PENDING
poll GET /api/v1/orders/:id (≤ 10s)            → status=PAID
GET  /api/v1/orders/:id/payment                → 200, { paymentId, status: AUTHORIZED }
GET  /api/v1/products/:id                      → stock decremented
SELECT * FROM audit_logs WHERE target_id=:id   → 3 rows: ORDER_CREATED, ORDER_PAYMENT_AUTHORIZED, (worker log)
```

This single flow exercises: HTTP, JWT, validation, DB transaction, RabbitMQ round-trip, gRPC round-trip, audit log, observability hook. **One test = the whole TOR section 4 checklist.**

#### Flow 2 (recommended) — Cancellation with stock restore

```
POST /api/v1/orders                            → 201
poll until PAID
POST /api/v1/orders/:id/cancel                 → 200, status=CANCELLED
GET  /api/v1/products/:id                      → stock restored to original
```

#### Flow 3 (optional, defensive) — Idempotency replay

```
POST /api/v1/orders { idempotencyKey: 'k1' }   → 201, orderId=X
POST /api/v1/orders { idempotencyKey: 'k1' }   → 200/201, orderId=X (same!)
GET  /api/v1/orders                            → exactly one order in list
```

### Tooling for e2e — choice & trade-offs

| Tool                                       | Pros                                                                                                        | Cons                                                                                         | Verdict                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Jest + Supertest + docker-compose**      | Same toolchain as unit/integration; CI plugs in directly; can reuse Testcontainers patterns; strongly typed | Slow startup (~30s per cold compose); flaky with shared resources                            | ✅ **Best fit** — minimal new tooling, existing `jest-e2e.json` reserved                         |
| **Playwright (API mode) + docker-compose** | Built-in retries, video/trace artifacts on failure, parallel sharding, browser-grade reporting              | Adds heavy dep, mostly designed for browser flows; overkill for API-only                     | Use only if a frontend e2e is also planned                                                       |
| **k6 + scenario assertions**               | Already present (perf suite). One tool covers perf + smoke/e2e; native HTTP DSL                             | k6 assertion model is shallow (thresholds, not deep invariants); no `expect().toMatchObject` | Reuse for **post-deploy smoke** (the existing `smoke-test-shop` action); not for e2e correctness |
| **Postman/Newman collections**             | Easy to share with non-devs; CLI runner exists                                                              | JSON-driven assertions are hard to maintain; no type safety; weak parallelism                | Avoid                                                                                            |
| **Pact / contract testing**                | Versioned consumer-driven contracts between shop and payments                                               | High onboarding cost, requires broker infra                                                  | See "Contract testing" section below                                                             |

**Recommendation:** Jest + Supertest + `compose.e2e.yml`, following the same npm-script-managed Docker lifecycle as the perf suite. Stack managed externally (npm scripts); Jest does **not** start/stop Docker. One spec file: `apps/shop/test/e2e/order-lifecycle.e2e-spec.ts`.

### Implementation order

Mirror the perf pattern exactly: `compose.e2e.yml` with profiles → shell scripts for migrate/seed → npm scripts → Jest config → helpers → spec.

#### Step 1 — `apps/shop/compose.e2e.yml`

Services (port offsets chosen to avoid conflict with dev/perf stacks):

| Service                 | Role                    | Port on host                          |
| ----------------------- | ----------------------- | ------------------------------------- |
| `postgres-shop-e2e`     | Shop DB                 | 5436 (tmpfs, auto-wiped on `down -v`) |
| `postgres-payments-e2e` | Payments DB             | 5437 (tmpfs)                          |
| `rabbitmq-e2e`          | Message broker          | 5675 AMQP / 15675 UI                  |
| `minio-e2e`             | File storage            | 9002 / 9003 console                   |
| `minio-init-e2e`        | Bucket init (one-shot)  | —                                     |
| `migrate-shop-e2e`      | Run shop migrations     | — profile: `migrate-shop`             |
| `migrate-payments-e2e`  | Run payments migrations | — profile: `migrate-payments`         |
| `seed-e2e`              | Seed shop DB            | — profile: `seed`                     |
| `payments-e2e`          | gRPC service            | — internal only, profile: `app`       |
| `shop-e2e`              | HTTP/GraphQL service    | 8092, profile: `app`                  |

Key compose details:

- `postgres-shop-e2e` and `postgres-payments-e2e`: use `tmpfs: [/var/lib/postgresql/data]` — data disappears on `down`, no volume needed, no manual cleanup
- `shop-e2e` startup command: `cp /app/proto/payments.proto /app/apps/shop/src/proto/payments.proto && cd apps/shop && npm run start:prod` (same proto-copy as `compose.dev.yml`)
- `payments-e2e` is on an internal-only bridge network shared with `shop-e2e`; no host port exposure
- Both app services have `healthcheck` on `/health`
- `migrate-shop-e2e` and `migrate-payments-e2e`: `image: rd_shop_e2e_migrate_shop_tmp` / `rd_shop_e2e_migrate_payments_tmp`, `pull_policy: build`, `restart: 'no'`, `profiles: [migrate-shop]` / `[migrate-payments]`
- `seed-e2e`: `profiles: [seed]`, `ALLOW_SEED_IN_PRODUCTION: 'true'`, same pattern as `seed-perf`

Networks:

```
e2e-internal:   bridge, internal: true   # shop ↔ postgres-shop + rabbitmq + payments
e2e-external:   bridge                   # shop port 8092 reachable from test process on host
e2e-payments-internal: bridge, internal: true  # payments ↔ postgres-payments
```

#### Step 2 — `apps/shop/test/e2e/.env.e2e`

All env vars for the e2e stack. Template values matching the port offsets above. Pattern: copy `.env.development`, change ports/project names, set `NODE_ENV=production`, `PORT=8080` (container-internal listen port; host maps `8092:8080`), `GRPC_HOST=payments-e2e`, `GRPC_PORT=5001`.

#### Step 3 — `apps/shop/test/e2e/scripts/e2e-migrate.sh`

```bash
#!/usr/bin/env bash
COMPOSE="docker compose -p rd_shop_e2e -f compose.e2e.yml"

$COMPOSE --profile migrate-shop run --rm migrate-shop-e2e
STATUS=$?
docker rmi rd_shop_e2e_migrate_shop_tmp 2>/dev/null || true
[ $STATUS -ne 0 ] && exit $STATUS

$COMPOSE --profile migrate-payments run --rm migrate-payments-e2e
STATUS=$?
docker rmi rd_shop_e2e_migrate_payments_tmp 2>/dev/null || true

exit $STATUS
```

Mirrors `perf-migrate.sh` — captures exit code, removes one-shot images.

#### Step 4 — `apps/shop/test/e2e/scripts/e2e-seed.sh`

```bash
#!/usr/bin/env bash
COMPOSE="docker compose -p rd_shop_e2e -f compose.e2e.yml"

$COMPOSE --profile seed run --rm seed-e2e
STATUS=$?

$COMPOSE rm -f migrate-shop-e2e migrate-payments-e2e 2>/dev/null || true
docker rmi rd_shop_e2e_seed_tmp rd_shop_e2e_migrate_shop_tmp rd_shop_e2e_migrate_payments_tmp 2>/dev/null || true

exit $STATUS
```

#### Step 5 — npm scripts in `apps/shop/package.json`

```jsonc
"e2e:up":      "docker compose -p rd_shop_e2e -f compose.e2e.yml up -d postgres-shop-e2e postgres-payments-e2e rabbitmq-e2e minio-e2e",
"e2e:migrate": "bash test/e2e/scripts/e2e-migrate.sh",
"e2e:seed":    "bash test/e2e/scripts/e2e-seed.sh",
"e2e:app":     "docker compose -p rd_shop_e2e -f compose.e2e.yml --profile app up -d",
"e2e:fresh":   "npm run e2e:up && npm run e2e:migrate && npm run e2e:seed && npm run e2e:app",
"e2e:down":    "docker compose -p rd_shop_e2e -f compose.e2e.yml down -v --remove-orphans",
"test:e2e":    "jest --config test/jest-e2e.json --runInBand"
```

`down -v` destroys all volumes + tmpfs DBs — complete autoremove, no dangling state.

#### Step 6 — Update `apps/shop/test/jest-e2e.json`

Add what `jest-integration.json` has but `jest-e2e.json` currently lacks:

```jsonc
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "moduleNameMapper": {
    "^@/(.*)$": "<rootDir>/../src/$1",
    "^@test/(.*)$": "<rootDir>/$1",
    "^@app/common(/.*)$": "<rootDir>/../../../libs/common/src$1",
    "^@app/common$": "<rootDir>/../../../libs/common/src",
  },
  "rootDir": ".",
  "setupFiles": ["<rootDir>/e2e/test-env-setup.ts"],
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "testTimeout": 30000,
  "transform": {
    "^.+\\.(t|j)s$": ["ts-jest", { "tsconfig": "<rootDir>/tsconfig.json" }],
  },
}
```

No `globalSetup`/`globalTeardown` — Docker lifecycle is npm-script-managed (same as perf).

#### Step 7 — `apps/shop/test/e2e/test-env-setup.ts`

```typescript
import dotenv from 'dotenv';
import { join } from 'path';
dotenv.config({ override: true, path: join(__dirname, '.env.e2e') });
```

Mirrors `test/integration/test-env-setup.ts`.

#### Step 8 — `apps/shop/test/e2e/helpers/wait-for-ready.ts`

```typescript
export async function waitForReady(url: string, timeoutMs = 60_000): Promise<void> { ... }
```

Polls `GET url` every 2 s until 200 or timeout. Called once in `beforeAll` of the spec (not in globalSetup — the spec file is the only consumer).

#### Step 9 — `apps/shop/test/e2e/helpers/auth.ts`

```typescript
export async function signIn(baseUrl: string, email: string, password: string): Promise<string>;
```

POST `/api/v1/auth/signin`, returns `accessToken`. Used by every flow.

#### Step 10 — `apps/shop/test/e2e/helpers/poll.ts`

```typescript
export async function pollUntilStatus(
  baseUrl: string,
  orderId: string,
  token: string,
  targetStatus: OrderStatus,
  timeoutMs = 10_000,
): Promise<OrderDto>;
```

Retries `GET /api/v1/orders/:id` every 500 ms until `status === targetStatus` or timeout. Used to wait for `PAID` and `CANCELLED`.

#### Step 11 — `apps/shop/test/e2e/order-lifecycle.e2e-spec.ts`

`beforeAll`: call `waitForReady`, sign in once to get token, capture `BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8092'`.

Three `describe` blocks matching Flows 1–3. Each flow creates its own isolated user + product (via API or direct `supertest` POST) to avoid inter-flow pollution under `--runInBand`.

### Contract testing (shop ↔ payments)

The `payments.proto` file is the contract. Two practical options, in increasing rigour:

| Option                                      | What it gives you                                                                                                                                                      | Effort      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **Proto-snapshot test** (recommended start) | Snapshot test on `payments.proto` checksum + a generated TypeScript interface diff in CI. Breaks the build if either side changes the proto without bumping a version. | Low (½ day) |
| **buf breaking-change check** in CI         | `buf breaking` against the previous git revision — official, structured, language-agnostic                                                                             | Low–Med     |
| **Pact (gRPC plugin)**                      | Consumer-driven contract: shop publishes expectations, payments verifies in its own CI                                                                                 | High        |

For this project's scale, **buf breaking + a checksum snapshot** is the right middle ground. Pact is overkill for two services owned by the same team.

---

## Part C — Refactoring `orders.service.ts`

### Current state

- **809 LOC** in a single class.
- **17 responsibilities** in one constructor: `userRepo`, `ordersRepository`, `productsRepository`, `orderItemsRepository`, `ordersQueryBuilder`, `dataSource`, `rabbitmqService`, `paymentsGrpcService`, `eventEmitter`, `auditLogService`, `configService`. That's a code smell on its own.
- Mixes **3 distinct domains**:
  1. **Order command side** (create, cancel)
  2. **Order query side** (findOrders, getOrderById, getOrderPayment)
  3. **Worker-side processing** (`processOrderMessage`, `authorizePayment`)

### Proposed split (target: 4 services × ~200 LOC each)

```
orders/
  services/
    orders-command.service.ts        # createOrder, cancelOrder           (~250 LOC)
    orders-query.service.ts          # findOrdersWithFilters, getById,     (~120 LOC)
                                     # getOrderPayment
    order-processing.service.ts      # processOrderMessage, authorizePayment (~200 LOC)
                                     # — called only by OrderWorkerService
    order-stock.service.ts           # validateStockAndAvailability,        (~80 LOC)
                                     # decrementProductStock,
                                     # restoreProductStock (extracted from cancelOrder)
  helpers/
    pg-error-mapper.ts               # handleOrderCreationPgErrors          (~50 LOC)
    order-publisher.ts               # publishOrderProcessingMessage        (~30 LOC, thin RabbitMQ wrapper)
  orders.service.ts                  # DELETED (or keep as facade re-exporting the 4 services for backward compat)
```

**Reasoning per split:**

- **Command vs Query**: classic CQRS-lite. Query side has zero side effects, no transaction, no event emitter — its constructor shrinks from 11 deps to 3 (`ordersRepository`, `ordersQueryBuilder`, `paymentsGrpcService`).
- **OrderProcessingService**: only the worker calls it. Today, `processOrderMessage` lives next to `createOrder` even though no HTTP request ever hits it. Moving it eliminates a subtle reasoning trap ("can I call this from the controller?" — no, but the colocation suggests yes).
- **OrderStockService**: stock math is duplicated between create (decrement) and cancel (restore). Extract once, test once, mock once.
- **PG error mapper + Publisher**: pure functions; trivial to unit test in isolation.

### Refactor BEFORE or AFTER tests?

**Tests first. No exceptions.**

Reasoning:

| Argument                                                                                                | Why it matters here                                                                                            |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| You have **no safety net today** — only the GraphQL pagination integration spec exists                  | A 4-way split touches transaction code, message ack, and event emission. Risk of silent regression is enormous |
| Integration tests pin **observable behaviour**, not internal structure                                  | They survive refactoring — they assert "create order → DB row + queue message", not which service emitted what |
| Unit tests written against the current god-service will need rewrites after the split — **that's fine** | Better to throw away unit tests after a refactor than to lose customer money mid-refactor                      |
| TDD-style refactor: split the file, run integration suite green-to-green                                | Each extraction is a verified-safe move                                                                        |

**Recommended sequence:**

1. **Add integration tests first** (full Tier 1 list above) — `create-order`, `create-order-concurrency`, `process-order-message`, `process-order-message-idempotency`, `cancel-order`, `authorize-payment`. These pin behaviour at the domain boundary and survive the split unchanged.
2. **Add the e2e happy-path test** — second safety net, catches anything integration tests mock away (real RabbitMQ + real gRPC).
3. **Refactor in 4 small PRs**, integration suite green after each:
   - PR 1: extract `OrderStockService` (smallest, lowest risk)
   - PR 2: extract `OrdersQueryService` (read-only, no transaction risk)
   - PR 3: extract `OrderProcessingService` (worker boundary — biggest blast radius, deserves its own PR)
   - PR 4: extract helpers + delete the god service / convert to facade
4. **Add unit tests last** — once each new service has a clear single responsibility, unit tests become obvious to write and stable.

**Anti-pattern to avoid:** "I'll refactor first because the code is cleaner, then write tests" → you'll change behaviour by accident, ship a regression, and have no test that would have caught it. The 1k-LOC file _is_ the problem; it's also the only currently-working version.

---

## Part D — Coverage targets & CI integration

| Tier        | Target line coverage on `orders/`   | CI placement                                               | Time budget |
| ----------- | ----------------------------------- | ---------------------------------------------------------- | ----------- |
| Unit        | ≥ 90 %                              | `pr-checks.yml` → `code-quality` job (existing)            | < 10 s      |
| Integration | ≥ 80 % of orders/ + 100 % of Tier 1 | `pr-checks.yml` → `integration-tests` job (existing)       | < 90 s      |
| e2e         | 1 happy path + 1 cancel             | New `pr-checks.yml` job, **gated to nightly** until stable | < 5 min     |
| Contract    | proto checksum + `buf breaking`     | `pr-checks.yml` → cheap step, every PR                     | < 5 s       |

Add a coverage-floor check (`jest --coverage --coverageThreshold`) for `apps/shop/src/orders/**` to prevent regression.

---

## Part E — Design patterns used in the refactor

### Architectural patterns

**CQRS lite** — The primary split driver. Command side (`createOrder`, `cancelOrder`) owns transactions, stock mutations, and event emission. Query side (`findOrdersWithFilters`, `getOrderById`, `getOrderPayment`) has zero side effects and a smaller dependency graph. Different cohesion → different services.

**Service Layer** — Each extracted service (`OrdersCommandService`, `OrdersQueryService`, `OrderProcessingService`, `OrderStockService`) represents a cohesive domain boundary. The controller, worker, and `CartService` call into the appropriate service; no single entry point accumulates 17 dependencies.

**Facade** — `orders.service.ts` can be kept as a thin re-export facade after the split so that `CartService`, `OrdersWorkerService`, the GraphQL resolver, and the controller require zero import changes. The facade delegates every call to the new service that owns it. Deletable once all callers are migrated.

---

### Structural patterns

**Anti-Corruption Layer (ACL)** — `pg-error-mapper.ts` translates PostgreSQL constraint violation codes (`23505` duplicate key, `57014` statement timeout, `55P03` lock timeout) into NestJS domain exceptions (`ConflictException`, `BadRequestException`). Infrastructure errors never cross the domain boundary as raw `QueryFailedError`.

**Unit of Work** — `executeOrderTransaction` and the transaction block inside `cancelOrder` already implement this: multiple repository operations under one `DataSource.transaction()` commit atomically or roll back together. The pattern stays after the refactor — it simply moves into the service that owns the operation.

**Repository Pattern** — Already present (`OrdersRepository`, `ProductsRepository`, `OrderItemsRepository`). Each new service depends on repositories, not raw `DataSource` where avoidable. The refactor respects this boundary.

---

### Behavioural patterns

**Template Method** — `processOrderMessage` has a fixed skeleton: idempotency check → mark PROCESSED → `authorizePayment` → mark PAID → emit event. The steps are ordered and invariant; only `authorizePayment` varies. Extracting `OrderProcessingService` makes the sequence explicit and each step independently testable.

**Observer** — Already used: `EventEmitter2` fires `ORDER_CANCELLED_EVENT` and `ORDER_PAID_EVENT`. After the refactor, `OrdersCommandService` emits cancel events and `OrderProcessingService` emits paid events. The pattern is preserved; ownership is clarified.

**Chain of Responsibility** — The retry → DLQ path in `OrdersWorkerService` is this pattern: attempt 1 → re-queue → attempt N → DLQ. Currently the chain logic lives in the worker. The refactor does not move it, but isolating `OrderProcessingService` makes each link of the chain independently testable.

---

### SOLID principles

| Principle | How it applies                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SRP**   | Root cause of the refactor: 17 constructor deps and 3 unrelated domains in one class. Each extracted service has one reason to change.                                                                    |
| **OCP**   | A new payment provider can be added to `OrderProcessingService` without touching `OrdersCommandService` or `OrdersQueryService`.                                                                          |
| **LSP**   | Not directly applicable — no inheritance hierarchy in this domain.                                                                                                                                        |
| **ISP**   | `CartService` only needs `createOrder`; `OrdersWorkerService` only needs `processOrderMessage`. Injecting the god service forces both to take 17 deps. The split exposes interfaces sized to each caller. |
| **DIP**   | Each new service depends on repository abstractions and NestJS-injected interfaces, not on sibling services. `OrdersCommandService` does not know `OrderProcessingService` exists.                        |

---

### What does NOT apply (explicitly excluded)

- **Strategy pattern** — `authorizePayment` does not switch between payment implementations at runtime. A strategy interface would be premature abstraction for the current single-provider setup.
- **Decorator pattern** — No cross-cutting behaviour injection is needed here; `ValidationPipe` and guards already handle the HTTP layer.
- **Abstract Factory** — Order creation is not polymorphic; there is only one order type.

---

## Part E — Design patterns used in the refactor

### Architectural patterns

**CQRS lite** — The primary split driver. Command side (`createOrder`, `cancelOrder`) owns transactions, stock mutations, and event emission. Query side (`findOrdersWithFilters`, `getOrderById`, `getOrderPayment`) has zero side effects and a smaller dependency graph. Different cohesion → different services.

**Service Layer** — Each extracted service (`OrdersCommandService`, `OrdersQueryService`, `OrderProcessingService`, `OrderStockService`) represents a cohesive domain boundary. The controller, worker, and `CartService` call into the appropriate service; no single entry point accumulates 17 dependencies.

**Facade** — `orders.service.ts` can be kept as a thin re-export facade after the split so that `CartService`, `OrdersWorkerService`, the GraphQL resolver, and the controller require zero import changes. The facade delegates every call to the new service that owns it. Deletable once all callers are migrated.

---

### Structural patterns

**Anti-Corruption Layer (ACL)** — `pg-error-mapper.ts` translates PostgreSQL constraint violation codes (`23505` duplicate key, `57014` statement timeout, `55P03` lock timeout) into NestJS domain exceptions (`ConflictException`, `BadRequestException`). Infrastructure errors never cross the domain boundary as raw `QueryFailedError`.

**Unit of Work** — `executeOrderTransaction` and the transaction block inside `cancelOrder` already implement this: multiple repository operations under one `DataSource.transaction()` commit atomically or roll back together. The pattern stays after the refactor — it simply moves into the service that owns the operation.

**Repository Pattern** — Already present (`OrdersRepository`, `ProductsRepository`, `OrderItemsRepository`). Each new service depends on repositories, not raw `DataSource` where avoidable. The refactor respects this boundary.

---

### Behavioural patterns

**Template Method** — `processOrderMessage` has a fixed skeleton: idempotency check → mark PROCESSED → `authorizePayment` → mark PAID → emit event. The steps are ordered and invariant; only `authorizePayment` varies. Extracting `OrderProcessingService` makes the sequence explicit and each step independently testable.

**Observer** — Already used: `EventEmitter2` fires `ORDER_CANCELLED_EVENT` and `ORDER_PAID_EVENT`. After the refactor, `OrdersCommandService` emits cancel events and `OrderProcessingService` emits paid events. The pattern is preserved; ownership is clarified.

**Chain of Responsibility** — The retry → DLQ path in `OrdersWorkerService` is this pattern: attempt 1 → re-queue → attempt N → DLQ. Currently the chain logic lives in the worker. The refactor does not move it, but isolating `OrderProcessingService` makes each link of the chain independently testable.

---

### SOLID principles

| Principle | How it applies                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SRP**   | Root cause of the refactor: 17 constructor deps and 3 unrelated domains in one class. Each extracted service has one reason to change.                                                                    |
| **OCP**   | A new payment provider can be added to `OrderProcessingService` without touching `OrdersCommandService` or `OrdersQueryService`.                                                                          |
| **LSP**   | Not directly applicable — no inheritance hierarchy in this domain.                                                                                                                                        |
| **ISP**   | `CartService` only needs `createOrder`; `OrdersWorkerService` only needs `processOrderMessage`. Injecting the god service forces both to take 17 deps. The split exposes interfaces sized to each caller. |
| **DIP**   | Each new service depends on repository abstractions and NestJS-injected interfaces, not on sibling services. `OrdersCommandService` does not know `OrderProcessingService` exists.                        |

---

### What does NOT apply (explicitly excluded)

- **Strategy pattern** — `authorizePayment` does not switch between payment implementations at runtime. A strategy interface would be premature abstraction for the current single-provider setup.
- **Decorator pattern** — No cross-cutting behaviour injection is needed here; `ValidationPipe` and guards already handle the HTTP layer.
- **Abstract Factory** — Order creation is not polymorphic; there is only one order type.

---

## Cross-references

- [test-infrastructure.md](../architecture/test-infrastructure.md) — existing tier conventions, Testcontainers bootstrap pattern, mocked-providers list
- [feature-order-creation-flow.md](../architecture/feature-order-creation-flow.md) — domain truth source for what needs covering
- [feature-rabbitmq-async.md](../architecture/feature-rabbitmq-async.md) — idempotency + DLQ semantics
- [feature-grpc-payments.md](../architecture/feature-grpc-payments.md) — payments-service contract
- [final-requirements.md](final-requirements.md) — TOR mapping, especially section 4 + 10.7

Orders Refactoring Phases

Phase 3 — PR 3: Extract helpers as injectable services
Low risk, no transaction or event-emission logic involved.

`orders/helpers/pg-error-mapper.ts` — `PgErrorMapperService` (`@Injectable()`), injects `OrdersRepository`, method `handleCreationError(error, userId, idempotencyKey?)`
`orders/helpers/order-publisher.ts` — `OrderPublisherService` (`@Injectable()`), injects `ConfigService` + `RabbitMQService`, method `publishOrderProcessing(order, correlationId?)`
`orders/helpers/index.ts` — barrel export for both
Both registered in `OrdersModule.providers`; injected into `OrdersService` (which drops its direct `RabbitMQService` dep as a result)

Phase 4 — PR 4: Extract OrderProcessingService
Biggest blast radius (transaction + idempotency + audit + RabbitMQ publish). Do last so the safety net is maximally established.

New file: orders/services/order-processing.service.ts
Moves: processOrderMessage, authorizePayment, checkIdempotency (idempotency is only called inside createOrder AND... check — actually checkIdempotency is createOrder-only so it might stay in command)
Deps: dataSource, paymentsGrpcService, rabbitmqService, auditLogService, configService
Update OrdersWorkerService to inject OrderProcessingService instead of OrdersService

Phase 5 — PR 5: Extract OrdersCommandService + delete/facade god service
New file: orders/services/orders-command.service.ts
Moves: createOrder, cancelOrder, checkIdempotency, executeOrderTransaction, validateUser, validateOrderItems, validateProductsExist
Convert orders.service.ts to a thin re-export facade OR delete it and update all 5 call sites (CartService, OrdersController, OrdersWorkerService, GraphQL resolver, OrdersModule)

Phase 6 — Unit tests (after split)
Once each service has a single responsibility, unit tests become obvious and stable. Write one \*.spec.ts per new service.
