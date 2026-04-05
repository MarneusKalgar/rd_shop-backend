# rd_shop — Database Layer

## Shop entities & relationships

```
User ──< Order ──< OrderItem >── Product
                                    │
FileRecord <── Product.mainImageId  │  (ON DELETE SET NULL)
     │
     └── ownerId → User (ON DELETE CASCADE)

ProcessedMessage  (standalone idempotency table)
```

| Entity           | Table                | PK   | Notable columns                                                                                                |
| ---------------- | -------------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| User             | `users`              | uuid | email (unique), password (nullable), roles text[], scopes text[]                                               |
| Order            | `orders`             | uuid | userId FK, status enum, idempotencyKey (unique nullable), paymentId (unique nullable)                          |
| OrderItem        | `order_items`        | uuid | orderId FK CASCADE, productId FK RESTRICT, quantity, priceAtPurchase decimal(12,2)                             |
| Product          | `products`           | uuid | title (unique), price decimal(12,2), stock int, isActive bool, mainImageId FK→FileRecord nullable              |
| FileRecord       | `file_records`       | uuid | key, bucket, contentType, size bigint, status (PENDING/READY), visibility (PRIVATE/PUBLIC), ownerId FK CASCADE |
| ProcessedMessage | `processed_messages` | uuid | messageId (unique), idempotencyKey (unique partial), orderId, scope                                            |

## Order status flow

`PENDING` → `PROCESSED` (worker) → `PAID` (after gRPC Authorize)  
Also: `CREATED`, `CANCELLED`

## Migrations

- **Shop:** `apps/shop/src/db/migrations/` — 14+ sequential TS files
- **Payments:** `apps/payments/src/db/migrations/` — 2 migrations (init + unique index)
- `migrationsRun: false` in BasePostgresAdapter (NestJS module never auto-runs them)
- Integration tests run them manually via separate `DataSource` before app boot

## DatabaseAdapterFactory / adapter pattern

**Why:** Dev uses local Postgres; prod uses Neon (serverless Postgres with different SSL/pooling needs).

| Adapter         | Detects                                   | Priority   |
| --------------- | ----------------------------------------- | ---------- |
| NeonAdapter     | `neon.tech` or `.neon.` in DATABASE_URL   | 10 (first) |
| PostgresAdapter | localhost / 127.0.0.1 / postgres hostname | 5          |

`DatabaseAdapterFactory.create()` auto-detects from DATABASE_URL.  
`DatabaseAdapterFactory.create('neon')` explicit selection.

Both implement `IDatabaseAdapter`: `getDataSourceOptions()`, `getModuleOptions()`, `validateConfig()`.

`getModuleOptions()` returns options **without** `migrations` key + `migrationsRun: false` (for NestJS TypeOrmModule).

## getTypeOrmPaths()

`apps/shop/src/config/typeORM.ts` — also identical copy in `apps/payments/src/config/typeORM.ts`

```typescript
// Dev
{ entities: ['src/**/*.entity{.ts,.js}'], migrations: ['src/db/migrations/*{.ts,.js}'] }

// Prod (resolved relative to dist/apps/<app>/main.js)
{ entities: ['../../dist/apps/<app>/**/*.entity.js'], migrations: ['../../dist/apps/<app>/db/migrations/*.js'] }
```

## Environment / config loading

- `getEnvFile()` → `.env.${NODE_ENV}` (e.g., `.env.development`, `.env.test`)
- `EnvironmentVariables` class in `core/environment/schema.ts` validated via `class-validator` on startup
- `DEFAULT_VALUES` in `core/environment/constants.ts`

## Seed

Idempotent scripts in `apps/shop/src/db/seed/`. Production-guarded by `ALLOW_SEED_IN_PRODUCTION` env var.
