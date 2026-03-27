# Code Duplication & Shared Code — Implementation Plan

## Current state

### Duplicated files (identical or near-identical)

| File                            | Shop | Payments | Difference                               |
| ------------------------------- | ---- | -------- | ---------------------------------------- |
| `config/logger.ts`              | ✅   | ✅       | **Identical**                            |
| `utils/env.ts`                  | ✅   | ✅       | **Identical**                            |
| `core/environment/index.ts`     | ✅   | ✅       | **Identical**                            |
| `db/adapters/base.ts`           | ✅   | ✅       | **Identical**                            |
| `db/adapters/factory.ts`        | ✅   | ✅       | **Identical**                            |
| `db/adapters/interfaces.ts`     | ✅   | ✅       | **Identical**                            |
| `db/adapters/postgres-local.ts` | ✅   | ✅       | **Identical**                            |
| `utils/misc.ts`                 | ✅   | ✅       | Shop adds `simulateExternalService()`    |
| `db/logger/index.ts`            | ✅   | ✅       | Shop adds `incrementQueryCount()` call   |
| `config/typeORM.ts`             | ✅   | ✅       | Same structure, different entity imports |
| `config/index.ts`               | ✅   | ✅       | Shop exports `graceful-shutdown`         |

### Missing shared patterns

- **No base entity class** — `id` (UUID), `createdAt`, `updatedAt` repeated in every entity (6 in shop + 1 in payments)
- **No shared DTOs** — common pagination patterns repeated
- **No shared interceptors/filters** across apps

### Current monorepo config

`nest-cli.json` defines only `shop` and `payments` under `projects` — no `libs/` section. NestJS monorepo natively supports `nest g library` to create shared libs.

---

## Phase 1 — Create `libs/common` library

### 1.1 Generate library

```bash
nest g library common
```

This creates:

```
libs/
  common/
    src/
      common.module.ts
      common.service.ts   # delete — not needed
      index.ts            # barrel export
    tsconfig.lib.json
```

And updates:

- `nest-cli.json` — adds `common` project with `type: "library"`
- `tsconfig.json` — adds path alias `@app/common` → `libs/common/src`

### 1.2 Path alias

Convention: `@app/common` (NestJS default) or `@libs/common`. Stick with NestJS default.

```json
// tsconfig.json (root)
{
  "compilerOptions": {
    "paths": {
      "@app/common": ["libs/common/src"],
      "@app/common/*": ["libs/common/src/*"]
    }
  }
}
```

### 1.3 Library structure

```
libs/common/src/
  index.ts                    # barrel exports
  config/
    logger.ts                 # log level utility
  utils/
    env.ts                    # environment detection
    misc.ts                   # omit() and other shared utils
  environment/
    index.ts                  # env schema/constants
  database/
    adapters/
      base.ts
      factory.ts
      interfaces.ts
      postgres-local.ts
    logger/
      custom-typeorm-logger.ts  # base version (no query counting)
    base.entity.ts            # BaseEntity with id, createdAt, updatedAt
  dto/
    pagination.dto.ts         # shared cursor pagination DTOs
```

### 1.4 Tasks

- [ ] Run `nest g library common`
- [ ] Move identical files from both apps to `libs/common/src/`
- [ ] Update imports in `apps/shop/` to use `@app/common`
- [ ] Update imports in `apps/payments/` to use `@app/common`
- [ ] Remove duplicated files from both apps
- [ ] Verify `npm run build` compiles both apps + library
- [ ] Verify `npm test` passes
- [ ] Verify `npm run type-check` passes

---

## Phase 2 — Docker & Compose alignment for `libs/`

> **This phase is mandatory together with Phase 1.** The `libs/` directory must be available inside containers for both build and dev-reload to work.

### 2.1 Production Dockerfile

Add `COPY libs ./libs` to the `build` stage so `nest build` can resolve `@app/common`:

```dockerfile
# Stage: build
COPY proto ./proto
COPY apps ./apps
COPY libs ./libs          # ← NEW
```

No changes needed in `deps`, `prune`, `prod-base`, or `prod-distroless-*` stages — compiled output lands in `dist/` and is already carried forward.

### 2.2 Dev Dockerfile

`Dockerfile.dev` copies no application source (relies on bind mounts). No changes required — `tsconfig.json` (already copied) will contain the `@app/common` path alias, and the source is provided at runtime via the volume mount added below.

### 2.3 Dev Compose — shop (`apps/shop/compose.dev.yml`)

Add `libs/` bind mount to **both** `shop` and `migrate` services:

```yaml
services:
  shop:
    volumes:
      - ../../apps:/app/apps
      - ../../proto:/app/proto
      - ../../libs:/app/libs # ← NEW
      - /app/node_modules

  migrate:
    volumes:
      - ../../apps:/app/apps
      - ../../libs:/app/libs # ← NEW
      - /app/node_modules
```

Without this, `start:dev` (SWC/ts-node) and migration scripts will fail to resolve `@app/common` imports. NestJS's monorepo watcher automatically picks up `libs/` once registered in `nest-cli.json`, so hot-reload works with no extra config.

### 2.4 Dev Compose — payments (`apps/payments/compose.dev.yml`)

Same change — add `libs/` bind mount to **both** `payments` and `migrate` services:

```yaml
services:
  payments:
    volumes:
      - ../../apps:/app/apps
      - ../../proto:/app/proto
      - ../../libs:/app/libs # ← NEW
      - /app/node_modules

  migrate:
    volumes:
      - ../../apps:/app/apps
      - ../../libs:/app/libs # ← NEW
      - /app/node_modules
```

### 2.5 Production Compose

No changes required. Production compose files reference pre-built images where `libs/` is already compiled into `dist/`.

### 2.6 CI/CD Pipeline

No workflow YAML changes required:

- **npm ci cache** — `libs/` has no separate `package.json`; cache key (`hash(package-lock.json)`) is unchanged.
- **code-quality / integration-tests** — run from checkout, not from Docker images; `tsconfig.json` path alias resolves natively.
- **docker-preview-build / build-and-push** — `docker build` uses repo root as context, so `COPY libs ./libs` resolves automatically.
- **deploy workflows** — pull pre-built images; no source code involved.

### 2.7 `.dockerignore`

Verify `libs/` is **not** excluded in `.dockerignore`. If a blanket ignore pattern exists (e.g., `*` with selective `!apps`), add `!libs` to allowlist it.

### 2.8 Tasks

- [ ] Add `COPY libs ./libs` to `Dockerfile` `build` stage (after `COPY apps ./apps`)
- [ ] Add `../../libs:/app/libs` volume to `shop` service in `apps/shop/compose.dev.yml`
- [ ] Add `../../libs:/app/libs` volume to `migrate` service in `apps/shop/compose.dev.yml`
- [ ] Add `../../libs:/app/libs` volume to `payments` service in `apps/payments/compose.dev.yml`
- [ ] Add `../../libs:/app/libs` volume to `migrate` service in `apps/payments/compose.dev.yml`
- [ ] Verify `.dockerignore` does not exclude `libs/`
- [ ] Verify `docker build --target prod-distroless-shop .` succeeds
- [ ] Verify `docker compose -f apps/shop/compose.dev.yml up shop` resolves `@app/common`
- [ ] Verify `docker compose -f apps/payments/compose.dev.yml up payments` resolves `@app/common`

---

## Phase 3 — Base entity class

### 3.1 BaseEntity

```typescript
// libs/common/src/database/base.entity.ts
import { PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
```

### 3.2 Entities to update

| Entity             | App      | Additional columns beyond base                                 |
| ------------------ | -------- | -------------------------------------------------------------- |
| `User`             | shop     | email, password, role                                          |
| `Product`          | shop     | name, description, price, stock, mainImageId                   |
| `Order`            | shop     | userId, status, idempotencyKey, paymentId                      |
| `OrderItem`        | shop     | orderId, productId, quantity, priceAtPurchase                  |
| `FileRecord`       | shop     | originalName, s3Key, mimeType, size, status, productId, userId |
| `ProcessedMessage` | shop     | messageId, eventName, processedAt                              |
| `Payment`          | payments | paymentId, orderId, amount, currency, status                   |

### 3.3 Migration safety

No migration needed — columns stay the same, only the TypeScript class hierarchy changes. Verify with `npm run type-check`.

### 3.4 Tasks

- [ ] Create `BaseEntity` in `libs/common/src/database/`
- [ ] Update all 7 entities to extend `BaseEntity`
- [ ] Remove duplicated `id`, `createdAt`, `updatedAt` from each entity
- [ ] Verify no migration diff: `typeorm migration:generate` should produce empty
- [ ] Run full test suite

---

## Phase 4 — App-specific extensions

### 4.1 Shop-specific TypeORM logger

The shop version of `CustomTypeOrmLogger` calls `incrementQueryCount()` for the AsyncLocalStorage-based query tracking. This is shop-specific behavior.

**Approach**: `libs/common` provides the base logger. Shop extends it:

```typescript
// libs/common/src/database/logger/custom-typeorm-logger.ts
export class CustomTypeOrmLogger implements Logger {
  // Base logging — no query counting
}

// apps/shop/src/db/logger/index.ts
import { CustomTypeOrmLogger } from '@app/common';

export class ShopTypeOrmLogger extends CustomTypeOrmLogger {
  logQuery(query, parameters) {
    super.logQuery(query, parameters);
    incrementQueryCount(); // shop-specific
  }
}
```

### 4.2 Shop-specific utils

`simulateExternalService()` stays in `apps/shop/src/utils/misc.ts` — it's test/dev tooling specific to shop.

### 4.3 App-specific config

Each app keeps its own `config/typeORM.ts` because entity imports differ. But the factory/adapter logic is shared via `@app/common`.

```typescript
// apps/shop/src/config/typeORM.ts
import { DatabaseAdapterFactory, BasePostgresAdapter } from '@app/common';
import { NeonAdapter } from '@/db/adapters/neon'; // shop-only

DatabaseAdapterFactory.register([
  new PostgresAdapter(...shopEntities),
  new NeonAdapter(...shopEntities), // shop-only adapter
]);
```

### 4.4 Tasks

- [ ] Extract base `CustomTypeOrmLogger` to `@app/common`
- [ ] Create `ShopTypeOrmLogger extends CustomTypeOrmLogger` in shop
- [ ] Keep `simulateExternalService()` in shop only
- [ ] Keep `NeonAdapter` in shop only
- [ ] Keep `graceful-shutdown.ts` in shop only (payments uses gRPC server shutdown)
- [ ] Verify both apps still build and pass tests

---

## Phase 5 — Shared DTOs and types

### 5.1 Pagination

Cursor pagination pattern is used in orders (REST + GraphQL) and will be needed for products, users, etc.

```typescript
// libs/common/src/dto/pagination.dto.ts
export class CursorPaginationDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}

export class CursorPaginationResponse<T> {
  data: T[];
  nextCursor: string | null;
  limit: number;
}
```

### 5.2 Common response wrapper

```typescript
// libs/common/src/dto/response.dto.ts
export class DataResponse<T> {
  data: T;
}
```

### 5.3 Tasks

- [ ] Create shared pagination DTOs in `@app/common`
- [ ] Create shared response wrapper
- [ ] Refactor `FindOrdersFilterDto` to extend `CursorPaginationDto`
- [ ] Apply to future product listing, user listing endpoints
- [ ] Verify type compatibility

---

## Phase 6 — CI and build validation

### 6.1 Build order

NestJS handles library compilation before apps automatically via `nest build`. Verify:

- `nest build shop` compiles `libs/common` first
- `nest build payments` compiles `libs/common` first

### 6.2 Test configuration

Update `jest.config.js` module name mapping:

```javascript
moduleNameMapper: {
  '^@app/common(.*)$': '<rootDir>/libs/common/src$1',
}
```

### 6.3 Docker build

Already handled in Phase 2. Verify no regressions after later phases.

### 6.4 ESLint

Ensure `libs/common/src/` is included in lint scope.

### 6.5 Tasks

- [ ] Verify `nest build` compiles library → apps in correct order
- [ ] Update `jest.config.js` with `@app/common` module mapping
- [ ] Verify Docker build still passes (Dockerfile changes delivered in Phase 2)
- [ ] Update ESLint config to include `libs/`
- [ ] Verify CI pipeline passes: `type-check`, `lint:ci`, `test`, `test:integration:shop`
- [ ] Verify dev compose hot-reload still works (volume mounts delivered in Phase 2)

---

## Phase 7 — Orphaned file cleanup

### 7.1 Problem statement

When `FileRecord` entities are replaced or removed (e.g., user updates avatar, product main image changes), the old file remains in both S3 and the database. Over time, this accumulates orphaned storage that costs money and clutters the bucket.

**Current behavior:**

- `UsersService.removeAvatar()` — sets `user.avatarId = null`, leaves `FileRecord` and S3 object
- `UsersService.setAvatar()` — replaces `avatarId`, old file becomes orphaned
- `ProductsService.associateMainImage()` — replaces `product.mainImageId`, old file orphaned

### 7.2 Solution: Scheduled cleanup with `@nestjs/schedule`

Use a cron job that periodically scans for orphaned `FileRecord` rows and deletes them from S3 + database.

**Advantages:**

- Simple implementation, no new infrastructure
- Decoupled from request path (no risk of partial failure affecting user)
- Configurable grace period prevents accidental deletions
- Works well for low-to-medium traffic (< 100 orphans/day)

**Trade-offs:**

- Polling overhead (runs even if no orphans exist)
- Delayed cleanup (files sit in storage until next cron run)
- Not suitable for high-scale (use queue-based approach for > 1k orphans/day)

### 7.3 High-level design

- `ScheduleModule.forRoot()` enabled in `AppModule`
- New `FileCleanupService` in `files/` domain with a `@Cron(EVERY_DAY_AT_3AM)` method
- New `S3Service.deleteObject()` method for S3 object removal
- Configurable grace period via `FILE_CLEANUP_GRACE_PERIOD_HOURS` env var (default: 24)

#### Orphan detection strategy

**Phase A — simple:** Find `FileRecord` rows where `entityId IS NULL`, `status = READY`, and `completedAt` older than the grace period.

**Phase B — entity-aware:** Use `LEFT JOIN` against `users.avatar_id` and `products.main_image_id` to find files that are no longer referenced by any entity, even if `entityId` was originally set.

#### Deletion order

1. Delete S3 object first
2. Delete DB record after successful S3 deletion
3. On S3 failure: log error, skip DB deletion, continue to next file

### 7.4 Testing strategy

- **Unit:** Mock repository + S3, verify correct files are deleted, verify error handling per-file
- **Integration:** Seed orphaned `FileRecord` rows, manually trigger cleanup method, verify DB cleanup (S3 mocked)

### 7.5 Tasks

- [ ] Install `@nestjs/schedule` package
- [ ] Enable `ScheduleModule.forRoot()` in `AppModule`
- [ ] Create `FileCleanupService` with `@Cron()` method
- [ ] Add `deleteObject()` to `S3Service`
- [ ] Register `FileCleanupService` in `FilesModule`
- [ ] Add `FILE_CLEANUP_GRACE_PERIOD_HOURS` to env schema + `.env.example` / `.env.development`
- [ ] Write unit tests for cleanup logic
- [ ] Write integration test (manual trigger, mocked S3)
- [ ] Add logging for cleanup summary (deleted/failed counts)
- [ ] Document cleanup behavior in `docs/architecture/files-s3.md`

### 7.6 Future enhancements

- **Soft-delete with grace period:** Add `markedForDeletionAt` column, support file recovery
- **Queue-based cleanup:** Switch to RabbitMQ for event-driven cleanup at high scale
- **Admin endpoint:** Manual trigger for on-demand cleanup
- **Stale PENDING cleanup:** Delete `FileRecord` rows stuck in `PENDING` beyond a threshold (upload never completed)

---

## What NOT to share

| Item                        | Reason to keep separate                         |
| --------------------------- | ----------------------------------------------- |
| `AppModule`                 | Each app has different dependencies             |
| `config/typeORM.ts`         | Different entity imports per app                |
| `NeonAdapter`               | Shop-only database adapter                      |
| `graceful-shutdown.ts`      | Shop-specific (HTTP vs. gRPC lifecycle differs) |
| `simulateExternalService()` | Dev/test utility, shop-specific                 |
| Migrations                  | Each app owns its own migration history         |
| Proto files                 | Build artifact, app-specific                    |
| Health indicators           | Service-specific checks                         |

---

## Implementation order

```
Phase 1 (Create libs/common)    ← Foundation — must be first
  ↓
Phase 2 (Docker & Compose)      ← MUST ship with Phase 1 — containers break without it
  ↓
Phase 3 (Base entity)           ← Quick win, zero migration risk
  ↓
Phase 4 (App-specific ext.)     ← Clean separation of common vs. specific
  ↓
Phase 5 (Shared DTOs)           ← Builds on library, used by future features
  ↓
Phase 6 (CI/build validation)   ← Final verification, catches regressions
  ↓
Phase 7 (Orphaned file cleanup) ← Independent feature, can be done anytime after libs/common
```

## Estimated reduction

**Code duplication (Phases 1-6):**

- **~15 files** removed across both apps (replaced by single shared source)
- **~600-800 lines** of duplicated code eliminated
- Future features (products CRUD, users CRUD) get pagination/base entity for free

**Operational improvements (Phase 7):**

- Prevents orphaned file accumulation in S3 (cost savings)
- Automated cleanup reduces manual intervention
- Configurable grace period prevents accidental deletions
