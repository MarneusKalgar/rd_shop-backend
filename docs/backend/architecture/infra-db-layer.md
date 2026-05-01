# rd_shop — Database Layer

## Shop entities & relationships

```
User ──< Order ──< OrderItem >── Product ──< ProductReview >── User
     │
     ├──|| Cart ──< CartItem >── Product
     ├──< RefreshToken
     ├──< EmailVerificationToken
     ├──< PasswordResetToken
     ├──< FileRecord (ownerId, ON DELETE CASCADE)
     └──o FileRecord (avatarId, ON DELETE SET NULL)

Product ──o FileRecord (mainImageId, ON DELETE SET NULL)

ProcessedMessage  (worker idempotency table)
AuditLog          (append-only audit table; actorId/targetId are logical refs, no FK)
```

| Domain    | Entity                   | Table                       | PK   | Key relations / notable columns                                                                                                                                             |
| --------- | ------------------------ | --------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users     | `User`                   | `users`                     | uuid | email unique, password nullable/select:false, avatarId FK → `file_records`, roles text[], scopes text[], soft-delete `deletedAt`                                            |
| Auth      | `RefreshToken`           | `refresh_tokens`            | uuid | userId FK → `users` CASCADE, tokenHash, expiresAt, revokedAt; active-token index on `(userId, revokedAt)`                                                                   |
| Auth      | `EmailVerificationToken` | `email_verification_tokens` | uuid | userId FK → `users` CASCADE, tokenHash, expiresAt, usedAt                                                                                                                   |
| Auth      | `PasswordResetToken`     | `password_reset_tokens`     | uuid | userId FK → `users` CASCADE, tokenHash, expiresAt, usedAt                                                                                                                   |
| Cart      | `Cart`                   | `carts`                     | uuid | userId one-to-one owner, CASCADE on user delete, `items` one-to-many                                                                                                        |
| Cart      | `CartItem`               | `cart_items`                | uuid | cartId FK → `carts` CASCADE, productId FK → `products` RESTRICT, unique `(cartId, productId)`, quantity                                                                     |
| Catalog   | `Product`                | `products`                  | uuid | title unique, price decimal(12,2), stock int, isActive bool, category enum, mainImageId FK → `file_records` nullable, soft-delete `deletedAt`                               |
| Catalog   | `ProductReview`          | `product_reviews`           | uuid | productId FK → `products` CASCADE, userId FK → `users` CASCADE, rating smallint with `CHECK 1..5`, unique `(userId, productId)`                                             |
| Files     | `FileRecord`             | `file_records`              | uuid | key, bucket, contentType, size bigint, status enum (PENDING/READY), visibility enum (PRIVATE/PUBLIC), ownerId FK → `users` CASCADE, `entityId` is logical association field |
| Orders    | `Order`                  | `orders`                    | uuid | userId FK → `users` CASCADE, status enum, idempotencyKey unique nullable, paymentId unique nullable, shipping snapshot columns                                              |
| Orders    | `OrderItem`              | `order_items`               | uuid | orderId FK → `orders` CASCADE, productId FK → `products` RESTRICT, quantity, priceAtPurchase decimal(12,2)                                                                  |
| Messaging | `ProcessedMessage`       | `processed_messages`        | uuid | messageId unique, idempotencyKey partial unique nullable, orderId varchar nullable, processedAt, scope                                                                      |
| Audit     | `AuditLog`               | `audit_logs`                | uuid | action/outcome enums in app code, actorId/targetId/correlationId/ip/userAgent stored as scalar columns, append-only audit record                                            |

## Payments service schema

Payments runs against a separate PostgreSQL database, so it cannot hold a foreign key to `shop.orders`. The link back to an order is application-level via `payments.order_id`.

| Entity    | Table      | PK   | Key relations / notable columns                                                                                                               |
| --------- | ---------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Payment` | `payments` | uuid | `orderId` unique (logical reference to shop order), `paymentId` unique, `status` smallint enum, `amount` decimal(12,2), `currency` varchar(3) |

## Order status flow

`PENDING` → `PROCESSED` (worker) → `PAID` (after gRPC Authorize)  
Also: `CREATED`, `CANCELLED`

## Migrations

- **Shop:** `apps/shop/src/db/migrations/` — 14+ sequential TS files
- **Payments:** `apps/payments/src/db/migrations/` — 2 migrations (init + unique index)
- `migrationsRun: false` in BasePostgresAdapter (NestJS module never auto-runs them)
- Integration tests run them manually via separate `DataSource` before app boot

## DatabaseAdapterFactory / adapter pattern

**Why:** Dev commonly uses local Postgres. The adapter layer also keeps support for Neon-style managed Postgres endpoints, but the current deployed AWS stacks use standard PostgreSQL connections (`ec2-postgres` on stage, `rds` in production).

| Adapter         | Detects                                   | Priority   |
| --------------- | ----------------------------------------- | ---------- |
| NeonAdapter     | `neon.tech` or `.neon.` in DATABASE_URL   | 10 (first) |
| PostgresAdapter | localhost / 127.0.0.1 / postgres hostname | 5          |

`DatabaseAdapterFactory.create()` auto-detects from DATABASE_URL when possible.  
`DatabaseAdapterFactory.create('neon')` explicit Neon selection.

Current AWS deploys select the standard Postgres path; Neon remains a supported option, not the active production backend.

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

Idempotent scripts in `apps/shop/src/db/seed/`.

- `runner.ts` holds the shared `runSeed()` body plus two wrappers: `seedWithProductionGuard()` and `seedStage()`.
- `ALLOW_SEED_IN_PRODUCTION` is a permission flag for the guarded production seed entrypoint. It means "allow production writes for this seed run" and should stay `false` for normal service runtime.
- `DEPLOYMENT_ENVIRONMENT` is a stack identity marker emitted by Pulumi runtime config (`development`, `stage`, `production`, ...). It tells the app which deployed environment it is running in.
- Stage deploy uses the dedicated `stage.ts` entrypoint, which asserts `DEPLOYMENT_ENVIRONMENT=stage` and does not depend on `ALLOW_SEED_IN_PRODUCTION`.
- Generic production/manual seed flows use the `prod.ts` entrypoint, which requires `ALLOW_SEED_IN_PRODUCTION=true`.
