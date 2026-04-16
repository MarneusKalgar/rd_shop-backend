# Performance Plan

> Structured analysis of performance bottlenecks, optimization opportunities, and FinOps impact for the rd_shop monorepo (shop + payments services).

## Table of Contents

- [Evaluation Criteria](#evaluation-criteria)
- [Phase 0 — Observability & Profiling Foundation (Prerequisite)](#phase-0--observability--profiling-foundation-prerequisite)
- [Phase 0.5 — Performance Test Infrastructure (Prerequisite)](#phase-05--performance-test-infrastructure-prerequisite)
- [Group A — Database Interaction Improvements](#group-a--database-interaction-improvements)
- [Group B — Application (Non-DB) Improvements](#group-b--application-non-db-improvements)
- [Group C — Cloud Infrastructure & Runtime](#group-c--cloud-infrastructure--runtime)
- [Group D — Deferred / Post-AWS-Migration](#group-d--deferred--post-aws-migration)
- [Performance Testing Strategy](#performance-testing-strategy)
- [Environment Isolation for Performance Testing](#environment-isolation-for-performance-testing)
- [tmpfs Correctness Analysis](#tmpfs-correctness-analysis)
- [Simulating Production Constraints Locally](#simulating-production-constraints-locally)
- [FinOps Analysis](#finops-analysis)
- [Bottleneck Analysis Matrix](#bottleneck-analysis-matrix)
- [Recommended Hot Scenario for Baseline](#recommended-hot-scenario-for-baseline)
- [Implementation Priority](#implementation-priority)
- [Measurement Runbook](#measurement-runbook)
- [Cross-References](#cross-references)

---

## Evaluation Criteria

| Grade | Priority                        | Severity                              | Complexity                  |
| ----- | ------------------------------- | ------------------------------------- | --------------------------- |
| 1     | Nice-to-have, future iterations | Low — cosmetic or marginal gain       | Simple — hours, one file    |
| 2     | Should do, measurable impact    | Medium — noticeable under load        | Medium — days, cross-module |
| 3     | Must do, blocking or critical   | High — degrades UX or causes failures | Hard — weeks, infra changes |

---

## Phase 0 — Observability & Profiling Foundation (Prerequisite)

**Priority: 3 | Severity: 3 | Complexity: 2**

> **Rationale:** Without metrics, every optimization is guesswork. Phase 0 provides the measurement tools needed to take a baseline, prove bottlenecks exist, and show before/after impact. All other phases depend on this.

### 0.1 Slow Query Logging (TypeORM)

**Current state:** TypeORM logging is minimal. No slow query log, no query execution time tracking.

**Improvement:**

- Set `maxQueryExecutionTime: 1000` in TypeORM config to log queries >1 s
- Enable `logging: ['error']` in production, `['query', 'error']` in development
- In performance tests, temporarily set `maxQueryExecutionTime: 100` for a finer signal

### 0.2 Event Loop Lag Monitoring

**Current state:** No event loop lag monitoring. CPU-heavy operations (bcrypt) block the event loop invisibly.

**Improvement:**

- Add `perf_hooks.monitorEventLoopDelay()` — log when p99 delay exceeds 100 ms
- Expose as a `/metrics` or `/health` sub-field for Docker healthcheck awareness

### 0.3 Request Duration Metrics (p50/p95/p99)

**Current state:** `nestjs-pino` (`pino-http`) already logs `responseTime` in every request log line. However, there is no percentile aggregation — raw log lines only.

**Note:** Prometheus / `prom-client` is intentionally **not** part of the infrastructure (neither in current stack nor in the AWS migration plan). The approach below avoids introducing a Prometheus dependency.

**Improvement — three complementary layers:**

1. **k6 built-in percentiles (primary, zero infra)**
   k6 automatically calculates `http_req_duration` p50/p90/p95/p99 from response times. This is the primary source for all performance test scenarios. No server-side instrumentation required.

2. **`X-Response-Time` header via NestJS interceptor**
   A lightweight global interceptor that records `process.hrtime()` at the start and sets `X-Response-Time` header on the response. This makes per-request latency visible in browser DevTools and in k6 response headers.

3. **Post-AWS: CloudWatch Logs Insights**
   Since pino-http already emits `responseTime` in structured JSON, after AWS migration CloudWatch Logs Insights can query percentiles directly:
   ```
   stats percentile(responseTime, 50) as p50,
         percentile(responseTime, 95) as p95,
         percentile(responseTime, 99) as p99
   by req.url
   | filter req.url not like /health/
   ```

This stack (k6 + response header + CloudWatch) delivers full latency observability without Prometheus.

### 0.4 `pg_stat_statements` for DB Profiling

**Improvement:**

- Enable `pg_stat_statements` in the Postgres container (performance tests) for top-N query ranking
- On AWS RDS: enable Performance Insights (free tier = 7-day retention) — zero code change

---

## Phase 0.5 — Performance Test Infrastructure (Prerequisite)

**Priority: 3 | Severity: 3 | Complexity: 2**

> **Rationale:** Every optimization in Groups A–B requires **before/after measurement** to validate impact. Without test infrastructure (containers, seed data, profiling configuration), there is no baseline to compare against. This phase delivers the scaffolding that all subsequent items depend on.

### 0.5.1 Testcontainers Bootstrap for Performance Tests

Create a shared test bootstrap at `apps/shop/test/performance/helpers/bootstrap.ts` that:

- Starts `PostgreSqlContainer('postgres:16-alpine')` with `pg_stat_statements` enabled via `withCommand()`
- Runs TypeORM migrations against the container
- Creates a NestJS `TestingModule` with the same provider overrides as integration tests (RabbitMQ, gRPC, throttler mocked)
- Exposes the `DataSource`, `INestApplication`, and container reference for each test suite

This mirrors the existing integration test pattern (see `test/integration/orders/graphql-orders-pagination.integration-spec.ts`) but is extracted into a reusable helper.

### 0.5.2 Bulk Seed Generators

Create performance seed generators at `apps/shop/test/performance/seed/`:

- `generate-products.ts` — 10 K+ products with realistic titles/descriptions (for A1 search profiling)
- `generate-orders.ts` — 1 K+ orders with items (for A2 pagination, A3 lock contention)
- `generate-users.ts` — 100+ users with pre-hashed passwords (for B1 bcrypt stress)
- `index.ts` — orchestrator with `--scenario` flag for per-scenario seeding

Seed generators import entity classes from `apps/shop/src/` (same pattern as the existing `apps/shop/src/db/seed/`). They use `dataSource.initialize()` → bulk insert → `dataSource.destroy()` — invoked directly in `beforeAll()` against the Testcontainers-managed Postgres.

### 0.5.3 `pg_stat_statements` in Test Containers

Configure Testcontainers Postgres to enable `pg_stat_statements`:

```typescript
const container = await new PostgreSqlContainer('postgres:16-alpine')
  .withCommand([
    'postgres',
    '-c',
    'shared_preload_libraries=pg_stat_statements',
    '-c',
    'pg_stat_statements.track=all',
    '-c',
    'log_min_duration_statement=100',
  ])
  .start();
```

This enables per-query profiling (call counts, total time, mean time) inside test suites — used by A1, A2, A3, A4 to verify query count reductions.

### 0.5.4 Testcontainers Test Scenarios

Add per-item correctness tests at `apps/shop/test/performance/scenarios/`:

- `product-search.perf.ts` — ILIKE scan before/after GIN index (EXPLAIN ANALYZE, query count)
- `order-creation.perf.ts` — concurrent orders with lock contention (pg_stat_statements)
- `pagination.perf.ts` — cursor pagination query count (pg_stat_statements: 1 vs 2 queries)
- `order-cancel.perf.ts` — relation loading query count (pg_stat_statements)

Each scenario follows the pattern: Testcontainers bootstrap → scenario-specific seed → test → assert metrics → container auto-cleanup (via `ryuk`). These tests validate **optimization correctness** (query count dropped, EXPLAIN plan changed) but not runtime metrics under load.

### 0.5.5 `compose.perf.yml` — Baseline & Load Testing Environment

Create `apps/shop/compose.perf.yml` with isolated Postgres, RabbitMQ, and the shop service under resource constraints. This is the environment for:

- **Baseline capture** (Part 1 of homework) — p50/p95/p99 latency, throughput, CPU, memory, event loop lag, queue depth
- **Before/after comparison** (Part 4) — same metrics, pre- and post-optimization
- **Resource-constrained load testing** — `deploy.resources.limits` simulating t3.micro
- **Container-level scenarios** — B2 (graceful shutdown via `docker stop`), B3 (circuit breaker with mock gRPC)

The compose file uses the **same bulk seed generators** from 0.5.2 — the `seed-perf` service runs `test/performance/seed/index.ts`.

### 0.5.6 k6 Load Test Scripts

k6 runs **standalone** (no Grafana required). It outputs p50/p95/p99, throughput, and error rate directly to stdout. For persisted results: `k6 run --out json=results.json script.js`.

Add k6 scripts at `apps/shop/test/performance/k6/`:

- `product-search.js` — GET product search under load (baseline for A1)
- `order-flow.js` — full order creation lifecycle (baseline for A3)
- `auth-flow.js` — login/register stress (baseline for B1)

k6 hits the `shop-perf` container running inside `compose.perf.yml`. It runs from the host (not inside Docker) — no additional container needed.

---

## Group A — Database Interaction Improvements

### A1. Product Search — Missing Full-Text / Trigram Index

**Priority: 3 | Severity: 3 | Complexity: 2**

**Current state:** `ProductsRepository.findProducts()` uses `ILIKE '%term%'` on `title` and `description`. PostgreSQL cannot use B-tree indexes for leading-wildcard ILIKE → sequential scan.

**Impact:** With 10 K+ products, search latency grows linearly. Under concurrent storefront traffic this becomes the dominant DB query.

**Improvement:**

- Add a GIN trigram index (`pg_trgm` extension) on `title` and `description`
- Preserves ILIKE semantics with minimal code change

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IDX_products_title_trgm ON products USING GIN (title gin_trgm_ops);
CREATE INDEX IDX_products_description_trgm ON products USING GIN (description gin_trgm_ops);
```

**Trade-off:** GIN indexes increase write overhead (~10-15 % slower inserts/updates on indexed columns). Acceptable for a read-heavy product catalogue.

**Implementation:**

1. **Migration:** Create a TypeORM migration that enables `pg_trgm` and adds GIN indexes:

```typescript
// apps/shop/src/db/migrations/<timestamp>-AddProductTrgmIndexes.ts
export class AddProductTrgmIndexes implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await queryRunner.query(
      'CREATE INDEX IDX_products_title_trgm ON products USING GIN (title gin_trgm_ops)',
    );
    await queryRunner.query(
      'CREATE INDEX IDX_products_description_trgm ON products USING GIN (description gin_trgm_ops)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS IDX_products_description_trgm');
    await queryRunner.query('DROP INDEX IF EXISTS IDX_products_title_trgm');
  }
}
```

2. **Entity:** Add `@Index` decorators to `Product` entity (documentation, TypeORM won't auto-create GIN indexes but the decorators serve as in-code documentation):

```typescript
// apps/shop/src/products/product.entity.ts — add above @Entity()
@Index('IDX_products_title_trgm', ['title'])
@Index('IDX_products_description_trgm', ['description'])
```

3. **No query code changes.** The existing `ILIKE '%term%' ESCAPE '!'` in `ProductsRepository.findWithFilters()` is automatically accelerated by `gin_trgm_ops` — Postgres uses the GIN index for ILIKE/LIKE with `pg_trgm`.

**Testing (Testcontainers):**

```typescript
// apps/shop/test/performance/scenarios/product-search.perf.ts
// 1. Start PostgreSqlContainer, run migrations (WITHOUT GIN index migration)
// 2. Seed 10K products via bulk insert
// 3. EXPLAIN (ANALYZE, BUFFERS) on: SELECT * FROM products WHERE title ILIKE '%wireless%'
// 4. Assert: plan shows "Seq Scan"
// 5. Run the GIN index migration
// 6. Re-run same EXPLAIN
// 7. Assert: plan shows "Bitmap Index Scan" on IDX_products_title_trgm
// 8. Compare: execution time before vs after (expect ~80% reduction)
```

### A2. Cursor Pagination — Extra Query for Cursor Resolution

**Priority: 2 | Severity: 2 | Complexity: 1**

**Current state:** Both `ProductsRepository` and `OrdersQueryBuilderService` resolve the cursor with a separate `findOne({ where: { id: cursor } })` before building the paginated query.

**Impact:** Every paginated request costs 2 DB round-trips instead of 1. Adds 2-5 ms per page request.

**Improvement:**

- Encode cursor values (`createdAt` epoch ms + `id`) directly in a plain `id|epochMs` string
- Decode server-side without a DB lookup — no base64, no JSON

**Trade-off:** Cursor is semi-opaque (client can parse id + timestamp, but no sensitive data exposed). Zero encoding overhead. Standard keyset pagination pattern.

**Implementation:**

1. **Cursor encoding/decoding utility** (`apps/shop/src/common/utils/cursor.ts`):

```typescript
const CURSOR_SEPARATOR = '|';

interface CursorPayload {
  id: string;
  sortValue: number; // createdAt as epoch milliseconds (Date.getTime())
}

export function encodeCursor(payload: CursorPayload): string {
  // Plain string concat — no JSON, no base64, no allocations.
  // UUID contains only [0-9a-f-], epoch ms contains only [0-9].
  // Neither can contain '|', so the separator is unambiguous.
  // Result is 100% URL-safe: no encoding needed in query strings.
  return `${payload.id}${CURSOR_SEPARATOR}${payload.sortValue}`;
}

export function decodeCursor(cursor: string): CursorPayload {
  const separatorIndex = cursor.indexOf(CURSOR_SEPARATOR);
  if (separatorIndex === -1) {
    throw new BadRequestException('Invalid cursor format');
  }
  const id = cursor.slice(0, separatorIndex);
  const sortValue = Number(cursor.slice(separatorIndex + 1));
  if (!id || !Number.isFinite(sortValue)) {
    throw new BadRequestException('Invalid cursor format');
  }
  return { id, sortValue };
}
```

> **Why not `JSON.stringify`/`JSON.parse`?** JSON round-tripping creates intermediate objects and triggers GC pressure under high-throughput pagination — ~1-2 µs/call alone but cumulative at scale. The delimiter approach is a flat string operation — no object allocation, no parse step.

> **Why not base64url?** `sortValue` was previously an ISO string (contains `:`) which required base64 to stay URL-safe. With epoch ms (`Date.getTime()`) the value is pure digits — `[0-9]` — so the plain `id|epochMs` string is already 100% URL-safe. Zero encoding overhead, zero allocations.

2. **`ProductsRepository.findWithFilters()`** — replace the cursor block:

```typescript
// Before (2 queries):
if (cursor) {
  const cursorProduct = await this.repository.findOne({ where: { id: cursor } });
  // ... use cursorProduct.price / createdAt
}

// After (0 extra queries):
if (cursor) {
  const { id: cursorId, sortValue } = decodeCursor(cursor);
  const cursorDate = new Date(sortValue); // epoch ms → Date for TypeORM WHERE clause
  // Use cursorId and cursorDate directly — no DB lookup
}
```

3. **`OrdersService.findOrdersWithFilters()`** — same pattern: replace `findByCursor(cursor)` call with `decodeCursor(cursor)`.

4. **Response:** Encode cursor when building the response:

```typescript
const nextCursor = hasNextPage
  ? encodeCursor({ id: lastOrder.id, sortValue: lastOrder.createdAt.getTime() })
  : null;
```

**Testing (Testcontainers):**

```typescript
// 1. Seed 100 products, enable pg_stat_statements
// 2. Hit paginated endpoint with cursor
// 3. Assert: pg_stat_statements shows 1 query per page (not 2)
// 4. Assert: decoded cursor contains valid id + sortValue
```

### A3. Order Creation — Re-fetch After Insert Inside Transaction

**Priority: 2 | Severity: 2 | Complexity: 1**

**Current state:** `executeOrderTransaction()` creates order + items, then does a full `findOne({ relations: ['items', 'items.product', 'user'] })` inside the same transaction that holds pessimistic locks.

**Impact:** Adds a 4-table JOIN query under lock, extending lock duration by 1-3 ms.

**Improvement:**

- Build the response from in-memory entities (products already loaded from `findByIdsWithLock`, user passed in)
- Skip the re-fetch entirely

**Trade-off:** More code to manually assemble the response object. Eliminates one query under lock.

**Implementation:**

The current `executeOrderTransaction()` does this at step 8 (inside the transaction):

```typescript
// Current — re-fetches with 4-table JOIN under pessimistic lock:
const createdOrder = await this.ordersRepository.findByIdWithRelations(order.id, manager);
```

Replace with in-memory assembly — all data is already available:

```typescript
// After — build from in-memory entities (no extra query):
order.items = orderItemsData.map((itemData) => {
  const item = orderItemRepository.create(itemData);
  item.product = productMap.get(itemData.productId)!;
  return item;
});
order.user = user;
return order;
```

**Affected code:** `OrdersService.executeOrderTransaction()` (lines ~620-630 in `apps/shop/src/orders/orders.service.ts`). The `orderItemsRepository.createOrderItems()` call on line ~612 already returns the created items — use those instead of re-fetching.

**Testing (Testcontainers):**

```typescript
// 1. Seed products and user
// 2. Run createOrder() via NestJS Testing module
// 3. Assert: response contains correct items, products, user
// 4. Assert: pg_stat_statements shows no SELECT after INSERT within the transaction
// Can also measure lock duration via pg_stat_activity.wait_event_type
```

### A4. Database Connection Pool Configuration

**Priority: 2 | Severity: 2 | Complexity: 1**

**Current state:** TypeORM config does not explicitly set pool size (defaults to 10).

**Impact:** On t3.micro running shop + worker in one process, 10 connections may be insufficient during order bursts. Conversely, too many connections waste RAM on RDS (~5 MB per connection).

**Improvement:**

- Add `DB_POOL_SIZE` env var
- Set sensible per-environment defaults: dev = 5, staging = 10, production = 20
- Add `extra: { max: poolSize, idleTimeoutMillis: 30000 }` to TypeORM config

**Trade-off:** Needs tuning per environment. Over-provisioning wastes memory; under-provisioning causes queueing.

**Implementation:**

1. **Env var:** Add `DB_POOL_SIZE` to `apps/shop/.env.example`, `.env.development`, and environment schema (`apps/shop/src/core/environment/schema.ts`):

```typescript
// schema.ts — add to Joi schema
DB_POOL_SIZE: Joi.number().integer().min(1).max(100).default(10),
```

2. **TypeORM config** (`apps/shop/src/config/typeORM.ts`):

```typescript
// In getTypeOrmModuleOptions():
const poolSize = configService.get<number>('DB_POOL_SIZE') ?? 10;

return {
  ...baseConfig,
  extra: {
    max: poolSize,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
  entities: [...],
};
```

3. **Defaults:** dev = 5, perf tests = 10, production = 15-20. On t3.micro with 1 GB RAM, each PG connection uses ~5 MB server-side. At 20 connections = 100 MB just for connection memory.

**Testing (Testcontainers):**

```typescript
// 1. Start PostgreSqlContainer
// 2. Configure TypeORM with max: 5
// 3. Fire 20 concurrent queries (Promise.all)
// 4. Assert: later queries wait (measurable via increased latency)
// 5. Query pg_stat_activity: assert max active connections = 5
// 6. Repeat with max: 20 — assert no queueing
```

---

## Group B — Application (Non-DB) Improvements

### B1. Bcrypt Event Loop Blocking

**Priority: 3 | Severity: 3 | Complexity: 1**

**Current state:** Bcrypt hashing blocks the event loop for ~100 ms per operation (10 rounds). On single-core production instance, concurrent auth requests queue up.

**Impact:** Directly measurable as p99 latency spike on login/register endpoints. On t3.micro (1 vCPU), a single hash blocks all other I/O.

**Improvement:**

- Switch from native `bcrypt` to `bcryptjs` — pure JS, runs asynchronously with cooperative yielding, avoids native addon complexity
- Consider adjusting rounds if 10 is too expensive on target hardware (8 rounds ≈ 25 ms)
- Add a dedicated perf/stress test for `POST /api/v1/auth/signin` with ≥50 concurrent users to quantify event loop lag before/after

**Trade-off:** `bcryptjs` is slightly slower per-hash than native `bcrypt`, but non-blocking. Combined with rate limiting already in place, this is acceptable.

**Implementation:**

1. **Switch import** in auth service (find all files importing `bcrypt` — likely `apps/shop/src/auth/` or `apps/shop/src/users/`):

```typescript
// Before:
import * as bcrypt from 'bcrypt';

// After:
import * as bcrypt from 'bcryptjs';
```

The API is identical (`bcrypt.hash()`, `bcrypt.compare()`) — no other code changes needed.

2. **Verify rounds:** Check the current salt rounds (likely `10`). On t3.micro at 10 rounds, a single `bcryptjs.hash()` takes ~100 ms but yields to the event loop. On 8 rounds, ~25 ms. Consider making rounds configurable via environment variable.

3. **Validate:** Run existing `auth` unit and integration tests to confirm password hashing/verification still works.

**Testing (Testcontainers + autocannon):**

```typescript
// 1. Start PostgreSqlContainer + NestJS app in-process
// 2. Seed 1 user with known password
// 3. Enable perf_hooks.monitorEventLoopDelay()
// 4. Run autocannon: 50 concurrent POST /api/v1/auth/signin for 30s
// 5. Measure: p99 event loop delay (before=~100ms, after=~5ms)
// 6. Measure: p95 response time (should improve proportionally)
```

### B2. Graceful Shutdown — Commented Out

**Priority: 2 | Severity: 2 | Complexity: 2**

**Current state:** `setupGracefulShutdown({ app })` is commented out in `main.ts` due to a GraphQL module conflict.

**Impact:** In-flight requests are killed during deploy. DB connections may leak. RabbitMQ consumer may lose unacked messages.

**Improvement:**

- Resolve the GraphQL module conflict and re-enable
- Or implement manual drain: stop accepting → wait for in-flight → close DB pool → close AMQP → exit

**Trade-off:** Graceful shutdown adds 5-30 s to deployment cycle. Essential for zero-downtime deploys on ECS.

**Implementation:**

The current `main.ts` has `setupGracefulShutdown({ app })` commented out (line 31) with a TODO referencing a GraphQL module conflict. Two approaches:

1. **Diagnose the GraphQL conflict:** The `@tygra/nestjs-graceful-shutdown` library may conflict with the Apollo GraphQL module's shutdown hooks. Try enabling it and checking the specific error. If it's a hook ordering issue, register the shutdown hook manually after Apollo.

2. **Manual drain (fallback):** If the library conflict is non-trivial, implement a manual shutdown sequence:

```typescript
// apps/shop/src/main.ts
app.enableShutdownHooks();

process.on('SIGTERM', async () => {
  logger.log('SIGTERM received, starting graceful shutdown...');
  // 1. Stop accepting new HTTP connections
  // 2. NestJS shutdown hooks run (closes DB, RabbitMQ consumer)
  await app.close();
  process.exit(0);
});
```

**Testing (Compose):**

```bash
# 1. Start compose.perf.yml with shop-perf running
# 2. Send a slow request (e.g., order creation) via curl
# 3. Immediately: docker stop --time=30 <shop-perf-container>
# 4. Assert: the in-flight request completes successfully (HTTP 2xx)
# 5. Assert: container exit code is 0 (not 137/SIGKILL)
# 6. Assert: no "connection reset" errors in the curl output
```

Note: This test **cannot** use Testcontainers because it requires sending SIGTERM to a running container process. The in-process NestJS app in a Jest test doesn't have a container to signal.

### B3. gRPC Timeout — Default Already Set, Circuit Breaker Missing

**Priority: 2 | Severity: 2 | Complexity: 2**

**Current state:** `PaymentsGrpcService` already applies a timeout via rxjs `pipe(timeout(timeoutMs))` with a default of 5000 ms. However, there is no circuit breaker: repeated failures still attempt the gRPC call.

**Impact:** If the payments service is down, every order-worker message retries the gRPC call, saturating connection pool and backing up the queue.

**Improvement:**

- Implement circuit breaker pattern (e.g. `opossum` library): open after N consecutive failures, half-open after cooldown
- Log circuit state transitions for observability

**Trade-off:** Adds a dependency and complexity. Essential for production resilience.

**Implementation:**

1. **Install `opossum`** (circuit breaker library for Node.js). Add to `package.json`.

2. **Wrap gRPC calls** in `PaymentsGrpcService`:

```typescript
// apps/shop/src/payments/payments-grpc.service.ts
import CircuitBreaker from 'opossum';

// In constructor or onModuleInit():
this.authorizeBreaker = new CircuitBreaker(
  (request: AuthorizeRequest) =>
    firstValueFrom(this.paymentsProtoService.authorize(request).pipe(timeout(timeoutMs))),
  {
    timeout: 5000, // Same as existing timeout
    errorThresholdPercentage: 50, // Open after 50% failures
    resetTimeout: 10000, // Half-open after 10s
    volumeThreshold: 5, // Minimum calls before tripping
  },
);

this.authorizeBreaker.on('open', () =>
  this.logger.warn('Circuit breaker OPENED for payments.authorize'),
);
this.authorizeBreaker.on('halfOpen', () =>
  this.logger.log('Circuit breaker HALF-OPEN for payments.authorize'),
);
this.authorizeBreaker.on('close', () =>
  this.logger.log('Circuit breaker CLOSED for payments.authorize'),
);
```

3. **Use breaker** instead of direct call:

```typescript
// Before:
return await firstValueFrom(this.paymentsProtoService.authorize(request).pipe(timeout(timeoutMs)));

// After:
return await this.authorizeBreaker.fire(request);
```

4. **Error mapping:** When the circuit is open, `opossum` throws an `Error` with message `"Breaker is open"`. Map this to `ServiceUnavailableException` in the existing error handler.

**Testing (Compose):**

> **Note: Unit tests for B3 are intentionally skipped.** The `grpc-stub-server` + k6 perf scenario provides meaningful end-to-end validation of breaker behaviour (queue drain fast, "Circuit breaker OPENED" in logs). Isolated unit tests for opossum state transitions add little coverage value given the library is well-tested upstream.

```bash
# 1. Start compose.perf.yml with grpc-stub-perf (gRPC server that never responds)
# 2. Run perf:b3:before → observe queue backing up, timeout logs
# 3. Rebuild app with breaker, run perf:after:orders:b3
# 4. Assert: "Circuit breaker OPENED" in shop logs after 5 timeouts
# 5. Assert: subsequent messages fail fast (no 5s wait), queue drains
# 6. Assert: circuit transitions to HALF-OPEN after 10s, then CLOSED when stub is stopped
```

### B4. Order Cancel — Loads All Relations Unnecessarily

**Priority: 1 | Severity: 1 | Complexity: 1**

**Current state:** `cancelOrder()` loads `relations: ['items', 'items.product']` to check status and restore stock.

**Impact:** Loads product data even when the cancel is rejected (wrong status). Minor — order cancel is a rare operation.

**Improvement:**

- Load order only (status check), then load items + products only if cancellation proceeds

**Trade-off:** Extra code path. Low priority given rarity of the operation.

**Implementation:**

Currently `cancelOrder()` loads everything upfront:

```typescript
// Current — loads items + products even when cancel will be rejected:
const order = await orderRepo.findOne({
  relations: ['items', 'items.product'],
  where: { id: orderId },
});
this.assertOrderOwnership(order, userId);  // may throw 404
if (order.status === OrderStatus.CANCELLED) throw new ConflictException(...);  // may throw 409
```

Split into two phases:

```typescript
// Phase 1: status check only (no JOINs)
const order = await orderRepo.findOne({ where: { id: orderId } });
this.assertOrderOwnership(order, userId);
if (order.status === OrderStatus.CANCELLED) throw new ConflictException(...);
if (order.status === OrderStatus.CREATED) throw new BadRequestException(...);

// Phase 2: only if cancellation proceeds — load items + products for stock restore
const orderWithItems = await orderRepo.findOne({
  relations: ['items', 'items.product'],
  where: { id: orderId },
});
```

**Testing (Testcontainers):**

```typescript
// 1. Seed an order in CANCELLED status
// 2. Call cancelOrder() → assert ConflictException
// 3. Check pg_stat_statements → assert only 1 SELECT (no JOIN to items/products)
// 4. Seed an order in PENDING status
// 5. Call cancelOrder() → assert success
// 6. Check pg_stat_statements → assert 2 SELECTs (status check + items load)
```

### B5. Replace bcrypt with HMAC-SHA256 for Opaque Tokens

**Priority: 2 | Severity: 2 | Complexity: 1**

**Current state:** `TokenService.createOpaqueToken()` hashes the raw secret with `bcrypt.hash(rawSecret, saltRounds)`. All three validate methods (`validateRefreshToken`, `validateVerificationToken`, `validatePasswordResetToken`) call `bcrypt.compare(rawSecret, storedToken.tokenHash)`.

Every token operation costs a full bcrypt round-trip:

| Operation                   | bcrypt calls                              | Approx. cost (10 rounds, bcryptjs) |
| --------------------------- | ----------------------------------------- | ---------------------------------- |
| `POST /auth/signin`         | 1 (password) + 1 (issue refresh token)    | ~200 ms                            |
| `POST /auth/refresh`        | 1 (compare refresh token) + 1 (issue new) | ~200 ms                            |
| `POST /auth/signout`        | 1 (compare refresh token)                 | ~100 ms                            |
| `POST /auth/verify-email`   | 1 (compare verification token)            | ~100 ms                            |
| `POST /auth/reset-password` | 1 (compare password reset token)          | ~100 ms                            |

Under concurrent load this stacks: 30 VUs × 2 bcrypt ops on `/auth/refresh` saturates the event loop even with `bcryptjs`.

**Why bcrypt is wrong here:** bcrypt's cost exists to resist offline brute-force of _low-entropy_ secrets (passwords, ~40 bits). `crypto.randomBytes(64)` produces 512 bits of entropy — brute-forcing that is infeasible regardless of hash speed. The computation cost provides zero security benefit and 100 % latency cost.

**Improvement:** Replace bcrypt with HMAC-SHA256 keyed on a server secret for all opaque token hashing:

- `createOpaqueToken` becomes **synchronous** (no thread pool, no async, no event-loop pressure)
- Each hash/compare is ~1 µs instead of ~100 ms
- `bcryptjs` import can be removed from `token.service.ts` entirely
- `saltRounds` config in `TokenService` constructor becomes unused and can be removed

**What stays on bcrypt:** Password hashing in `AuthService` and `UsersService` — user-chosen passwords are low-entropy and bcrypt (or bcryptjs) is correct there. Those files are **not touched** by B5.

**Trade-off / migration concern:** The `tokenHash` column format changes. All existing refresh tokens, verification tokens, and password-reset tokens stored in DB have bcrypt-format hashes. After the deploy they will all fail validation (HMAC hash ≠ bcrypt hash). This is acceptable — users will need to sign in again. A `revokeAllUserTokens` migration is not necessary; tokens will simply fail the HMAC compare and the user gets a 401 → re-authenticates. Document in the release notes.

**New env var required:** `TOKEN_HMAC_SECRET` — a 32-byte (256-bit) hex or base64 string. Must be stable across instances (shared secret for HMAC). Must not be the same as `JWT_SECRET`.

**Implementation:**

1. **Add `TOKEN_HMAC_SECRET` env var** to `.env.example`, `.env.development`, and `environment/schema.ts`:

```typescript
// schema.ts — add to EnvironmentVariables class (class-validator, not Joi)
@IsString()
@MinLength(32)
TOKEN_HMAC_SECRET: string;
```

2. **Update `TokenService` constructor** — read `TOKEN_HMAC_SECRET`, drop `saltRounds`:

```typescript
constructor(...) {
  this.hmacSecret = this.configService.getOrThrow<string>('TOKEN_HMAC_SECRET');
  // this.saltRounds = ... — remove
  this.setTtl();
  ...
}
private readonly hmacSecret: string;
```

3. **Extract `createOpaqueToken` to `apps/shop/src/auth/utils/index.ts`** — it is purely stateless after this change (no `this` dependencies). Takes `hmacSecret` as a parameter:

```typescript
// apps/shop/src/auth/utils/index.ts
export function createOpaqueToken(
  hmacSecret: string,
  bytes = 64,
): { rawSecret: string; tokenHash: string } {
  const rawSecret = crypto.randomBytes(bytes).toString('hex');
  const tokenHash = crypto.createHmac('sha256', hmacSecret).update(rawSecret).digest('hex');
  return { rawSecret, tokenHash };
}
```

> **Why sync is fine:** `crypto.randomBytes(N)` synchronous form for small N (64 bytes) completes in <1 µs — it reads from the OS entropy pool, which is never blocking in practice for small requests. `createHmac().update().digest()` is pure in-process CPU at ~1 µs. Total: ~2 µs per call. This is three orders of magnitude below what causes measurable event loop lag (>1 ms). Promisifying would add a microtask queue tick with more overhead than the operation itself.

4. **Replace all three `bcrypt.compare` calls** with constant-time HMAC comparison:

```typescript
// Before:
const isValid = await bcrypt.compare(rawSecret, storedToken.tokenHash);

// After:
const candidateHash = crypto.createHmac('sha256', this.hmacSecret).update(rawSecret).digest('hex');
const isValid = crypto.timingSafeEqual(
  Buffer.from(candidateHash, 'hex'),
  Buffer.from(storedToken.tokenHash, 'hex'),
);
```

> **Why `timingSafeEqual`?** Although timing-safe comparison matters less when the secret is 512 bits (brute force is impractical), it is cheap to add and is defensive in depth — correct security posture regardless of entropy level. Node.js `crypto.timingSafeEqual` is a native constant-time compare.

5. **Remove `bcryptjs` import** from `token.service.ts` and `saltRounds` field.

6. **Call-site changes:** `createOpaqueToken` is now sync — callers `await createOpaqueToken(...)` must become `createOpaqueToken(...)`. Update `issuePasswordResetToken`, `issueVerificationToken`, and `createRefreshToken`.

**Files changed:**

| File                                       | Change                                     |
| ------------------------------------------ | ------------------------------------------ |
| `apps/shop/src/auth/token.service.ts`      | HMAC replace, drop bcrypt, drop saltRounds |
| `apps/shop/src/core/environment/schema.ts` | Add `TOKEN_HMAC_SECRET`                    |
| `apps/shop/.env.example`                   | Add `TOKEN_HMAC_SECRET=`                   |
| `apps/shop/.env.development`               | Add `TOKEN_HMAC_SECRET=<dev-value>`        |

**Files unchanged (bcrypt stays):**

| File                                           | Why                                    |
| ---------------------------------------------- | -------------------------------------- |
| `apps/shop/src/auth/auth.service.ts`           | Password hashing — bcrypt correct here |
| `apps/shop/src/users/users.service.ts`         | Password change — bcrypt correct here  |
| `apps/shop/src/db/perf-seed/generate-users.ts` | Seed passwords — bcrypt correct here   |

**Testing (Testcontainers + k6):**

```typescript
// apps/shop/test/performance/scenarios/db-profiling/token-hmac.perf.ts
//
// 1. Bootstrap full NestJS app (Testcontainers Postgres)
// 2. Seed 1 user, sign in → capture refresh token cookie
// 3. record start = Date.now()
//    Call POST /auth/refresh 1000 times sequentially
//    record elapsed = Date.now() - start
// 4. Assert: mean refresh latency < 20ms (vs ~100ms with bcrypt)
// 5. Assert: token validate returns the correct user (HMAC produces valid hash)
// 6. Tamper test: modify 1 char in rawSecret → assert validateRefreshToken throws 401
```

```javascript
// apps/shop/test/performance/scenarios/k6/auth-flow-after-b5.js
//
// Same VU config as auth-flow.js (30 VUs, "30s")
// Threshold tightened from p(95)<25000 to p(95)<200
// (2 HMAC ops per refresh ≈ microseconds vs 2 bcrypt ops ≈ 200ms)
//
// Baseline (auth-flow.js):  p(95) ≈ 13 000 ms  (bcrypt serialises through thread pool)
// After B5:                  p(95) < 200 ms
export const options = {
  thresholds: {
    'http_req_duration{name:auth_refresh}': ['p(95)<200'],
  },
};
```

**Also create `auth-flow-after-b5.js`** as a k6 after-scenario (mirrors `signin-stress-after-b1.js` pattern). Add `perf:after:auth:b5` to `apps/shop/package.json`.

---

## Group C — Cloud Infrastructure & Runtime

### C1. Single-Instance Bottleneck — Shop + Worker in Same Process

**Priority: 2 | Severity: 2 | Complexity: 3**

**Current state:** HTTP REST, GraphQL, and RabbitMQ consumer share one event loop and one DB connection pool.

**Impact:** Under burst, HTTP and worker contend for event loop time and DB connections.

**Improvement:**

- Separate worker into its own entrypoint (same image, `node dist/apps/shop/worker-main.js`)
- On ECS, run as a separate task with its own resource allocation

**Trade-off:** Doubles compute resources. On t3.micro (1 GB RAM), two Node.js processes (~150 MB each) leave little headroom. Viable after migration to Fargate or larger instance.

### C2. RabbitMQ Prefetch Count Tuning

**Priority: 1 | Severity: 1 | Complexity: 1**

**Current state:** `RABBITMQ_PREFETCH_COUNT` is configurable via env var.

**Impact:** Default prefetch affects queue drain rate and memory usage.

**Improvement:**

- Set prefetch = 5-10 for production
- Monitor queue depth and consumer utilisation to tune further

**Trade-off:** Higher prefetch = better throughput but more memory and risk of message loss on crash.

### C3. Docker Image Size — Already Well-Optimized

**Priority: 1 | Severity: 1 | Complexity: 1**

**Current state:** Multi-stage build with distroless variant. Already good.

**Improvement:** Marginal — verify `.dockerignore` excludes test/docs. Low priority.

---

## Group D — Deferred / Post-AWS-Migration

Items that depend on AWS infrastructure or are deprioritized for now.

### D1. Application-Level Caching (Redis / ElastiCache)

**Priority: 1 | Severity: 2 | Complexity: 3**

**Deferred until:** AWS migration (ElastiCache is part of the free tier for 12 months — 750 hrs of cache.t3.micro).

**Current state:** No caching. Every request hits DB.

**Analysis — highest-impact cache targets (ranked):**

| Rank  | Endpoint                               | Why                                                                                                                                                                                                                  | Cache key pattern                                                         | TTL                                      |
| ----- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| 1 ★★★ | `GET /api/v1/products` (catalog list)  | Most-read, least-written path. Every anonymous visitor hits it. k6 A1/A2 at 214 iter/s shows near-identical repeated queries. `ProductsService.findAll` runs `findWithFilters` + `getRatingInfoBatch` on every call. | `products:list:{stableHash(FindProductsQueryDto)}`                        | 30–60 s                                  |
| 2 ★★  | `getRatingInfoBatch` / `getRatingInfo` | `AVG` + `COUNT GROUP BY` per product; runs on every list and detail request. Ratings rarely change. Can be cached independently of the full list.                                                                    | `product:ratings:{productId}` or `product:ratings:batch:{sortedIds-hash}` | 60 s                                     |
| 3 ★   | `GET /api/v1/products/:id`             | Fires 3 parallel queries (main image URL, file records, rating). Lower traffic than listing but easy win.                                                                                                            | `product:detail:{id}`                                                     | 60 s; invalidate on product/image update |

**What NOT to cache:**

- `findOrdersWithFilters` — user-scoped, changes on every order event, near-zero cache hit rate
- `findOne` inside order mutations — single PK lookup, already fast
- Auth/JWT validation — stateless by design

**Planned approach:**

1. **Pre-AWS (in-memory):** NestJS `@nestjs/cache-manager` with default in-memory store — zero AWS dependency.

   ```typescript
   // ProductsService.findAll — cache-aside pattern
   async findAll(filters: FindProductsQueryDto): Promise<ProductsListResponseDto> {
     const cacheKey = `products:list:${stableHash(filters)}`;
     const cached = await this.cacheManager.get<ProductsListResponseDto>(cacheKey);
     if (cached) return cached;
     // ... existing logic ...
     await this.cacheManager.set(cacheKey, result, 30_000); // 30 s TTL
     return result;
   }

   // Invalidation on any product write:
   async create(dto): Promise<...> {
     const result = await ...;
     await this.cacheManager.reset(); // or targeted key-pattern delete
     return result;
   }
   ```

2. **Post-AWS:** Swap in-memory store for `cache-manager-ioredis` pointing at ElastiCache — no service layer changes, only module config update. Enables shared cache across multiple `shop` replicas and stores throttler + session data in the same Redis cluster.

### D2. Throttler Storage — Redis-Backed (Post Multi-Instance)

**Priority: 1 | Severity: 1 | Complexity: 1**

**Deferred until:** Multi-instance deployment on ECS + ElastiCache available. Single-instance deployment makes in-memory throttler sufficient.

### D3. CloudFront for API Response Caching

**Priority: 1 | Severity: 1 | Complexity: 2**

**Deferred until:** AWS migration. CloudFront cache behaviours for public product endpoints offset read traffic from the shop service. Free tier covers 1 TB/month.

### D4. Audit Log — CloudWatch Migration

**Priority: 1 | Severity: 1 | Complexity: 2**

**Current state:** `AuditLog` entity has zero indexes, is append-only, and grows unboundedly. However:

- Writes are already fire-and-forget (`void this.auditLogService.log(...)` — not awaited in the request path)
- The AWS migration plan includes CloudWatch integration (Phase 5)

**Decision:** Adding DB indexes to a table we plan to replace with CloudWatch Logs is wasteful. Instead:

- Keep the current fire-and-forget writes as-is (no performance impact on requests)
- After AWS migration, pipe audit events to CloudWatch Logs (structured JSON) instead of Postgres
- CloudWatch Logs Insights provides ad-hoc querying without DB index maintenance
- If audit log DB queries are needed before migration (admin dashboard), add indexes on-demand

**Note:** The previous plan items "1.2 Audit Log Indexes" and "2.2 Sync Audit Log Writes" are both resolved — 1.2 deferred to CloudWatch, 2.2 was already fire-and-forget in the codebase.

### D5. GraphQL-Specific Optimizations

**Priority: 1 | Severity: 1 | Complexity: 2**

**Context:** GraphQL was added for educational purposes. REST is the primary, production-critical API.

**Analysis of GraphQL-only issues:**

- **N+1 gRPC for payment status:** There is no `@ResolveField` for payment status in the GraphQL resolvers. The payment status is fetched via a **separate REST endpoint** (`GET :orderId/payment`), which does a **single** gRPC call per order (1:1, not N+1). GraphQL does not currently resolve payment status at all. **This issue does not exist.**
- **DataLoader patterns:** Already implemented for `User`, `OrderItem`, `Product`, `Order` — covering the N+1 paths that do exist. No action needed.

**REST payment status:** The `GET /api/v1/orders/:orderId/payment` endpoint calls `PaymentsGrpcService.getPaymentStatus()` for a single order. This is a 1:1 call — no N+1 problem. Performance depends on gRPC latency (covered by B3 circuit breaker).

**Decision:** No GraphQL-specific performance work needed. REST remains the focus.

---

## Performance Testing Strategy

### Existing Seed Infrastructure

The project already has functional seed tooling at `apps/shop/src/db/seed/`:

| File       | Contents                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `data.ts`  | Fixed seed arrays: `seedUsers` (5 users), `seedProducts` (~10 products), `seedOrders` (with items), `seedReviews` |
| `index.ts` | Entry point: `dataSource.initialize()` → upsert users/products/orders/reviews → `dataSource.destroy()`            |
| `types.ts` | TypeScript interfaces for seed data shapes                                                                        |

Entry: `npm run db:seed:dev` → `ts-node -r tsconfig-paths/register ./src/db/seed/index.ts`

The dev seed is designed for functional correctness (small, deterministic data). Performance testing needs **large-volume seed generators** that extend this pattern.

### Tests Requiring Additional Data Seeding

Several bottlenecks can only be demonstrated with realistic data volumes. These require dedicated performance tests (separate from the existing `*.integration-spec.ts` suite).

| Scenario                          | Required Data                                     | Test Type        | DB-Dependent?                 |
| --------------------------------- | ------------------------------------------------- | ---------------- | ----------------------------- |
| A1 — Product search ILIKE scan    | 10 K+ products with realistic titles/descriptions | Performance test | Yes — Postgres with `pg_trgm` |
| A2 — Cursor pagination overhead   | 1 K+ products or orders                           | Performance test | Yes                           |
| A3 — Order creation lock duration | 50+ concurrent order creations on same products   | Stress test      | Yes                           |
| A4 — Connection pool exhaustion   | 50+ concurrent requests                           | Stress test      | Yes                           |
| B1 — Bcrypt event loop blocking   | 50+ concurrent auth requests                      | Stress test      | Yes (user lookup)             |
| C2 — RabbitMQ prefetch tuning     | 1 K+ queued messages                              | Performance test | Yes + RabbitMQ                |

### Proposed Performance Test Layout

Performance test infrastructure lives at `apps/shop/test/performance/` — colocated with the existing test tiers (`test/integration/`, `test/e2e/`).

```
apps/shop/
  compose.perf.yml              # Isolated perf environment (Postgres, RabbitMQ, shop, resource limits)
  test/
    performance/
      jest-perf.json            # Jest config for perf tests (extended timeout, sequential)
      helpers/
        bootstrap.ts            # Testcontainers + NestJS bootstrap (shared across scenarios)
      seed/
        generate-products.ts    # Generates 10K+ products (extends apps/shop/src/db/seed/ pattern)
        generate-orders.ts      # Generates 1K+ orders with items
        generate-users.ts       # Generates 100+ users with hashed passwords
        index.ts                # Orchestrator: initialize → bulk insert → destroy
      scenarios/
        product-search.perf.ts  # ILIKE scan before/after GIN index (Testcontainers)
        order-creation.perf.ts  # Concurrent orders with lock contention (Testcontainers)
        pagination.perf.ts      # Cursor pagination query count (Testcontainers)
        order-cancel.perf.ts    # Relation loading query count (Testcontainers)
      k6/
        product-search.js       # k6 load test → compose.perf shop-perf container
        order-flow.js           # Full order lifecycle
        auth-flow.js            # Login/register stress
```

Key design decisions:

- **Seed generators** are shared — used by both Testcontainers (`beforeAll()`) and compose (`seed-perf` service). Same data set, same code, two runners.
- **`helpers/bootstrap.ts`** encapsulates Testcontainers + NestJS boilerplate — each `*.perf.ts` file calls `bootstrapPerfTest()` in `beforeAll()` and gets back `{ app, dataSource, container }`
- **k6 scripts** are standalone JS files that run from the host against `compose.perf.yml`. k6 outputs p50/p95/p99, throughput, error rate to stdout (no Grafana required). Export to JSON: `k6 run --out json=results.json script.js`

---

## Environment Isolation for Performance Testing

> **Problem:** Performance tests require large seed data (10 K+ products, 1 K+ orders) and stress conditions that would corrupt or bloat the development database.

### Solution Comparison

| Solution                                       | Syntheticity                      | Local Reproducibility | Production-Only? | P/S/C |
| ---------------------------------------------- | --------------------------------- | --------------------- | ---------------- | ----- |
| **A. Separate Docker Compose**                 | Real — same Postgres engine       | Yes                   | No               | 2/2/1 |
| **B. Testcontainers (from integration tests)** | Real — same engine, fresh per run | Yes                   | No               | 3/3/2 |
| **C. Separate Postgres schema**                | Partially real — shared instance  | Yes                   | No               | 1/1/1 |
| **D. Dedicated cloud environment**             | Real — cloud-like                 | No (requires AWS)     | Yes              | 3/3/3 |

### Recommended: Compose + Testcontainers (Complementary)

Two tools, two purposes. Both are part of Phase 0.5.

#### `compose.perf.yml` — Baseline & Runtime Metrics

The compose environment is required for **all metrics in the homework before/after table**:

| Metric                      | How to Measure                                        | Why Compose                                                            |
| --------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| p50/p95/p99 latency         | k6 `http_req_duration`                                | k6 hits isolated container; no Jest overhead in measurements           |
| Throughput (req/s)          | k6 `http_reqs` rate                                   | External load generator → isolated app                                 |
| CPU %                       | `docker stats` per container                          | Isolated per-service signal; no Jest process mixed in                  |
| Memory (RSS)                | `docker stats` per container                          | Isolated container RSS; no V8 test heap (~200 MB)                      |
| Event loop lag              | `perf_hooks.monitorEventLoopDelay()` inside shop-perf | App owns the event loop exclusively                                    |
| Error rate                  | k6 `http_req_failed`                                  | Under resource limits, reveals OOM/timeout errors invisible in-process |
| Queue depth / drain         | RabbitMQ Management UI (`:15673`)                     | Natural producer→consumer flow                                         |
| Cost proxy (CPU/mem limits) | `deploy.resources.limits`                             | Only way to simulate t3.micro constraints                              |

Compose is also required for:

- **B2 — Graceful shutdown** — needs `docker stop` to send SIGTERM
- **B3 — gRPC circuit breaker** — needs controllable mock gRPC service
- **Resource-constrained simulation** — `deploy.resources.limits` (see [Simulating Production Constraints](#simulating-production-constraints-locally))

#### Testcontainers — Per-Item Optimization Correctness

Testcontainers validates that an optimization **actually worked** at the DB/query level:

| Scenario               | What Testcontainers Validates                                      |
| ---------------------- | ------------------------------------------------------------------ |
| A1 — Product search    | EXPLAIN plan changed from Seq Scan → Bitmap Index Scan             |
| A2 — Cursor pagination | pg_stat_statements shows 1 query per page (not 2)                  |
| A3 — Order creation    | No SELECT after INSERT within the transaction (pg_stat_statements) |
| A4 — Connection pool   | pg_stat_activity shows max N active connections under flood        |
| B4 — Order cancel      | Only 1 SELECT when cancel is rejected (no JOIN to items/products)  |

Testcontainers advantages: zero config, fresh state per suite, CI-native, auto-cleanup via `ryuk`.

**Bulk seeding with Testcontainers:**

Seed generators (`apps/shop/test/performance/seed/`) are invoked directly in `beforeAll()` against the Testcontainers-managed Postgres DataSource:

```typescript
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withCommand([...pg_stat_statements config...])
    .start();
  dataSource = new DataSource({ ...connectionOptionsFromContainer... });
  await dataSource.initialize();
  await dataSource.runMigrations();

  // Bulk seed — same generators as compose seed-perf, called in-process
  await seedProducts(dataSource, 10_000);
  await seedUsers(dataSource, 100);

  // Boot NestJS with the same DataSource
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource).useValue(dataSource)
    ...
    .compile();
  app = module.createNestApplication();
  await app.init();
});
```

#### Decision Rule

| Question                                                    | Tool                            |
| ----------------------------------------------------------- | ------------------------------- |
| "Did the query count drop?" / "Did EXPLAIN plan change?"    | **Testcontainers**              |
| "What is p95 latency under 50 concurrent users on 0.5 CPU?" | **compose.perf + k6**           |
| "What is CPU/memory usage per container?"                   | **compose.perf + docker stats** |
| "Does graceful shutdown work?"                              | **compose.perf + docker stop**  |

#### `apps/shop/compose.perf.yml`

```yaml
# apps/shop/compose.perf.yml
services:
  postgres-perf:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: rd_shop_perf
      POSTGRES_USER: perf
      POSTGRES_PASSWORD: perf
    ports:
      - '5433:5432' # Different port — no conflict with dev
    tmpfs:
      - /var/lib/postgresql/data # RAM-backed — fast, disposable
    command: >
      postgres
        -c shared_preload_libraries=pg_stat_statements
        -c pg_stat_statements.track=all
        -c log_min_duration_statement=100
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U perf -d rd_shop_perf']
      interval: 5s
      timeout: 3s
      retries: 5

  rabbitmq-perf:
    image: rabbitmq:3-management-alpine
    ports:
      - '5673:5672'
      - '15673:15672'

  shop-perf:
    build:
      context: ../.. # Same as compose.dev.yml — monorepo root
      dockerfile: Dockerfile.dev
    environment:
      DATABASE_URL: postgres://perf:perf@postgres-perf:5432/rd_shop_perf
      RABBITMQ_HOST: rabbitmq-perf
      RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION: 'true' # Payments service not available
    depends_on:
      postgres-perf:
        condition: service_healthy

  migrate-perf:
    build:
      context: ../..
      dockerfile: Dockerfile.dev
    environment:
      TS_NODE_PROJECT: tsconfig.app.json
      APP: shop
      DATABASE_URL: postgres://perf:perf@postgres-perf:5432/rd_shop_perf
    volumes:
      - ../../apps:/app/apps
      - ../../libs:/app/libs
      - /app/node_modules
    command: ['sh', '-c', 'cd apps/shop && npm run db:migrate:dev']
    depends_on:
      postgres-perf:
        condition: service_healthy

  seed-perf:
    build:
      context: ../..
      dockerfile: Dockerfile.dev
    environment:
      TS_NODE_PROJECT: tsconfig.app.json
      APP: shop
      DATABASE_URL: postgres://perf:perf@postgres-perf:5432/rd_shop_perf
    volumes:
      - ../../apps:/app/apps
      - ../../libs:/app/libs
      - /app/node_modules
    command:
      [
        'sh',
        '-c',
        'cd apps/shop && npx ts-node -r tsconfig-paths/register ./test/performance/seed/index.ts',
      ]
    depends_on:
      migrate-perf:
        condition: service_completed_successfully
```

Key design choices:

- **`context: ../..`** — same as `compose.dev.yml`. Required because `Dockerfile.dev` expects monorepo root
- **`tmpfs`** for Postgres data → fast writes, auto-cleanup on container stop. See [tmpfs Correctness Analysis](#tmpfs-correctness-analysis) for when this is valid and when to disable it
- **Different ports** (5433, 5673) → can run alongside dev compose without conflict
- **`pg_stat_statements` pre-enabled** → query profiling out of the box
- **`log_min_duration_statement=100`** → automatic slow query logging
- **`RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION: 'true'`** → payments gRPC service is not part of perf env; disables payment flow in order worker
- **`migrate-perf` + `seed-perf` services** → automated schema + data setup (modeled after dev compose `migrate` and `seed` services)

### Automated Performance Test Lifecycle

Two parallel lifecycles — one for correctness (Testcontainers), one for runtime metrics (compose).

#### Testcontainers Lifecycle (per-item correctness)

Managed by Jest: container start → migrate → seed → test → assert → auto-cleanup.

```bash
# Run all Testcontainers perf tests (from monorepo root)
npx jest --config apps/shop/test/performance/jest-perf.json

# Run a single scenario
npx jest --config apps/shop/test/performance/jest-perf.json -- product-search
```

Each `*.perf.ts` file calls only the seed generators it needs in `beforeAll()`:

```typescript
// product-search.perf.ts
beforeAll(async () => {
  await seedProducts(dataSource, 10_000);
});
```

#### Compose Lifecycle (baseline & before/after metrics)

Single-command lifecycle from `apps/shop/`:

```bash
# Full lifecycle
npm run perf:up           # docker compose -f compose.perf.yml up -d postgres-perf rabbitmq-perf
npm run perf:migrate      # docker compose -f compose.perf.yml run --rm migrate-perf
npm run perf:seed         # docker compose -f compose.perf.yml run --rm seed-perf
npm run perf:app          # docker compose -f compose.perf.yml up -d shop-perf
npm run perf:baseline     # k6 run --out json=results/baseline.json test/performance/k6/product-search.js
npm run perf:down         # docker compose -f compose.perf.yml down -v
```

**Before/after comparison flow:**

```
1. npm run perf:up && npm run perf:migrate && npm run perf:seed && npm run perf:app
2. k6 run --out json=results/baseline.json k6/product-search.js
   → stdout: p50=12ms, p95=45ms, p99=120ms, throughput=850 req/s
3. npm run perf:down                           # Clean slate
4. # ... apply optimization (e.g., add GIN index migration)
5. npm run perf:up && npm run perf:migrate && npm run perf:seed && npm run perf:app
6. k6 run --out json=results/after.json k6/product-search.js
   → stdout: p50=4ms, p95=15ms, p99=35ms, throughput=2100 req/s
7. npm run perf:down
8. # Compare baseline.json vs after.json
```

**Per-scenario seed isolation:**

The `seed-perf` compose service runs `test/performance/seed/index.ts`, which accepts a `--scenario` flag:

```bash
# Seed only product search data (10 K products, minimal orders/users)
npm run perf:seed -- --scenario=product-search

# Seed only order stress data (100 users, 20 products with high stock)
npm run perf:seed -- --scenario=order-creation

# Seed full dataset (default — all scenarios)
npm run perf:seed
```

The seed orchestrator (`test/performance/seed/index.ts`) imports entity classes from `apps/shop/src/` (same as the existing `apps/shop/src/db/seed/`) and uses `dataSource.initialize()` → bulk insert → `dataSource.destroy()` — same code path whether invoked from Testcontainers `beforeAll()` or from the compose `seed-perf` service.

### Stack Teardown & Disk Bloat Management

> **Problem:** Repeated image pulls and builds accumulate disk usage. Both Testcontainers and compose contribute.

**Per-run teardown (Testcontainers — automatic):**

Testcontainers' `ryuk` sidecar automatically removes containers after the test process exits. Each `afterAll()` calls `container.stop()` for explicit cleanup within the test.

**Per-run teardown (compose — `npm run perf:down`):**

```bash
# npm run perf:down ≡
docker compose -f compose.perf.yml down -v --remove-orphans
# -v removes anonymous volumes (including tmpfs definitions)
# --remove-orphans removes containers from previous runs not in current compose
```

**Periodic cleanup (manual, ~ weekly):**

```bash
# Remove all stopped containers + unused images + build cache
docker system prune -f

# Nuclear option — remove ALL unused images (including base images like postgres:16-alpine)
docker system prune -a -f

# Check current disk usage
docker system df
```

**Preventing Docker Desktop disk bloat on macOS:**

Docker Desktop stores its virtual disk at `~/Library/Containers/com.docker.docker/Data/vms/0/data/`. This grows monotonically even after `docker system prune`. Options:

1. **Docker Desktop settings → Resources → Disk image size** — set a cap (e.g., 32 GB)
2. **Docker Desktop → Troubleshoot → Clean / Purge data** — resets the VM disk (deletes all images/containers/volumes)
3. Testcontainers auto-removes containers via `ryuk` sidecar — no manual cleanup needed for TC-managed containers

### Measurement Tools

| Tool                                       | Purpose                                                 | For Which Bottleneck             |
| ------------------------------------------ | ------------------------------------------------------- | -------------------------------- |
| `k6`                                       | HTTP load testing (p50/p95/p99, throughput, error rate) | All HTTP scenarios               |
| `autocannon`                               | Simpler HTTP stress testing (Node.js native)            | B1 bcrypt, A3 order creation     |
| `EXPLAIN (ANALYZE, BUFFERS)`               | Single-query profiling                                  | A1 product search, A2 pagination |
| `pg_stat_statements`                       | Top-N query ranking, call counts                        | All DB scenarios                 |
| `docker stats`                             | CPU/memory per container                                | All scenarios                    |
| `clinic.js` / `0x`                         | Node.js flame graphs, event loop profiling              | B1 bcrypt, C1 worker contention  |
| `perf_hooks.monitorEventLoopDelay()`       | Event loop lag measurement                              | B1, all under load               |
| RabbitMQ Management UI (`localhost:15673`) | Queue depth, consumer rate, ack rate                    | C2 prefetch tuning               |

---

## tmpfs Correctness Analysis

> **Question:** Does tmpfs (RAM-backed storage) blur test correctness, given that production uses real disk (EBS gp3)?

### Short Answer

For **query plan profiling** (EXPLAIN ANALYZE, GIN index validation, cursor pagination) → **No, tmpfs is fine**. For **I/O throughput testing** (connection pool exhaustion, write-heavy order bursts) → **Yes, tmpfs masks real bottlenecks**.

### Detailed Breakdown

| Test Type                                 | tmpfs Impact                                                                                                                                                 | Action                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| A1 — ILIKE vs GIN index (EXPLAIN ANALYZE) | **None.** Query planner chooses the same plan regardless of storage. Buffer hits/misses visible in `EXPLAIN (ANALYZE, BUFFERS)`.                             | Use tmpfs ✅                                                                                                 |
| A2 — Cursor pagination query count        | **None.** Measures round-trips, not I/O latency.                                                                                                             | Use tmpfs ✅                                                                                                 |
| A3 — Order creation lock duration         | **Minor blur.** Lock contention is CPU-bound, but the INSERT/UPDATE flush to WAL is faster on tmpfs. The lock hold time will be ~10-20% shorter than on EBS. | Use tmpfs for relative before/after ✅. Note that absolute numbers are optimistic.                           |
| A4 — Connection pool exhaustion           | **Moderate blur.** On real disk, slow checkpoint writes can cause query stalls that amplify pool pressure. tmpfs hides this.                                 | For pool sizing, disable tmpfs and use a Docker volume: `volumes: [shop_perf_data:/var/lib/postgresql/data]` |
| B1 — Bcrypt stress                        | **None.** CPU-bound, no Postgres I/O.                                                                                                                        | Use tmpfs ✅                                                                                                 |
| pg_stat_statements — top-N query ranking  | **Minor blur.** Query timings are faster, but relative ranking is preserved.                                                                                 | Use tmpfs ✅                                                                                                 |

### When to Disable tmpfs

For scenarios where disk I/O matters (A4 pool exhaustion, write-heavy order bursts under resource constraints), switch to a named Docker volume:

```yaml
# compose.perf.yml — disk-realistic variant
services:
  postgres-perf:
    # Remove: tmpfs: [/var/lib/postgresql/data]
    volumes:
      - perf_pg_data:/var/lib/postgresql/data

volumes:
  perf_pg_data:
    driver: local
```

This introduces cleanup responsibility (see [Stack Teardown](#stack-teardown--disk-bloat-management)), but gives realistic disk I/O on macOS Docker Desktop (backed by the Linux VM's virtual disk, closer to EBS than host SSD).

### Recommendation

**Default to tmpfs** for most scenarios. It's faster, disposable, and the query plan correctness (which is the main signal for A1, A2, A3) is unaffected. For the final validation pass before AWS migration, run one round with a named volume.

---

## Simulating Production Constraints Locally

> **Problem:** MacBook Pro M2 Pro (10-12 cores, 16 GB RAM) is vastly more powerful than the cloud target (t3.micro: 1 vCPU, 1 GB RAM). Local performance numbers are meaningless without constraints.

### Solution Comparison

| Solution                                   | Syntheticity                  | Local Reproducibility | Production-Only? | P/S/C |
| ------------------------------------------ | ----------------------------- | --------------------- | ---------------- | ----- |
| **A. Docker `--cpus` + `--memory`**        | Good — cgroups throttling     | Yes                   | No               | 3/3/1 |
| **B. Docker Compose `deploy.resources`**   | Good — same as A, declarative | Yes                   | No               | 3/3/1 |
| **C. Lima/colima VM with resource limits** | Very good — real VM           | Yes but slower setup  | No               | 2/2/2 |
| **D. Dedicated cloud VM for perf tests**   | Best — real target hardware   | No (requires cloud)   | Yes              | 3/3/3 |

### Recommended: Solution B (Docker Compose resource limits)

Add resource constraints to the perf compose file:

```yaml
# docker-compose.perf.yml (additions)
services:
  shop-perf:
    deploy:
      resources:
        limits:
          cpus: '1.0' # Match t3.micro: 1 vCPU
          memory: 512M # Shop gets ~512 MB of the 1 GB
        reservations:
          cpus: '1.0'
          memory: 256M

  postgres-perf:
    deploy:
      resources:
        limits:
          cpus: '0.5' # Match db.t3.micro shared CPU
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
```

**Important caveats:**

- Docker Desktop on macOS uses a Linux VM internally — `--cpus` limits are enforced via cgroups inside this VM. This is reasonably close to real EC2 CPU throttling.
- M2 Pro single-core performance is ~2× faster than t3.micro (Graviton/Intel). So `--cpus=1.0` on M2 ≈ 2 vCPU on cloud. For closer simulation, use `--cpus=0.5`.
- Memory limits are accurate — OOM kills work the same way.
- Disk I/O on Apple SSD is much faster than EBS gp3. For Postgres-heavy tests, the `tmpfs` mount already removes disk as a variable (both local and cloud will be memory-speed).

### Calibration

Run the same baseline scenario on:

1. Resource-limited local Docker (this setup)
2. Actual cloud VM (staging on AWS after migration)

Compare results. If local p95 at `--cpus=0.5` is within 20% of cloud p95, the simulation is valid for relative (before/after) comparison.

---

## FinOps Analysis

### Current State Cost Profile

| Component              | Local/VM                                      | Monthly Cost |
| ---------------------- | --------------------------------------------- | ------------ |
| Single VM (Hetzner/DO) | 2 vCPU, 4 GB RAM                              | ~$5-20       |
| Docker Compose         | shop + payments + postgres + rabbitmq + minio | $0 (bundled) |
| CI/CD                  | GitHub Actions free tier                      | $0           |
| **Total**              |                                               | **~$5-20**   |

### AWS Migration Cost Impact (from aws-migration-plan.md)

> **Correction:** AmazonMQ (mq.t3.micro) and ElastiCache (cache.t3.micro) are both included in AWS free tier for 12 months (750 hrs/month each). Updated estimates below.

| Component                     | Year 1 (Free Tier) | Post-Free-Tier | Notes                                           |
| ----------------------------- | ------------------ | -------------- | ----------------------------------------------- |
| EC2 (ECS host) t3.micro       | $0                 | ~$8/mo         | 750 hrs/mo free                                 |
| RDS db.t3.micro × 2           | $0\*               | ~$30/mo        | \*Share 750 hrs; second instance partially paid |
| AmazonMQ mq.t3.micro          | $0                 | ~$30/mo        | 750 hrs/mo free tier                            |
| ElastiCache cache.t3.micro    | $0                 | ~$13/mo        | 750 hrs/mo free tier                            |
| ALB                           | ~$20/mo            | ~$20/mo        | No free tier                                    |
| S3 + CloudFront               | $0                 | ~$1/mo         | Free tier covers both                           |
| Secrets Manager (~10 secrets) | ~$4/mo             | ~$4/mo         | No free tier                                    |
| NAT instance (fck-nat)        | $0                 | ~$8/mo         | Shares EC2 free tier pool                       |
| **Total**                     | **~$24/mo**        | **~$114/mo**   |                                                 |

### FinOps Optimization Opportunities

#### F1. Single RDS Instance with Two Databases (Saves ~$15/mo post-free-tier)

**Current plan:** Two separate RDS instances (shop + payments).

**Alternative:** One RDS instance with two databases. Separate schemas, shared instance.

**Risk:** Resource contention between services. Acceptable for staging.

#### F2. Secrets Manager → SSM Parameter Store (Saves ~$4/mo)

**Current plan:** Secrets Manager at $0.40/secret/month.

**Alternative:** SSM Parameter Store SecureString (free, uses KMS).

**Risk:** Lower API rate limits (40 TPS). Irrelevant for startup-time-only secrets.

#### F3. Spot Instances for Stage Environment (Saves ~$5/mo on compute)

Use EC2 Spot for staging (60-90% savings). Acceptable interruption risk for non-production.

#### F4. AmazonMQ → SQS Migration (Post-free-tier: saves ~$30/mo)

**Not urgent during year 1** (free tier covers AmazonMQ). Plan for post-free-tier:

- SQS is pay-per-request (~$0.40/1M requests). For <100 K messages/month: <$1/mo.
- Requires replacing `amqplib` with `@aws-sdk/client-sqs`. The `RabbitMQService` abstraction makes this a transport-layer change.
- Idempotency via `ProcessedMessage` entity already handles SQS at-least-once delivery.
- Can defer to month 10-11 of free tier to have migration ready before costs hit.

#### F5. CloudFront for API Response Caching (Deferred)

Deferred to post-AWS-migration. CloudFront cache behaviours for public GET endpoints (products, categories) can offload read traffic. Free tier covers 1 TB/month.

### FinOps Summary — Potential Savings (Post-Free-Tier)

| Optimization             | Annual Savings         | Complexity | Risk                      |
| ------------------------ | ---------------------- | ---------- | ------------------------- |
| Single RDS + 2 databases | ~$180/yr               | Low        | Medium (resource sharing) |
| Secrets Manager → SSM    | ~$48/yr                | Low        | Low                       |
| Spot for staging         | ~$60/yr                | Low        | Low (staging only)        |
| AmazonMQ → SQS           | ~$360/yr               | Medium     | Low (idempotency exists)  |
| CloudFront API caching   | ~$60-120/yr (indirect) | Low        | Low                       |
| **Total**                | **~$648-768/yr**       |            |                           |

Post-free-tier, with all optimizations: **~$114/mo → ~$56-60/mo**.

---

## Bottleneck Analysis Matrix

| Criterion                 | Definition                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Syntheticity**          | How "real" is the bottleneck? _Real_ = observable in production-like workloads. _Synthetic_ = only in artificial benchmarks/extreme edge cases. |
| **Local Reproducibility** | Can this be measured in a local Docker Compose environment?                                                                                     |
| **Production-Only**       | Is this relevant only in production (cloud infra, multi-instance, real traffic)?                                                                |

| #   | Bottleneck                               | Group    | Syntheticity                                | Locally Reproducible?                            | Production-Only?                | Notes                                              |
| --- | ---------------------------------------- | -------- | ------------------------------------------- | ------------------------------------------------ | ------------------------------- | -------------------------------------------------- |
| A1  | Product search ILIKE scan                | DB       | **Real** — any text search triggers it      | **Yes** — seed 10 K+ products, `EXPLAIN ANALYZE` | No                              | Highest impact. Needs large seed.                  |
| A2  | Cursor pagination extra query            | DB       | **Partially real** — 2-5 ms/request         | **Yes** — `pg_stat_statements`                   | No                              | Low absolute cost, unnecessary overhead            |
| A3  | Order re-fetch under lock                | DB       | **Partially real** — 1-3 ms under lock      | **Yes** — profile transaction duration           | No                              | Matters only under high-concurrency bursts         |
| A4  | No DB pool config                        | DB       | **Synthetic at low load**, real under burst | **Partially** — hard to exhaust locally          | Mostly production               | Manifests as connection queue under burst          |
| B1  | Bcrypt blocking event loop               | App      | **Real** — 100 ms/hash on single core       | **Yes** — `autocannon` against login             | No                              | Critical on t3.micro. Use resource-limited Docker. |
| B2  | Graceful shutdown disabled               | App      | **Real** — errors during deploy             | **Partially** — `docker stop`                    | Mostly production (ECS rolling) | Silent issue; noticed only during deploys          |
| B3  | No gRPC circuit breaker                  | App      | **Real** — cascade failure                  | **Yes** — simulate delayed payments service      | No                              | Defensive; critical for resilience                 |
| B4  | Order cancel loads unnecessary relations | App      | **Synthetic** — cancel is rare              | **Yes** but low impact                           | No                              | Low priority                                       |
| C1  | Worker in same process                   | Infra    | **Synthetic at low load**, real under burst | **Partially** — stress both HTTP + queue         | Mostly production               | Event loop contention                              |
| C2  | RabbitMQ prefetch tuning                 | Infra    | **Partially real**                          | **Yes** — queue 1 K messages, measure drain      | No                              | Tuning exercise                                    |
| C3  | Docker image size                        | Infra    | **Synthetic** — already well-optimized      | **Yes** — `docker images`                        | Mostly production               | Marginal                                           |
| D1  | No caching layer                         | Deferred | **Real** — every request hits DB            | **Yes**                                          | No                              | Biggest cumulative impact; deferred to AWS         |
| D4  | Audit log no indexes                     | Deferred | **Real** — grows daily                      | **Yes**                                          | No                              | Deferred to CloudWatch migration                   |

### Top 5 Bottlenecks by "Realness" × Impact (Actionable Now)

1. **A1 — Product search ILIKE scan** — Real, locally reproducible, high impact, medium fix
2. **B1 — Bcrypt event loop blocking** — Real, locally reproducible, critical on constrained hardware
3. **B3 — No gRPC circuit breaker** — Real, locally reproducible, prevents cascade failures
4. **A2 — Cursor pagination extra query** — Partially real, easy fix, eliminates unnecessary DB round-trip
5. **A3 — Order re-fetch under lock** — Partially real, easy fix, reduces lock duration

---

## Recommended Hot Scenario for Baseline

**Scenario: Product search + order creation flow (REST-focused)**

1. **Product search** — `GET /api/v1/products?search=term&category=X` — exercises ILIKE, cursor pagination, DB pool
2. **Order creation** — `POST /api/v1/orders` — exercises pessimistic locking, transaction, RabbitMQ publish, audit log
3. **Auth stress** — `POST /api/v1/auth/signin` — exercises bcrypt, event loop blocking, rate limiting
4. **Order payment status** — `GET /api/v1/orders/:id/payment` — exercises gRPC call (1:1, not N+1)

### Baseline Metrics to Capture

```
Scenario: Product search → Order creation → Auth stress → Payment status

Load: 50 concurrent users, 60-second duration (k6 or autocannon)

Environment:
  compose.perf.yml (resource-limited: shop --cpus=0.5, --memory=512M; postgres --cpus=0.5, --memory=512M)
  k6 from host → shop-perf container
  Seed: 10K products, 1K orders, 100 users (via seed-perf service)

Metrics:
  p50 latency:      ___ ms
  p95 latency:      ___ ms
  p99 latency:      ___ ms
  Throughput:        ___ req/s
  Error rate:        ___ %
  CPU:               ___ % (per container via docker stats)
  Memory (RSS):      ___ MB (per container)
  Event loop lag:    ___ ms (p95, from Phase 0.2)
  DB connections:    ___/___ (pg_stat_activity)
  Slow queries:      ___ (count from pg log / pg_stat_statements)
  Queue depth:       ___ (RabbitMQ management)
```

---

## Implementation Priority

> **Prerequisites first.** Phase 0 (observability) and Phase 0.5 (perf test infrastructure) must be completed before Groups A and B, because every optimization requires **before/after measurement** to validate impact. Without the testing infrastructure, there is no baseline to compare against.

| Order   | Item                                                                                   | Group         | Effort       | Expected Impact                                        | Depends On                                               |
| ------- | -------------------------------------------------------------------------------------- | ------------- | ------------ | ------------------------------------------------------ | -------------------------------------------------------- |
| **0**   | **Observability foundation (0.1-0.4)**                                                 | **Phase 0**   | **2-3 days** | **Enables all measurement**                            | —                                                        |
| **0.5** | **Perf test infrastructure (Testcontainers, compose.perf.yml, bulk seed, k6 scripts)** | **Phase 0.5** | **2-3 days** | **Enables baseline capture + before/after validation** | Phase 0                                                  |
| 1       | Product search GIN index (A1)                                                          | DB            | 1 day        | -80% search latency                                    | Phase 0.5 (TC: EXPLAIN + compose: k6 p95)                |
| 2       | Opaque cursor tokens (A2)                                                              | DB            | 1 day        | -1 DB query per page request                           | Phase 0.5 (TC: pg_stat_statements)                       |
| 3       | Order re-fetch elimination (A3)                                                        | DB            | 0.5 day      | -1-3 ms lock duration                                  | Phase 0.5 (TC: transaction profiling)                    |
| 4       | DB pool size config (A4)                                                               | DB            | 0.5 day      | Prevents connection exhaustion                         | Phase 0.5 (TC: pg_stat_activity + compose: docker stats) |
| 5       | Bcrypt → bcryptjs (B1)                                                                 | App           | 0.5 day      | Unblocks event loop during auth                        | Phase 0.5 (compose: k6 auth-flow + event loop lag)       |
| 6       | gRPC circuit breaker (B3)                                                              | App           | 1 day        | Prevents cascade failures                              | Phase 0.5 (compose: mock gRPC service)                   |
| 7       | Graceful shutdown (B2)                                                                 | App           | 1 day        | Zero-downtime deploys                                  | Phase 0.5 (compose: docker stop)                         |
| 8       | Order cancel optimization (B4)                                                         | App           | 0.5 day      | Minor — rare operation                                 | Phase 0.5 (TC: pg_stat_statements)                       |
| 9       | RabbitMQ prefetch tuning (C2)                                                          | Infra         | 0.5 day      | Better queue throughput                                | Phase 0.5 (compose: RabbitMQ Management UI)              |
| —       | Caching layer (D1)                                                                     | Deferred      | 1-2 days     | -50% DB read load                                      | AWS migration                                            |
| —       | Audit log → CloudWatch (D4)                                                            | Deferred      | 1 day        | Removes DB write for audit                             | AWS migration                                            |
| —       | CloudFront API caching (D3)                                                            | Deferred      | 1 day        | Offloads read traffic                                  | AWS migration                                            |

---

## Measurement Runbook

> Exact step-by-step instructions for capturing all metrics required by Part 4 of the homework.
> Run BEFORE and AFTER each optimisation group using the same procedure.

---

### Pre-requisites

```bash
# From apps/shop/
npm run perf:fresh     # first time: start infra + migrate + seed + start shop-perf
# OR (if infra already up, only rebuild the app image):
npm run perf:app:rebuild
```

The shop container name is **`rd_shop_perf_shop`** (set in `compose.perf.yml`).

---

### How to capture BEFORE state

BEFORE = the unoptimised codebase. To measure it:

```bash
git stash                # stash all current changes
npm run perf:app:rebuild # rebuild the image from the unoptimised source
```

Run all k6 scripts and capture CPU/memory/event-loop-lag (see below).

```bash
git stash pop            # restore optimised code
npm run perf:app:rebuild # rebuild with optimisations for AFTER measurements
```

---

### Event Loop Lag

`setupEventLoopMonitoring` is already wired in `main.ts`. It logs p50/p95/p99 every 5 seconds when p99 exceeds `EVENT_LOOP_LAG_THRESHOLD_MS` (default 100 ms).

**Step 1 — Record the timestamp immediately before the k6 run:**

```bash
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
npm run perf:after:auth:b1   # or whichever scenario
```

**Step 2 — Extract only logs from that run (Docker filters server-side):**

```bash
docker logs --since "$START" rd_shop_perf_shop 2>&1 | grep -i "event loop lag"
```

No file to manage, no stale data from previous runs. `--since` accepts RFC3339 timestamps.

Expected output line format:

```
Event loop lag exceeded threshold — p50=1.23ms p95=87.45ms p99=142.10ms (threshold=100ms)
```

**Step 3 — Record for Part 4 table:**

- p99 value from the highest-lag log line during the k6 window
- If no lines appear: p99 stayed below threshold (< 100 ms) — record as `< 100 ms`

**Baseline (before B1/B5):** under `perf:baseline:auth` with 30 VUs + bcrypt, expect p99 > 100 ms (bcrypt saturates libuv thread pool, lag spills into event loop). After B5 (HMAC) expect p99 < 5 ms.

---

### CPU and Memory

**Single-snapshot (before k6 run ends):**

```bash
docker stats rd_shop_perf_shop --no-stream \
  --format "CPU={{.CPUPerc}}  MEM={{.MemUsage}}  MEM%={{.MemPerc}}"
```

**Continuous sampling during k6 run (recommended):**

```bash
# Terminal 2 — start polling BEFORE launching k6
STATS_FILE="/tmp/docker-stats-$(date +%H%M%S).txt"
while true; do
  docker stats rd_shop_perf_shop --no-stream \
    --format "$(date +%H:%M:%S)  CPU={{.CPUPerc}}  MEM={{.MemUsage}}";
  sleep 3;
done | tee "$STATS_FILE" &
STATS_PID=$!

# Terminal 1 — run k6
npm run perf:after:auth:b5

kill $STATS_PID
echo "Stats saved to $STATS_FILE"
```

Each run writes to a unique timestamped file — no cross-run pollution.

**Extract peak values:**

```bash
# Peak CPU
grep -oP 'CPU=\K[0-9.]+' /tmp/docker-stats.txt | sort -n | tail -1

# Memory usage during test (last reading)
tail -5 /tmp/docker-stats.txt
```

**What to record for Part 4 table:**

| Metric         | What to record                                   |
| -------------- | ------------------------------------------------ |
| CPU            | peak `CPUPerc` during k6 window                  |
| Memory         | `MemUsage` at peak (e.g. `247MiB / 512MiB`)      |
| Event loop lag | p99 from log lines (or `< 100ms` if no warnings) |

---

### B2 — Graceful Shutdown: Measurement Protocol

**What to measure:**

| Metric                   | Before                | After                  | How                 |
| ------------------------ | --------------------- | ---------------------- | ------------------- |
| In-flight request result | `ECONNRESET` / 502    | HTTP 2xx (completes)   | `curl` output below |
| Container exit code      | 137 (SIGKILL)         | 0 (clean)              | `docker inspect`    |
| Orphan DB connections    | ≥1 idle from dead PID | 0                      | `pg_stat_activity`  |
| Shutdown duration        | ~0s (instant kill)    | ≤ graceful-stop window | `time docker stop`  |

**Step-by-step:**

```bash
# 1. Start the perf stack
npm run perf:fresh

# 2. Terminal 1 — send a slow request (simulates in-flight):
curl -v -X POST http://localhost:8090/api/v1/orders \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"productId":"...","quantity":1}]}' &
CURL_PID=$!

# 3. Terminal 2 — immediately stop the container (while curl is running):
time docker stop --time=30 rd_shop_perf_shop

# 4. Check curl result:
wait $CURL_PID; echo "Exit: $?"    # 0 = success (2xx), non-zero = killed

# 5. Check exit code:
docker inspect rd_shop_perf_shop --format '{{.State.ExitCode}}'
# Expected AFTER: 0

# 6. Check orphan DB connections (run against perf Postgres):
docker exec rd_shop_perf_postgres psql -U perf -d rd_shop_perf \
  -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'idle';"
# Expected AFTER: 0 (pool closed cleanly)
```

**BEFORE state:** run with graceful shutdown disabled (comment out `app.enableShutdownHooks()` or use the git-stash approach above).  
**AFTER state:** re-enable `app.enableShutdownHooks()` + `SIGTERM` handler.

---

### B3 — Circuit Breaker: Measurement Protocol

**What to measure:**

| Metric                             | Before (no breaker)           | After (breaker open)           | How                                  |
| ---------------------------------- | ----------------------------- | ------------------------------ | ------------------------------------ |
| Time-to-fail per order (gRPC down) | ~5 000 ms (full timeout)      | ~1 ms (fast-fail)              | k6 `http_req_duration` on order-flow |
| Queue backlog growth               | grows (workers block 5s each) | drains fast (workers released) | RabbitMQ Management UI               |
| `messages_unacknowledged`          | rising while gRPC is down     | stable / dropping              | Management UI                        |
| Error response p95                 | ~5 000 ms                     | < 50 ms                        | k6 threshold                         |

**Step-by-step:**

```bash
# 1. Start perf stack. RabbitMQ Management UI is at http://localhost:15672
#    (guest/guest or configured credentials)

# 2. Simulate gRPC payments failure: stop the payments gRPC container
#    (in compose.perf.yml this is not present — payments is mocked;
#     to simulate: override PAYMENTS_GRPC_HOST to a non-existent address)
#    Edit compose.perf.yml or use env override at runtime:
docker exec rd_shop_perf_shop sh -c 'kill -0 1'   # sanity check container is up

# For the BEFORE measurement — with no circuit breaker:
# 3a. Point PAYMENTS_GRPC_HOST to 127.0.0.1:9999 (nothing listening)
# 3b. Run order-flow k6 — each order waits full 5s timeout per gRPC call
npm run perf:after:orders:b4

# 4. Observe RabbitMQ UI:
#    Queues → rd_shop_orders → messages_unacknowledged will climb
#    (workers are blocked on 5s timeout)

# For the AFTER measurement — with opossum circuit breaker:
# 5. After 5 consecutive failures opossum opens the circuit
# 6. Subsequent order k6 requests fail fast (<1ms) — check shop logs:
docker logs rd_shop_perf_shop 2>&1 | grep -i "circuit breaker"

# 7. k6 p95 comparison:
#    BEFORE: ~5000ms  AFTER: <50ms  (fast-fail ServiceUnavailableException)
```

**RabbitMQ Management UI metrics to screenshot:**

- `messages_ready` — orders queued, waiting to be picked up
- `messages_unacknowledged` — orders being processed (blocked on gRPC before breaker opens)
- `consumer_utilisation` — should jump from ~0% (blocked) to ~100% (fast-failing) after breaker activates

---

### C2 — RabbitMQ Prefetch: Scope Analysis for Part 3.2

**Verdict: marginal — do not prioritise over B2 or B3.**

The `RABBITMQ_PREFETCH_COUNT` env var is already wired (`apps/shop/src/rabbitmq/rabbitmq.module.ts`). The default is configurable; there is no "wrong" value to fix right now. The measurable before/after delta is minor:

- Higher prefetch → lower `time-to-drain` on burst, but more memory and crash-loss risk.
- Lower prefetch → safer ack semantics, slightly higher queue depth under burst.

Proving the effect requires a queue-depth measurement under a message burst (not covered by existing k6 scripts). **It adds measurement complexity for a small gain.** If the homework scorer expects exactly "adjust requests/limits + queue lag" from Part 3.2 examples, A4 (DB pool size) already satisfies that. If you want a second cost/runtime item with real data, implement B2 or B3 — both produce cleaner before/after tables with bigger deltas.

---

## Cross-References

- Architecture: `docs/backend/architecture/` — all feature and infra docs
- AWS migration: `docs/backend/requirements/aws-migration-plan.md`
- Security: `docs/backend/architecture/infra-security.md`
- Test infrastructure: `docs/backend/architecture/test-infrastructure.md`
- Homework requirements: `.temp/performance-raw.md`
