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

## Phase 2 — Base entity class

### 2.1 BaseEntity

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

### 2.2 Entities to update

| Entity             | App      | Additional columns beyond base                                 |
| ------------------ | -------- | -------------------------------------------------------------- |
| `User`             | shop     | email, password, role                                          |
| `Product`          | shop     | name, description, price, stock, mainImageId                   |
| `Order`            | shop     | userId, status, idempotencyKey, paymentId                      |
| `OrderItem`        | shop     | orderId, productId, quantity, priceAtPurchase                  |
| `FileRecord`       | shop     | originalName, s3Key, mimeType, size, status, productId, userId |
| `ProcessedMessage` | shop     | messageId, eventName, processedAt                              |
| `Payment`          | payments | paymentId, orderId, amount, currency, status                   |

### 2.3 Migration safety

No migration needed — columns stay the same, only the TypeScript class hierarchy changes. Verify with `npm run type-check`.

### 2.4 Tasks

- [ ] Create `BaseEntity` in `libs/common/src/database/`
- [ ] Update all 7 entities to extend `BaseEntity`
- [ ] Remove duplicated `id`, `createdAt`, `updatedAt` from each entity
- [ ] Verify no migration diff: `typeorm migration:generate` should produce empty
- [ ] Run full test suite

---

## Phase 3 — App-specific extensions

### 3.1 Shop-specific TypeORM logger

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

### 3.2 Shop-specific utils

`simulateExternalService()` stays in `apps/shop/src/utils/misc.ts` — it's test/dev tooling specific to shop.

### 3.3 App-specific config

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

### 3.4 Tasks

- [ ] Extract base `CustomTypeOrmLogger` to `@app/common`
- [ ] Create `ShopTypeOrmLogger extends CustomTypeOrmLogger` in shop
- [ ] Keep `simulateExternalService()` in shop only
- [ ] Keep `NeonAdapter` in shop only
- [ ] Keep `graceful-shutdown.ts` in shop only (payments uses gRPC server shutdown)
- [ ] Verify both apps still build and pass tests

---

## Phase 4 — Shared DTOs and types

### 4.1 Pagination

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

### 4.2 Common response wrapper

```typescript
// libs/common/src/dto/response.dto.ts
export class DataResponse<T> {
  data: T;
}
```

### 4.3 Tasks

- [ ] Create shared pagination DTOs in `@app/common`
- [ ] Create shared response wrapper
- [ ] Refactor `FindOrdersFilterDto` to extend `CursorPaginationDto`
- [ ] Apply to future product listing, user listing endpoints
- [ ] Verify type compatibility

---

## Phase 5 — CI and build validation

### 5.1 Build order

NestJS handles library compilation before apps automatically via `nest build`. Verify:

- `nest build shop` compiles `libs/common` first
- `nest build payments` compiles `libs/common` first

### 5.2 Test configuration

Update `jest.config.js` module name mapping:

```javascript
moduleNameMapper: {
  '^@app/common(.*)$': '<rootDir>/libs/common/src$1',
}
```

### 5.3 Docker build

Update `Dockerfile` to include `libs/` directory in COPY steps:

```dockerfile
COPY libs/ libs/
```

### 5.4 ESLint

Ensure `libs/common/src/` is included in lint scope.

### 5.5 Tasks

- [ ] Verify `nest build` compiles library → apps in correct order
- [ ] Update `jest.config.js` with `@app/common` module mapping
- [ ] Update `Dockerfile` (both `Dockerfile` and `Dockerfile.dev`) to copy `libs/`
- [ ] Update ESLint config to include `libs/`
- [ ] Verify CI pipeline passes: `type-check`, `lint:ci`, `test`, `test:integration:shop`
- [ ] Update `docker-compose.yml` volume mounts for dev (hot reload)

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
Phase 2 (Base entity)           ← Quick win, zero migration risk
  ↓
Phase 3 (App-specific ext.)     ← Clean separation of common vs. specific
  ↓
Phase 4 (Shared DTOs)           ← Builds on library, used by future features
  ↓
Phase 5 (CI/build validation)   ← Final verification, catches regressions
```

## Estimated reduction

- **~15 files** removed across both apps (replaced by single shared source)
- **~600-800 lines** of duplicated code eliminated
- Future features (products CRUD, users CRUD) get pagination/base entity for free
