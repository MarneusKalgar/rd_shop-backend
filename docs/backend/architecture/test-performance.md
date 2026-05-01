# Performance Testing Infrastructure

## Overview

Two-tier approach: correctness first, runtime metrics second.

| Tier            | Tool                    | Location                                   | Purpose                                                         |
| --------------- | ----------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| 1 — Correctness | Testcontainers + Jest   | `apps/shop/test/performance/`              | Real Postgres; EXPLAIN plans, `pg_stat_statements` query counts |
| 2 — Runtime     | `compose.perf.yml` + k6 | `apps/shop/test/performance/scenarios/k6/` | HTTP throughput, p95/p99 latencies, queue drain                 |

---

## Tier 1 — Testcontainers Specs

### Pattern

Each spec bootstraps a real Postgres container via the shared helpers:

```ts
// test/performance/bootstrap.ts
await bootstrapPerfTest(); // spin up pg container, run migrations, seed
// ...scenario...
await teardownPerfTest(); // ryuk auto-cleanup
```

Specs use `pg_stat_statements` (enabled via container flags) to assert exact SQL call counts per operation, and `EXPLAIN (ANALYZE, FORMAT JSON)` to validate index usage.

### Spec Inventory

| File                        | Scenario                                    | Key assertion                                         |
| --------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| `product-search.perf.ts`    | GIN trigram search (A1)                     | seq-scan → index-scan; DB calls 5→1                   |
| `cursor-pagination.perf.ts` | Cursor pagination in-memory decode (A2)     | page-2 DB calls 2→1                                   |
| `order-creation.perf.ts`    | Remove post-INSERT re-fetch (A3)            | SQL calls per create −1                               |
| `order-cancel.perf.ts`      | Conditional relation loading on cancel (B4) | SQL calls per cancel −1 when relations already loaded |
| `token-hmac.perf.ts`        | HMAC-SHA256 vs bcrypt token hashing (B5)    | op latency ~100 ms → ~1 µs                            |

---

## Tier 2 — `compose.perf.yml` Stack

### Services and Profiles

```
compose.perf.yml
│
├── profile: app
│   ├── shop-perf          # NestJS app; 0.5 vCPU / 512 MiB limits
│   ├── postgres-perf      # Postgres with pg_stat_statements + tmpfs (no disk I/O)
│   └── rabbitmq-perf      # RabbitMQ broker
│
├── profile: app-grpc-breaker
│   ├── shop-perf          # same, but PAYMENTS_GRPC_HOST=grpc-stub-perf
│   └── grpc-stub-perf     # controllable gRPC stub (hangs all RPCs → triggers opossum open)
│
├── profile: migrate
│   └── migrate-perf       # one-shot TypeORM migration runner
│
└── profile: seed
    └── seed-perf           # one-shot seed script
```

### Resource Constraints

`shop-perf` is intentionally throttled to isolate bottlenecks at realistic cloud-instance scale:

```yaml
deploy:
  resources:
    limits:
      cpus: '0.5'
      memory: 512M
```

`postgres-perf` uses `tmpfs` for `PGDATA` to eliminate disk I/O variance:

```yaml
tmpfs:
  - /var/lib/postgresql/data
```

---

## k6 Load Scenarios

### Script Inventory

All scripts live in `apps/shop/test/performance/scenarios/k6/`.

| Script                           | Profile | Scenario                                                             |
| -------------------------------- | ------- | -------------------------------------------------------------------- |
| `product-search.js`              | before  | Baseline product search                                              |
| `product-search-after-a1.js`     | after   | Post-GIN-index product search (A1)                                   |
| `product-pagination-after-a2.js` | after   | Product pagination improvements (A2)                                 |
| `order-flow.js`                  | before  | Baseline order create + cancel                                       |
| `order-flow-after-a3.js`         | after   | Post order-create optimization (A3)                                  |
| `order-flow-after-b4.js`         | after   | Post cancel-path optimization (B4); also reused in gRPC-breaker runs |
| `auth-flow.js`                   | before  | Baseline signin + refresh                                            |
| `auth-flow-after-b1.js`          | after   | Post auth-path optimization (B1)                                     |
| `auth-flow-after-b5.js`          | after   | Post token-HMAC optimization (B5)                                    |
| `signin-stress.js`               | before  | High-concurrency signin stress                                       |
| `signin-stress-after-b1.js`      | after   | Post-bcryptjs signin stress                                          |

### Configuration

Scripts accept env vars for VU count and duration:

```bash
k6 run \
  --env PERF_K6_VUS=20 \
  --env PERF_K6_DURATION=60s \
  --out json=results.json \
  scenarios/k6/product-search-after-a1.js
```

---

## Bash Lifecycle Scripts

Located at `apps/shop/test/performance/scripts/`:

| Script                     | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `perf-migrate.sh`          | Runs `migrate-perf` profile (TypeORM migrations)        |
| `perf-seed.sh`             | Runs `seed-perf` profile (test data seed)               |
| `perf-app-grpc-breaker.sh` | Starts `app-grpc-breaker` profile with `grpc-stub-perf` |

---

## npm Script Lifecycle

Defined in `apps/shop/package.json`:

```
perf:up                  # docker compose -f compose.perf.yml up -d (postgres + rabbitmq)
perf:migrate             # run migrate-perf profile
perf:seed                # run seed-perf profile
perf:app                 # start shop-perf (normal gRPC target)
perf:app:rebuild         # force-rebuild image before starting
perf:app:grpc-breaker    # start shop-perf + grpc-stub-perf
perf:app:grpc-breaker:rebuild # same, but rebuild first
perf:app:unconstrained   # start unconstrained app profile
perf:fresh               # perf:up + perf:migrate + perf:seed + perf:app
perf:fresh:unconstrained # same, with unconstrained app profile
perf:fresh:grpc-breaker  # same, with grpc-stub-perf
perf:baseline:*          # search / orders / auth / signin baseline k6 scripts
perf:after:*             # search / pagination / orders / signin / auth after-state scripts
perf:grpc-breaker:before # k6 + hanging-stub scenario
perf:grpc-breaker:after  # k6 + breaker-open scenario
perf:down                # docker compose down -v --remove-orphans
```

---

## `grpc-stub-perf` — B3 Circuit Breaker Isolation

A custom Docker service that speaks the payments gRPC proto but **never responds** (hangs all RPCs). Used for B3 before-state measurement:

- Before: `PaymentsGrpcService.authorize` blocks; RabbitMQ queue grows at +33 msg/s; workers stall ~21 s per order
- After (opossum OPEN): `authorize` fast-fails ~0 ms; queue drains fully; stall time eliminated

`grpc-stub-perf` is activated only under the `app-grpc-breaker` compose profile to avoid interfering with other scenarios.

---

## Evidence Artifacts

All measurement outputs stored in the repo-root `performance-evidences/` directory:

| File / Dir              | Contents                                                                |
| ----------------------- | ----------------------------------------------------------------------- |
| `before-after-table.md` | Full A1–B5 metrics comparison table                                     |
| `b3-screenshots/`       | 7 RabbitMQ management + k6 screenshots for the circuit-breaker scenario |

See [homework-report.md](../../../../homework-report.md) for narrative analysis, trade-offs, and the full acceptance criteria checklist.
