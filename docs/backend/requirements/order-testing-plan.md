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

**Recommendation:** Jest + Supertest + per-suite `docker-compose-e2e.yml` that boots the full stack (shop, payments, postgres×2, rabbitmq, minio) once per file via `globalSetup`. Use the smoke-test composite action's logic to wait for `/ready`. One file: `apps/shop/test/e2e/order-lifecycle.e2e-spec.ts`.

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

## Cross-references

- [test-infrastructure.md](../architecture/test-infrastructure.md) — existing tier conventions, Testcontainers bootstrap pattern, mocked-providers list
- [feature-order-creation-flow.md](../architecture/feature-order-creation-flow.md) — domain truth source for what needs covering
- [feature-rabbitmq-async.md](../architecture/feature-rabbitmq-async.md) — idempotency + DLQ semantics
- [feature-grpc-payments.md](../architecture/feature-grpc-payments.md) — payments-service contract
- [final-requirements.md](final-requirements.md) — TOR mapping, especially section 4 + 10.7
