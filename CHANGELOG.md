# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.4] - 2026-04-20

### Added

- **Proto contract testing** — `proto/buf.yaml` (buf module config; `lint.except` for 4 NestJS-incompatible rules: `PACKAGE_DIRECTORY_MATCH`, `PACKAGE_VERSION_SUFFIX`, `SERVICE_SUFFIX`, `ENUM_VALUE_PREFIX`) and `proto/buf.breaking.yaml` (`WIRE_JSON` rule set) added to the repo; `bufbuild/buf-setup-action@v1` + `buf lint` + `buf breaking --against '../.git#branch=main,subdir=proto'` gate added to the `code-quality` CI composite action — any wire-breaking proto change now fails the PR
- **Unit test coverage reporting** — `collectCoverageFrom` moved from root-level into each Jest project (`shop`, `payments`) so the project runner actually collects coverage; `coverageReporters: ['text', 'lcov', 'json-summary']` added at root; `npm run test:cov` now produces non-zero numbers
- **Integration test coverage** — `npm run test:integration:shop:cov` script; `jest-integration.json` `rootDir` corrected from `"."` (test/) to `".."` (apps/shop/) so `src/**/*` globs resolve; `coverageDirectory: '../../coverage-integration'` and `coverageReporters` added to `jest-integration.json`
- **CI coverage artifacts** — `code-quality` composite action prints unit `coverage-summary.json`; `integration-tests` job prints integration summary and uploads `coverage-integration/` as a build artifact with 7-day retention

### Removed

- **`.bufignore`** — no longer needed; buf scope is contained by `proto/buf.yaml` being placed inside the `proto/` directory (buf treats `proto/` as the module root when invoked via `cd proto && buf ...`)

### Fixed

- **`jest-integration.json` `rootDir`** — was `"."` (resolved to `apps/shop/test/`) causing `moduleNameMapper`, `setupFiles`, and `collectCoverageFrom` paths to be wrong; corrected to `".."` (resolves to `apps/shop/`)

## [0.2.3] - 2026-04-20

### Added

- **`OrdersCommandService`** — extracted from `orders.service.ts` god class; owns `createOrder` and `cancelOrder` with all transaction logic, idempotency, stock mutation, and event emission
- **`OrdersQueryService`** — read-only query handler: `findOrdersWithFilters`, `getOrderById`, `getOrderPayment`; constructor reduced to 3 deps (`OrdersRepository`, `OrdersQueryBuilder`, `PaymentsGrpcService`)
- **`OrderProcessingService`** — worker-path processing extracted from the god class; `processOrderMessage` and `authorizePayment` now live in their own service, callable only by `OrderWorkerService`
- **`OrderStockService`** — isolated stock operations: pessimistic locking, availability validation, stock decrement (`createOrder`), stock restore (`cancelOrder`), and `validateExist` pre-check
- **`OrderPublisherService`** — thin RabbitMQ wrapper; publishes `OrderProcessMessageDto` with `messageId`
- **`PgErrorMapperService`** — maps PostgreSQL error codes (`57014`, `55P03`, `23505`, `23503`) to NestJS domain exceptions
- **`applyTransactionTimeouts(manager)`** util in `orders/utils/index.ts` — sets `SET LOCAL statement_timeout = 30000` and `SET LOCAL lock_timeout = 10000`; replaces duplicated inline `SET LOCAL` blocks in both transaction methods
- **`validateOrderItems(items)`** util — fast-fail quantity validation extracted from `OrdersCommandService` to `orders/utils/index.ts`; runs before any transaction is opened
- **`OrderStockService.validateExist(productIds)`** — product existence pre-check moved from `OrdersCommandService.validateProductsExist` to `OrderStockService`; `ProductsRepository` dep removed from command service
- **`executeCancelTransaction(orderId, userId)`** private method in `OrdersCommandService` — encapsulates the full cancel transaction body (ownership assertion, stock restore, status update, relation reload)
- **`apps/shop/src/orders/utils/index.spec.ts`** — 26 unit test cases across 5 suites: `assertOrderOwnership`, `getTotalSumInCents`, `validateOrderItems`, `buildOrderNextCursor`, `applyTransactionTimeouts`
- **JSDoc** — all 5 exports in `orders/utils/index.ts`, class + method JSDoc in `OrdersQueryService`, `OrdersCommandService`, and `OrdersService` facade
- **Architecture docs** — `docs/backend/architecture/feature-order-creation-flow.md` and `feature-order-querying-flow.md` updated with services hierarchy trees and corrected pseudocode

### Changed

- **`orders.service.ts`** — converted to a 53-line backward-compat facade; delegates all methods to `OrdersCommandService` or `OrdersQueryService` via constructor injection; existing callers (`OrdersController`, `CartService`, `OrdersResolver`) unchanged
- **`OrdersCommandService`** — reduced from 809-line god class to 263 LOC, 8 constructor deps (down from 11); `ProductsRepository` dep removed after `validateExist` migration to `OrderStockService`
- **`order-stock.service.spec.ts`** — added `findByIds` mock and `validateExist` suite (4 tests)
- **`orders-command.service.spec.ts`** — removed `ProductsRepository` provider; replaced `productsFindByIds` mock with `validateExist` on `OrderStockService` mock; `makeAuthUser` typed as `Partial<AuthUser>` with `roles: []` and `scopes: []` defaults

## [0.2.2] - 2026-04-17

### Added

- **Performance testing infra** — `compose.perf.yml` isolated stack (`shop-perf` at 0.5 vCPU / 512 MiB, `postgres-perf` with `pg_stat_statements` + tmpfs, `rabbitmq-perf`, `grpc-stub-perf`, `migrate-perf`, `seed-perf`); profile-based activation (`app`, `app-grpc-breaker`, `migrate`, `seed`)
- **k6 load scenarios** — 10 scripts covering product-search, order-flow, auth-flow, signin-stress, and circuit-breaker before/after variants; configurable via `PERF_K6_VUS` / `PERF_K6_DURATION` env vars
- **Testcontainers Tier 1 specs** — `product-search.perf.ts`, `cursor-pagination.perf.ts`, `order-creation.perf.ts`, `order-cancel.perf.ts`, `token-hmac.perf.ts`; each validates exact SQL call counts via `pg_stat_statements` and EXPLAIN plan index usage
- **`grpc-stub-perf` service** — controllable gRPC stub that hangs all RPCs; used to isolate B3 circuit-breaker before-state measurement
- **Bash lifecycle scripts** — `perf-migrate.sh`, `perf-seed.sh`, `perf-app-grpc-breaker.sh`
- **`performance-evidences/`** — `before-after-table.md` + 7 B3 RabbitMQ/k6 screenshots
- **`homework-report.md`** — full performance report: baseline, bottlenecks, improvements, trade-offs, acceptance criteria checklist
- **`docs/backend/architecture/test-performance.md`** — performance testing infra documentation

### Changed

- **A1** — GIN trigram index on `products.name` / `products.description`; search p95 −26 % (293→216 ms), DB scans −80 % (5→1 SQL call)
- **A2** — Cursor pagination decoded in-memory (`id|epochMs` format); page-2 DB calls −50 % (2→1)
- **A3** — Removed post-INSERT re-fetch inside `executeOrderTransaction`; order create p99 −60 % (1797→726 ms)
- **A4** — Explicit `DB_POOL_SIZE` env var wired to TypeORM `extra.max`; pool enforced at 5 in perf env
- **B1** — `bcrypt` → `bcryptjs` on auth path; signin p95 −17 %, event loop blocking frequency halved
- **B2** — Manual `process.on('SIGTERM', …)` handler; container exit 143 → 0 (clean shutdown, `app.close()` runs)
- **B3** — `opossum` circuit breaker on `PaymentsGrpcService.authorize`; queue drain reversed (+33 msg/s growth → fully cleared), worker stall ~21 s → ~0 ms fast-fail after breaker opens
- **B4** — Conditional relation loading in `cancelOrder`; order cancel p95 −25 % (218→164 ms)
- **B5** — HMAC-SHA256 replaces bcrypt for opaque token hashing in `TokenService`; token op cost ~100 ms → ~1 µs; auth refresh p99 −21 %

### Removed

- `@tygra/nestjs-graceful-shutdown` library integration (non-functional due to Apollo/GraphQL module conflict); replaced by manual SIGTERM handler
- `src/config/graceful-shutdown.ts` — library config file, no longer needed

## [0.2.1] - 2026-04-09

### Added

- **Audit log** — `AuditLogEvent` entity and `AuditLogService.log()` wired across 10 domain actions: `USER_SIGNIN`, `USER_SIGNUP`, `USER_SOFT_DELETED`, `USER_ROLE_CHANGED`, `USER_SCOPE_CHANGED`, `ORDER_CREATED`, `ORDER_CANCELLED`, `ORDER_IDEMPOTENT_HIT`, `ORDER_CREATION_FAILED`, `ORDER_PAYMENT_AUTHORIZED`, `ORDER_PAYMENT_FAILED`; `correlationId` propagated from `genReqId` via `extractAuditContext(req)`
- **`actorRole` population** — Admin-only audit events (`USER_SOFT_DELETED`, `USER_ROLE_CHANGED`, `USER_SCOPE_CHANGED`) capture the acting admin's roles at event time via `actor?.roles.join(',')`
- **`GqlThrottlerGuard`** — Extends `ThrottlerGuard`; detects context type (`graphql` vs HTTP) and calls the correct `getRequestResponse` path; constructor re-declares `@InjectThrottlerOptions()` / `@InjectThrottlerStorage()` so NestJS DI resolves custom tokens on the subclass
- **Global rate limiting** — `APP_GUARD` switched from `ThrottlerGuard` to `GqlThrottlerGuard`; covers both REST and GraphQL endpoints
- **`SECURITY-BASELINE.md`** — OWASP ASVS mapping, threat model, all wired audit events, rate-limit evidence, HSTS configuration
- **`infra-security.md`** — Architecture-level security design decisions: audit schema, `actorRole`, worker-path null context, guard topology
- **Security evidence** — `security-evidence/` directory with `headers.txt`, `rate-limit.txt`, `audit-log-example.txt`, `secret-flow-note.md`, `tls-note.md`
- **`REQUEST_ID_HEADER` constant** — `apps/shop/src/common/constants/index.ts`; replaces all `'x-request-id'` hardcodes

### Changed

- **`cancelOrder` signature** — Accepts `user: AuthUser` instead of separate `userId: string` + `userEmail: string`; controller passes the full `AuthUser` object
- **`CartService.checkout`** — Added `context?: AuditEventContext` parameter; forwards context to `ordersService.createOrder` so cart-initiated orders carry a correlationId
- **Helmet `frameguard`** — Explicitly set to `{ action: 'deny' }` (was inheriting Helmet's `SAMEORIGIN` default)
- **`@CreateDateColumn` type** — `audit-log.entity.ts` `created_at` uses `type: 'timestamptz'` for timezone-aware storage
- **Migration `CreateAuditLogs`** — `created_at` column changed from `TIMESTAMP` to `TIMESTAMP WITH TIME ZONE`
- **`tsconfig.json`** — Added `"types": ["jest", "node"]` (Jest globals in all spec files), `"strictPropertyInitialization": false` (DTO/entity class fields), `"ignoreDeprecations": "6.0"` (suppress `moduleResolution: node` / `baseUrl` TypeScript 6 deprecation warnings)
- **`logger.ts`** — `genReqId` reads/writes `req.headers[REQUEST_ID_HEADER]` instead of hardcoded `'x-request-id'`
- **Integration test throttler** — `graphql-orders-pagination.integration-spec.ts` overrides `getOptionsToken()` with limits of 10 000 req/window so test requests never trigger throttling
- **`SECURITY-BASELINE.md` links** — All relative links corrected to `../security-evidence/`; HSTS `max-age` updated to `31536000`

### Fixed

- **`users.service.spec.ts`** — Added missing `AuditLogService` mock provider; test module now compiles without DI errors
- **`infra-security.md` broken link** — `SECURITY-BASELINE.md` reference corrected to `../../../security-homework/SECURITY-BASELINE.md`
- **`rate-limit.txt`** — Updated to demonstrate 200 → 429 progression with valid credentials (not 400 → 429)

## [0.2.0] - 2026-03-28

### Added

- **`libs/common` shared library** — NestJS library (`@app/common`) extracted from duplicated code across `shop` and `payments`; registered in `nest-cli.json` as `type: "library"`
- **Shared config** — `config/logger.ts` (log-level utility) moved to `@app/common/config`
- **Shared database layer** — adapter base, factory, interfaces, `postgres-local`, and `CustomTypeOrmLogger` (base, no query counting) moved to `@app/common/database`
- **Shared environment utilities** — `getEnvFile()` added to `@app/common/environment/utils`; `createValidate<T>(cls)` factory added to `@app/common/environment/validate`; `InjectConfig` decorator in `@app/common/environment`
- **Shared utils** — `isProduction`/`isDevelopment` helpers and `omit()` moved to `@app/common/utils`
- **`ShopTypeOrmLogger`** — `apps/shop/src/db/logger` now extends `CustomTypeOrmLogger` from `@app/common` and adds `incrementQueryCount()` call

### Changed

- **`apps/shop` and `apps/payments` validation** — `validation.ts` in each app reduced to `export const validate = createValidate(EnvironmentVariables)`; `getEnvFile` and `InjectConfig` re-exported via `core/environment/index.ts` from `@app/common/environment`
- **tsconfig `@app/common` path** — Both app tsconfigs resolve `@app/common` to `dist/libs/common` first (declarations only, keeps `rootDir` scoped to `src/`) with `libs/common/src` as fallback for `ts-node`/IDE
- **`libs/common/tsconfig.lib.json`** — Added `rootDir: "src"` and `outDir: "../../dist/libs/common"` so the library compiles to `dist/libs/common/` without `src/` nesting
- **`start:dev` scripts** — Both app `package.json` `start:dev` scripts now run `nest build common` before starting the watcher to ensure `dist/libs/common/*.d.ts` exist
- **Dockerfile** — Added `COPY libs ./libs` to `build` stage; added `nest build common` step before app build; added `dist/node_modules/@app/common` symlink for runtime resolution
- **`apps/shop/compose.dev.yml`** — Added `../../libs:/app/libs` bind mount to `shop`, `migrate`, and `seed` services
- **`apps/payments/compose.dev.yml`** — Added `../../libs:/app/libs` bind mount to `payments` and `migrate` services
- **Docker env file exclusion** — `.dockerignore` updated to `**/.env.production`; Dockerfile `build` stage runs `find apps -name ".env*" -not -name ".env.example" -delete` after `COPY apps`
- **`jest.config.js`** — Added `@app/common` module name mapper to both `shop` and `payments` projects
- **`apps/shop/test/jest-integration.json`** — Fixed `@app/common` path (3 levels up from `rootDir`)

## [0.1.6] - 2026-03-27

### Added

- **Order Cancellation** — `POST /api/v1/orders/:orderId/cancellation` endpoint; transactional stock restoration with pessimistic locking; guards: `CANCELLED` → 409, `CREATED` → 400; ownership check via `assertOrderOwnership`; payment void/refund deferred to payments plan
- **Shipping Address on Orders** — 6 nullable snapshot columns added to `Order` entity (`shippingFirstName`, `shippingLastName`, `shippingPhone`, `shippingCity`, `shippingCountry`, `shippingPostcode`); `ShippingAddressDto` nested in `CreateOrderDto`; resolution: explicit DTO field → user profile fallback
- **Shopping Cart** — `Cart` and `CartItem` entities (1:1 user, unique `cartId+productId`); `CartService` with CRUD + checkout; `CartController` with 6 endpoints (`GET /cart`, `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id`, `DELETE /cart`, `POST /cart/checkout`); lazy cart initialization; checkout delegates to `OrdersService.createOrder` and clears cart on success
- **Email Notifications** — `@nestjs/event-emitter` integration; 3 domain events (`order.created`, `order.paid`, `order.cancelled`) emitted on status transitions; `OrderEmailListener` sends emails via `MailService` (AWS SES in prod, console log in dev); error-safe handlers — email failure never breaks order flow
- **Order Email Methods** — `sendOrderConfirmationEmail`, `sendOrderPaidEmail`, `sendOrderCancellationEmail` added to shared `MailService`
- **Event Constants** — `ORDER_CREATED_EVENT`, `ORDER_PAID_EVENT`, `ORDER_CANCELLED_EVENT` in `apps/shop/src/orders/events/index.ts`

### Changed

- **REST Order Queries Optimized** — `findByIdWithItemRelations` (no user JOIN) used for all user-facing REST endpoints; `buildMainQuery` accepts `{ withUser: false }` option; `findByIdWithRelations` (with user) preserved for GraphQL resolvers only
- **Cancellation Endpoint is REST-Noun** — Route uses `POST :orderId/cancellation` (sub-resource noun) instead of `PATCH :orderId/cancel` (verb)
- **`EventEmitterModule.forRoot()`** — Registered in `OrdersModule`; `MailModule` imported into `OrdersModule`

## [0.1.5] - 2026-03-26

### Added

- **`AdminUsersController`** — New `apps/shop/src/users/v1/admin-users.controller.ts` consolidating all admin user operations; class-level `@Roles(UserRole.ADMIN)` + `@UseGuards(JwtAuthGuard, RolesGuard, ScopesGuard)`; route `/api/v1/admin/users`; 4 endpoints each with an explicit `@Scopes()` decorator
- **`updateUserPermissions` in `UsersService`** — Absorbed from `AdminService`; uses `findUserOrFail` for consistent 404 handling; accepts `roles`, `scopes`, or both (at least one required)
- **`UpdateUserPermissionsDto` / `UpdateUserPermissionsResponseDto`** — Moved from `admin/dto/` to `users/dto/`; `roles` and `scopes` are now both optional — at least one must be provided (`@ValidateIf` + `@IsDefined` constraint)
- **`UserDataResponseDto`** — New single-user response wrapper `{ data: UserResponseDto, message?: string }` — matches the `{ data }` envelope used throughout the products domain

### Changed

- **Admin user endpoints moved to `/api/v1/admin/users`** — `GET /`, `GET /:id`, `DELETE /:id` migrated from `UsersController`; `PATCH /:id/permissions` migrated from `AdminController`; all now behind `AdminUsersController` with per-endpoint `@Scopes()` (`USERS_READ` / `USERS_WRITE`)
- **`UsersController` self-service only** — All admin endpoints and method-level `@Roles` / `@UseGuards(RolesGuard)` removed; controller now exclusively owns `/me/*` routes
- **Single-user responses wrapped in `{ data }`** — `getProfile`, `findById`, `updateProfile`, `setAvatar` now return `UserDataResponseDto` instead of flat `UserResponseDto`; list (`UsersListResponseDto`) and void responses unchanged
- **`AdminModule` simplified** — `AdminController` and `AdminService` removed; module now registers only dev-only testing controllers (`AdminTestingController`, `AdminTestingService`); `AuthModule` import removed

## [0.1.4] - 2026-03-25

### Added

- **Product Entity Extension** — `description` (text), `brand` (varchar 100), `country` (varchar 2, ISO 3166-1 alpha-2), `category` (`ProductCategory` enum, default `other`), `deletedAt` (`@DeleteDateColumn`, soft-delete) columns added to `Product` entity
- **`ProductCategory` Enum** — 11 values: `accessories`, `audio`, `cameras`, `laptops`, `monitors`, `other`, `peripherals`, `smartphones`, `storage`, `tablets`, `wearables`; stored in `products/constants/index.ts`
- **Public Products REST API** — `GET /api/v1/products` (paginated list) and `GET /api/v1/products/:id` (detail with images + rating); no auth required
- **Admin Products REST API** — `POST`, `PATCH`, `DELETE /api/v1/admin/products/:id` (create / partial update / soft-delete); guarded by `JwtAuthGuard + RolesGuard(admin) + ScopesGuard(products:write)`
- **Sorting & Filtering** — `FindProductsQueryDto` supports `sortBy` (`createdAt | price | title`), `sortOrder` (`ASC | DESC`), `minPrice`, `maxPrice`, `search` (ILIKE on title + description), `brand` (ILIKE), `country` (exact), `category` (enum exact), `isActive`, cursor + limit pagination
- **`ProductsRepository`** — Custom injectable repository encapsulating all QueryBuilder logic: cursor keyset pagination, multi-field sorting, price range, ILIKE search, brand/country/category filters; also provides `findByIds` and `findByIdsWithLock` (pessimistic write, used by order stock deduction)
- **Price Index** — `IDX_products_price` index added to `Product` entity to support price-based sorting at scale
- **Multiple Product Images** — `GET /api/v1/products/:id` response includes `images[]` array (all `READY` `FileRecord`s linked to the product via `entityId`); main image URL served separately as `mainImageUrl` and excluded from `images[]` to avoid duplication
- **Admin Image Management Endpoints** — `GET /:id/images` (list all), `POST /:id/images/:fileId` (associate a READY file), `DELETE /:id/images/:fileId` (remove association), `PATCH /:id/images/:fileId/main` (promote to main image); all behind `products:images:write` / `products:images:read` scopes
- **`ProductReview` Entity** — table `product_reviews`; columns: `id`, `productId` (FK → products CASCADE), `userId` (FK → users CASCADE), `rating` (smallint, `CHECK ("rating" BETWEEN 1 AND 5)`), `text` (varchar 1000), `createdAt`, `updatedAt`; `UNIQUE(userId, productId)` — one review per user per product
- **Reviews REST API** — `POST /api/v1/products/:id/reviews` (create, JWT required), `PATCH /api/v1/products/:id/reviews` (update own review, JWT required), `DELETE /api/v1/products/:id/reviews` (delete own review, JWT required), `GET /api/v1/products/:id/reviews` (paginated list, public); cursor pagination by `createdAt DESC, id DESC`
- **Rating Enrichment** — `averageRating` (`ROUND(AVG::numeric, 2)`, null if no reviews) and `reviewsCount` (`COUNT::int`) included in all product responses; computed on-demand via raw QueryBuilder; batch variant (`getRatingInfoBatch`) issues a single grouped query for the full product list page
- **`ReviewsService`** — Dedicated service owning all review and rating logic: `createReview`, `getReviews`, `updateReview`, `deleteReview`, `getRatingInfo`, `getRatingInfoBatch`; injects `Repository<Product>` and `Repository<ProductReview>` directly — no dependency on `ProductsService`
- **Seed Data Expansion** — Seed data expanded from 12 to 48 products with `description`, `brand`, `country`, and `category` populated for all entries; products distributed across all `ProductCategory` values
- **Architecture Documentation** — `docs/backend/architecture/products.md` covering entity graph, module wiring, all REST endpoints, image management flow, rating computation, and service/repository responsibilities

### Changed

- **`FilesService` Decoupled from `ProductsService`** — `complete-upload` (`POST /api/v1/files/complete-upload`) no longer accepts `entityType` and no longer calls `ProductsService.associateMainImage()`; file association is now an explicit client call to `POST /admin/products/:id/images/:fileId`; `FilesModule` no longer imports `ProductsModule` (circular dependency eliminated)
- **`CompleteUploadDto`** — `entityType` field removed; body is now `{ fileId }` only
- **`findById` Images Response** — Main image is excluded from `images[]` in the public product detail response; it is still returned in the admin `GET /:id/images` list (for image management UI)
- **`docs/backend/architecture/files-s3.md`** — Upload flow updated to reflect 5-step process (presign → S3 PUT → complete-upload → associate → set main); auth section updated to distinguish file-upload endpoints from admin product-image endpoints

### Security

- **No `userId` in Review Body** — Review ownership always derived from JWT (`user.sub`); users can only create, update, or delete their own review
- **Soft-Delete Integrity** — `DELETE /admin/products/:id` uses `softDelete()` — row is retained for FK integrity with `order_items`; TypeORM auto-filters deleted products from all queries

## [0.1.3] - 2026-03-25

### Added

- **Users CRUD** — Full implementation replacing all mock service methods: `getProfile`, `updateProfile`, `findAll`, `findById`, `remove`, `changePassword`
- **User Profile Fields** — `firstName`, `lastName`, `phone`, `city`, `country` (ISO 3166-1 alpha-2), `postcode` columns added to `User` entity; `AddUserProfileFields` migration
- **User Avatar** — `avatarId` UUID FK → `file_records` (ON DELETE SET NULL, indexed); `PUT /users/me/avatar` validates file ownership + S3 existence, marks READY, sets `avatarId`; `DELETE /users/me/avatar` clears the association
- **Password Change** — `PATCH /users/me/password` verifies current password via bcrypt, hashes new password, revokes all refresh tokens (forces re-login)
- **Cursor Pagination + Search** — `GET /users` (admin) supports cursor-based pagination (`createdAt DESC, id DESC`) and optional `search` query param with ILIKE on `firstName`, `lastName`, `email`; LIKE wildcards (`%`, `_`, `\`) escaped with `ESCAPE '\'` clause; `@MaxLength(100)` on search input
- **Soft-Delete** — `DELETE /users/:id` (admin) sets `deletedAt` via `@DeleteDateColumn`; TypeORM auto-filters deleted users from all queries; all refresh tokens revoked on deletion
- **Auth Guards on Users Controller** — `JwtAuthGuard` at class level; `RolesGuard` + `@Roles(ADMIN)` on admin-only endpoints (`GET /users`, `GET /users/:id`, `DELETE /users/:id`)
- **DTOs** — `UpdateProfileDto`, `ChangePasswordDto`, `SetAvatarDto`, `FindUsersDto`, `UserResponseDto`, `UsersListResponseDto`
- **GraphQL UserType** — Added `firstName`, `lastName`, `phone`, `city`, `country`, `postcode`, `avatarId`, `avatarUrl`, `isEmailVerified`, `roles` fields to `UserType` schema
- **Architecture Documentation** — `docs/backend/architecture/users.md` covering entity, endpoints, service methods, pagination, avatar flow, soft-delete, DTOs, GraphQL, security

### Changed

- **`UsersResolver`** — Temporarily dropped (REST API is the current focus); `UserLoader` remains active for `OrdersResolver.user()` field resolution
- **`FilesService.getPresignedUrlForFileId`** — Now returns `null` for non-READY files (previously returned presigned URLs for PENDING files)
- **S3 Presigned URLs** — Two `S3Client` instances: `client` (internal Docker endpoint for API operations) and `presignClient` (public endpoint for browser-accessible presigned URLs); fixes `SignatureDoesNotMatch` when MinIO internal hostname differs from browser-accessible host
- **`findUserOrFail` Helper** — Extracted repeated `findOne` + 404 pattern into private method; used by `findById`, `getProfile`, `remove`, `setAvatar`, `updateProfile`
- **`setAvatar` Ordering** — User existence check now happens before `prepareFileForEntity` to prevent orphaned READY files on missing user
- **Migration `down()` Fix** — `DROP INDEX` moved before `DROP COLUMN "avatar_id"` in `AddUserProfileFields` migration (PostgreSQL auto-drops the index with the column, so the explicit drop must come first)

### Security

- **No User-to-User Access** — Self-service endpoints always derive `userId` from JWT (`user.sub`), never from request params
- **Password Never Exposed** — `select: false` on entity column; `UserResponseDto.fromEntity()` never maps `password`
- **Search Input Sanitization** — LIKE wildcard characters escaped before query execution; parameterized queries prevent SQL injection
- **File Status Guard** — `getPresignedUrlForFileId` only returns URLs for `READY` files, preventing exposure of unverified uploads

## [0.1.2] - 2026-03-24

### Added

- **Refresh Tokens** — `TokenService` encapsulates all JWT and refresh-token operations; `RefreshToken` entity (UUID PK, `tokenHash`, `expiresAt`, `revokedAt`, `isActive` virtual getter); single-session model revokes any existing token on each sign-in or refresh
- **Cookie-Based Refresh Token** — `cookie-parser` installed and wired in `main.ts`; `Set-Cookie: refreshToken` is `HttpOnly`, `Secure` (prod), `SameSite=Strict`, scoped to the auth path prefix; token never appears in response body
- **`POST /auth/refresh`** — rotates the refresh token, sets a new cookie, returns `{ accessToken }`
- **`POST /auth/logout`** — revokes the refresh token, clears the cookie; uses `JwtAuthGuard`
- **Email Verification** — `isEmailVerified` boolean column added to `User` entity (default `false`); `EmailVerificationToken` entity (UUID PK, `tokenHash`, `expiresAt`, `usedAt`, FK → users CASCADE)
- **`POST /auth/verify-email`** — validates the token and marks the user's email as verified (unauthenticated)
- **`POST /auth/resend-verification`** — re-issues and resends the verification email; requires JWT; DB-based 1-per-minute cooldown (TODO: replace with `@nestjs/throttler`)
- **`MailModule` + `MailService`** — sends transactional email via AWS SES (`@aws-sdk/client-sesv2`); dev-mode fallback logs email content to console when `AWS_SES_REGION` is not set; supports `sendVerificationEmail`, `sendPasswordResetEmail`
- **Password Reset** — `PasswordResetToken` entity (UUID PK, `tokenHash`, `expiresAt` 1h, `usedAt`, FK → users CASCADE)
- **`POST /auth/forgot-password`** — always returns `200` (prevents user enumeration); sends reset link if account exists and rate limit (3 requests per hour per email) has not been exceeded; DB-based guard (TODO: replace with `@nestjs/throttler`)
- **`POST /auth/reset-password`** — validates token, hashes new password, marks token used, revokes all refresh tokens for the user (force re-login)
- **`UserRole` / `UserScope` Enums** — canonical string enums in `auth/permissions/constants.ts` replacing untyped `string[]`; all decorators, guards, seed data, and DTOs now use enum values
- **`UserPermissions` Factory** — deeply-frozen `UserPermissions` object (`NewUser`, `Admin`, `Support`) groups roles and scopes by persona; used in signup and `AdminTestingService`
- **Default Roles & Scopes on Signup** — new users automatically receive `USER` role and `orders:read`, `orders:write`, `files:write`, `products:read` scopes
- **Admin Permissions Endpoint** — `PATCH /api/v1/admin/users/:userId/permissions` (admin-only) for assigning/revoking roles and scopes; `userId` validated with `ParseUUIDPipe`
- **`AdminTestingController`** — `POST /api/v1/admin-testing/verified-admin` creates a verified admin user for non-production environments; controller and service are conditionally registered (not mounted in production via module-level `isProduction()` check)
- **`NodeEnvironment` Enum** — `NODE_ENV` now validated as a strict enum (`development | production | test`) in the env schema; misconfigured values (e.g. `prod`) fail at startup

### Changed

- **`POST /auth/signup`** — `confirmedPassword` field added to `SignupDto`; password-match validation in service layer; emails a verification link after registration; no tokens issued on signup (user must sign in explicitly)
- **`POST /auth/signin`** — now issues a refresh token pair and sets the `refreshToken` cookie in addition to returning `{ accessToken, user }`
- **`@Roles()` / `@Scopes()` Decorators** — parameter types narrowed from `string` to `UserRole` / `UserScope`
- **Seed Data** — all hardcoded role/scope strings normalized to `resource:action` convention using enum values

### Security

- **`parseOpaqueToken()` Hardened** — validates the `:` delimiter at position 36 and checks the UUID segment with `isUUID()` from `class-validator` before any DB lookup; malformed tokens now return `null` (→ 401) instead of bubbling a Postgres `invalid uuid syntax` 500
- **`ParseUUIDPipe` on `:orderId`** — `GET /orders/:orderId` and `GET /orders/:orderId/payment` now reject non-UUID values with 400 before reaching TypeORM
- **Production Guard at Module Level** — `AdminTestingController` and its service are absent from the DI container in production; no runtime `ForbiddenException` needed
- **`NODE_ENV` Enum Validation** — prevents a misconfigured `NODE_ENV=prod` from silently bypassing the production guard

## [0.1.1] - 2026-03-21

### Added

- **Integration Test Infrastructure** - Dedicated `apps/shop/test/integration/` directory with `jest-integration.json` config and `.integration-spec.ts` suffix; cleanly separated from the future true e2e tier (`jest-e2e.json` / `test/e2e/`)
- **`@test/*` Path Alias** - TypeScript `paths` entry and Jest `moduleNameMapper` resolving `@test/*` to `apps/shop/test/*`; enables depth-independent imports from any nested spec file
- **`test/paths.ts`** - Centralized `MIGRATIONS_GLOB` constant anchored to `apps/shop/test/`; eliminates `../../../` relative traversals regardless of how deeply a spec file is nested
- **Testing Architecture Documentation** - README `🧪 Testing` section expanded with three-tier pyramid description (Unit / Integration / e2e TBD), per-tier scope explanation, alias reference table, and updated commands

## [0.1.0] - 2026-03-19

### Added

- **GitHub Actions CI/CD Pipeline** - Four-workflow pipeline: PR checks, build & push, deploy to stage, deploy to production (see [homework17.md](homework17.md))
- **PR Checks Workflow** - Code quality gate on every pull request: lint, TypeScript type-check, unit tests with coverage upload, and Docker preview build for both services
- **Build and Push Workflow** - Triggered on push to `development`; builds both service images, pushes to GHCR with immutable `sha-<full-sha>` tag, and assembles a signed release manifest artifact
- **Deploy to Stage Workflow** - Automatically triggered after successful build; SSHs into stage VM, pulls pre-built images, runs Docker Compose, and validates deployment with three-phase smoke test (`/health`, `/ready`, `/status`)
- **Deploy to Production Workflow** - Manual `workflow_dispatch` with `run_id` + `sha` inputs; requires production environment approval gate; supports reliable rollbacks by checking out the exact commit SHA on the target VM
- **Release Manifest Artifact** - JSON artifact (`release-manifest-<sha>`) carrying image references and digests; 90-day retention; single source of truth for both deploy workflows
- **Seven Reusable Composite Actions** - `install-dependencies`, `code-quality`, `parse-release-manifest`, `deploy-to-stage`, `deploy-to-production`, `smoke-test-shop`, `write-deploy-summary`
- **Sentinel Required Check** - `All Checks Passed` job aggregates all PR check results into one branch-protection entry
- **CI/CD Documentation** - Pipeline architecture, action dependency maps, artifact flow, secrets reference, and security considerations ([homework17.md](homework17.md))

### Security

- **Scoped Secrets per Environment** - `stage` and `production` GitHub Environments hold separate SSH keys, env files, and GHCR tokens; no cross-environment secret access
- **Immutable Deployment Tags** - `sha-<full-git-sha>` image tags prevent tag mutation; digests are stored in the release manifest and logged in every step summary
- **Production Approval Gate** - `production` environment configured with required reviewers; no unattended production deploys

## [0.0.9] - 2026-03-15

### Added

- **Health Check System** - Three-tier health endpoints built with `@nestjs/terminus`: `/health` (liveness), `/ready` (readiness), and `/status` (full status dashboard)
- **Liveness Probe** - `GET /health` returns `200` immediately with no I/O; used by process supervisors and Kubernetes liveness checks to confirm the process is alive
- **Readiness Probe** - `GET /ready` checks hard dependencies (PostgreSQL, RabbitMQ, MinIO); returns `503` if any are unhealthy; gates traffic at load-balancer level
- **Full Status Endpoint** - `GET /status` checks all hard dependencies plus the payments-service gRPC `Ping` RPC; always returns `200` so monitoring dashboards can diff the body without triggering alerts on HTTP status
- **Custom Health Indicators** - `RabbitMQHealthIndicator` (asserts `order.process` queue), `MinioHealthIndicator` (S3 `HeadBucket` call via `S3Service`), `PaymentsHealthIndicator` (gRPC `Ping` with configurable timeout via `PAYMENTS_GRPC_TIMEOUT_MS`)
- **Payments-Service Ping RPC** - New `Ping` gRPC method on payments-service performs an internal PostgreSQL ping and returns `{ status: "ok" }`; used as a soft-dependency probe by the shop-service `/status` endpoint
- **Bypass Global Prefix** - Health endpoints operate at root level (no `/api/v1` prefix) so infrastructure tooling can reach them without API versioning knowledge
- **Swagger Documentation** - All three endpoints annotated with `@ApiOperation` and `@ApiResponse` describing success and failure schemas

### Changed

- **HealthModule** - Imports `RabbitMQModule`, `PaymentsGrpcModule`, and `FilesModule` to wire the custom indicators; `TerminusModule` registered for built-in `TypeOrmHealthIndicator`
- **AppModule** - `HEALTH_PATHS_TO_BYPASS` excludes `/health`, `/ready`, and `/status` from the global `api` prefix and authentication guards

### Security

- **No Auth Required** - Health endpoints are explicitly excluded from JWT guards; they expose only binary up/down status with no business data

## [0.0.8] - 2026-03-12

### Added

- **gRPC Payments Integration** - `PaymentsGrpcService` in shop-service communicates with payments-service over gRPC; `Authorize` and `GetPaymentStatus` RPCs implemented via proto contract (see [homework14.md](homework14.md))
- **Payments Microservice** - Independent `payments-service` with its own PostgreSQL database, exposing `Authorize`, `GetPaymentStatus`, `Capture` (stub), and `Refund` (stub) gRPC methods
- **Order Payment Endpoint** - `GET /api/v1/orders/:orderId/payment` — polls payment status from payments-service via gRPC
- **Auto Payment Authorization** - After worker marks order as `PROCESSED`, `authorizePayment()` calls gRPC `Authorize`, updates order to status `PAID` and stores `paymentId`
- **GraphQL Authentication** - `GqlJwtAuthGuard` extends `JwtAuthGuard` to support Passport JWT in GraphQL context; `orders` query now requires Bearer token
- **gRPC Error Mapping** - `mapGrpcError()` translates gRPC status codes to NestJS HTTP exceptions (NOT_FOUND → 404, UNAVAILABLE → 503, etc.)
- **gRPC Timeout** - All gRPC calls wrapped with RxJS `timeout(PAYMENTS_GRPC_TIMEOUT_MS)` from env; never hardcoded
- **Shared Proto Contract** - Single `proto/payments.proto` source of truth; copied into each service at container startup via Docker volume

### Changed

- **Order Creation** - `userId` no longer accepted in request body; taken from JWT token (`req.user.sub`) instead
- **Orders GraphQL Resolver** - Fixed bug where `findOrdersWithFilters` was called without `userId`; user is now extracted from GraphQL context
- **Order Status Flow** - Extended: `PENDING` → `PROCESSED` (worker) → `PAID` (after gRPC Authorize)

### Security

- **GraphQL Auth** - All GraphQL queries/mutations now protected by `GqlJwtAuthGuard`; unauthenticated requests receive 401
- **No userId in body** - Prevents users from creating orders on behalf of other users by spoofing userId

## [0.0.7] - 2026-03-04

### Added

- **RabbitMQ Integration** - Asynchronous order processing via AMQP with `amqplib`
- **Order Worker Module** - Dedicated `OrderWorkerService` consuming the `order.process` queue with manual ack
- **Dead-Letter Queue** - `orders.dlq` queue for messages exceeding the retry limit
- **Retry Mechanism** - Fixed-delay retry policy (up to 3 attempts, 2s delay) with attempt counter tracked in message payload
- **Idempotent Processing** - `ProcessedMessage` entity with unique index on `message_id`; two-layer duplicate guard (pre-insert SELECT + unique constraint catching `23505`)
- **Non-Blocking Order Creation** - `POST /api/v1/orders` returns 201 immediately after publishing; processing runs entirely in the worker
- **Simulation Env Vars** - `RABBITMQ_SIMULATE_FAILURE` and `RABBITMQ_SIMULATE_DELAY` for reproducing retry/DLQ scenarios without modifying code
- **Order Status Migration** - Changed default order status from `CREATED` to `PENDING` (migration `1772641502231-UpdateOrderStatusDefault`)
- **RabbitMQ Documentation** - Full setup, topology, retry policy, and scenario reproduction guide ([homework12.md](homework12.md))

### Changed

- **Order Entity** - Default `status` updated to `OrderStatus.PENDING`
- **Worker Guard** - Added `status !== PENDING` guard in `processOrderMessage` to skip orders in unexpected states

### Security

- **Manual Ack Only** - `noAck: false` enforced; ack is performed strictly after DB transaction commit to prevent message loss

### Reliability

- **Predictable Retry** - Hard cap at `MAX_RETRY_ATTEMPTS = 3`; no infinite loops possible
- **DLQ Stability** - DLQ declared durable; full payload including `attempt` and `orderId` preserved for debugging
- **No Duplication** - Idempotency guard prevents order re-processing on retry or network replay

## [0.0.6] - 2026-03-01

### Added

- **Docker Multi-Stage Builds** - Development, production Alpine, and production distroless variants (5 build stages)
- **Distroless Production Images** - Google distroless base images with no shell or package manager for minimal attack surface
- **Docker Compose Orchestration** - Base compose.yml with environment-specific overrides (dev/prod)
- **Hot Reload in Docker** - Development environment with source code bind mounts and automatic restart
- **Containerized Migrations & Seeding** - One-off containers with health check dependencies
- **MinIO Integration** - S3-compatible object storage for local development
- **Docker Documentation** - Comprehensive guide covering architecture, security, and optimization ([homework10.md](homework10.md))

### Changed

- **Image Size Optimization** - 67% reduction: 1.2 GB (dev) → 384 MB (prod distroless)
- **API Port** - Standardized to 8080 for both development and production
- **PostgreSQL Isolation** - Database accessible only within internal Docker network (not exposed to host)

### Security

- **Non-Root Users** - All containers run as UID 1001 (nestjs) or UID 65532 (nonroot)
- **Distroless Runtime** - Zero shell access in production prevents container exploitation
- **Network Isolation** - Separate public and internal networks for service isolation

### Performance

- **Layer Caching** - Multi-stage builds optimize Docker layer caching for faster rebuilds
- **Dependency Pruning** - Production images contain only runtime dependencies (no devDependencies or build tools)

## [0.0.5] - 2026-02-23

### Added

- **File Upload System** - Presigned S3 URL-based file upload with two-phase workflow (presign → upload → complete)
- **FileRecord Entity** - Database entity for tracking uploaded files with status (PENDING, READY, FAILED)
- **Files Module** - Complete file management module with FilesService, S3Service, and REST API endpoints
- **Product Images** - Integration with Products module for main image association (Product.mainImageId)
- **Presigned URL Generation** - Secure 15-minute presigned PUT URLs for direct client-to-S3 uploads
- **File Verification** - Server-side S3 HEAD request verification before marking uploads as complete
- **AWS S3 Integration** - AWS SDK v3 with @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner
- **File Upload Documentation** - Comprehensive guide covering architecture, workflow, and S3 configuration ([homework09.md](homework09.md))
- **Upload Endpoints** - POST /v1/files/presigned-upload and POST /v1/files/complete-upload REST endpoints
- **File Status Tracking** - Lifecycle management (PENDING → READY) with automatic status transitions
- **Entity Association** - Generic file association pattern supporting products (and future user avatars)
- **S3 Key Management** - Structured key naming: `{entityType}/{entityId}/{fileType}/{uuid}.{ext}`

### Changed

- **Product Entity** - Added `mainImageId` nullable foreign key to FileRecord
- **Database Schema** - Added file_records table with foreign key relationship to products

### Security

- **Presigned URL Expiry** - 15-minute time-limited upload URLs to prevent unauthorized access
- **File Size Validation** - DTO validation for file size limits before presigned URL generation
- **Content-Type Enforcement** - Presigned URLs enforce specific content types during upload
- **S3 Bucket Permissions** - Server-only access to S3 credentials, clients never see AWS keys

### Performance

- **Direct S3 Upload** - Zero server load during file transfer, client uploads directly to S3
- **Minimal Server Processing** - Server only generates URLs and verifies, no file handling
- **Efficient Verification** - HEAD requests to S3 instead of downloading full files for verification

## [0.0.4] - 2026-02-18

### Added

- **GraphQL API** - Code-first GraphQL implementation using @nestjs/graphql with Apollo Server v4
- **GraphQL Module** - Configured with auto-schema generation, GraphiQL playground, and introspection
- **GraphQL Schemas** - Type-safe ObjectTypes for Order, OrderItem, Product, and User with proper decorators
- **GraphQL Inputs** - OrdersFilterInput and OrdersPaginationInput with shared validation decorators
- **Orders Query** - GraphQL query for fetching orders with filtering and cursor-based pagination
- **Field Resolvers** - Resolvers for nested relations (order.user, order.items, orderItem.product, orderItem.order)
- **DataLoader Integration** - Request-scoped DataLoaders for batching database queries (UserLoader, OrderLoader, OrderItemLoader, ProductLoader)
- **N+1 Query Prevention** - Eliminated N+1 problem using DataLoader batching (41 queries → 4 queries, 90% reduction)
- **GraphQL Error Handling** - Structured GraphQLError usage with error codes (USER_NOT_FOUND, ORDER_NOT_FOUND, PRODUCT_NOT_FOUND)
- **GraphQL Documentation** - Comprehensive guide covering schema design, DataLoader implementation, and N+1 resolution ([homework07.md](homework07.md))

### Changed

- **Business Logic Reuse** - GraphQL resolvers now use the same OrdersService as REST API endpoints
- **Error Format** - Field resolvers throw GraphQLError with extensions containing error codes and context
- **Query Performance** - 83% faster response times (150ms → 25ms) through DataLoader batching

### Performance

- **DataLoader Batching** - Reduced database round-trips by 10x (41 → 4 queries for 10 orders)
- **Query Optimization** - Batched `WHERE IN` queries instead of individual SELECT statements
- **Response Time** - Order queries improved from ~150ms to ~25ms with DataLoader

## [0.0.3] - 2026-02-13

### Added

- **Order Creation with Idempotency** - Production-ready order creation system with idempotency key support to prevent duplicate orders
- **Pessimistic Locking** - Transaction-safe order processing using `FOR UPDATE` locks to prevent stock oversell in concurrent scenarios
- **Order Querying & Filtering** - Advanced order retrieval with multiple filters (status, user email, product name, date range)
- **Cursor-Based Pagination** - Scalable pagination for orders using cursor-based approach instead of offset-based
- **Order Query Optimization** - Composite B-tree indexes for 90-95% query performance improvement
- **Stock Management** - Automatic stock decrement within order transactions with validation
- **Product Availability Checks** - Validation for product existence, active status, and sufficient stock before order creation
- **Order Relations** - Eager loading of user, order items, and product details in single query
- **Idempotency Repository Pattern** - Dedicated repository methods for idempotency key lookups
- **Query Builder Pattern** - Separated query construction logic in `OrdersQueryBuilder` class
- **Comprehensive Error Handling** - Specific error types for timeout, lock contention, and race conditions
- **Order Documentation** - Detailed docs for order creation ([ORDERS_CREATION.md](docs/ORDERS_CREATION.md)) and querying ([ORDERS_QUERYING.md](docs/ORDERS_QUERYING.md))
- **Query Performance Analysis** - SQL execution plan analysis and optimization guide ([QUERY_OPTIMIZATION.md](docs/QUERY_OPTIMIZATION.md))

### Changed

- **Order Entity** - Added `idempotencyKey` field (nullable, unique constraint)
- **Product Entity** - Added `stock` field with default value 0
- **Orders Response Format** - Changed from `data` to `items` array in GET response, removed `total` count for performance optimization
- **Database Indexes** - Added composite indexes: `IDX_orders_user_created`, `IDX_orders_status_created`, `IDX_order_items_order_product`
- **Transaction Timeouts** - Configured statement timeout (30s) and lock timeout (10s) for order transactions

### Fixed

- **Race Condition Handling** - Proper handling of duplicate idempotency key violations (PostgreSQL error 23505)
- **N+1 Query Problem** - Eliminated via eager loading with `leftJoinAndSelect` for all order relations
- **Cursor Pagination Consistency** - Prevents duplicate/missing items when data changes between requests

### Performance

- **Query Execution** - 90-95% faster order queries with optimized indexes
- **Row Scanning** - 95-99% fewer rows scanned with composite indexes
- **Join Strategy** - 10x faster joins using Nested Loop instead of Hash Join
- **Transaction Duration** - Typical order creation < 50ms

### Security

- **Concurrency Control** - Prevents stock oversell through pessimistic locking
- **Idempotency Protection** - Guards against double-submit and network retry scenarios
- **Input Validation** - Comprehensive DTO validation with class-validator
- **Timeout Protection** - Prevents resource exhaustion with statement and lock timeouts

## [0.0.2] - 2026-02-10

### Added

- **TypeORM Integration** - Full TypeORM setup with PostgreSQL support
- **Database Adapter Pattern** - Flexible database provider abstraction with NeonAdapter implementation
- **Entity Models** - User, Order, OrderItem, and Product entities with proper relationships
- **Migration System** - TypeORM migration support with environment-specific configurations
- **Database Seeding** - Idempotent seed data system with production safety checks
- **Database CLI Commands** - npm scripts for running migrations, generating migrations, and seeding
- **Environment-based Paths** - Dynamic entity and migration paths for development and production
- **Database Connection Validation** - Environment variable validation for DATABASE_URL and DATABASE_PROVIDER
- **Feature Modules** - UsersModule, OrdersModule, and ProductsModule with TypeORM integration

### Changed

- **Configuration System** - Enhanced with database adapter factory and provider detection
- **AppModule** - Added TypeOrmModule.forRootAsync with ConfigService integration
- **Environment Schema** - Extended with DATABASE_URL and DATABASE_PROVIDER validation

### Fixed

- **Migration Loading** - Separated migration configuration for CLI vs runtime to prevent ES module errors
- **TypeORM Configuration** - Split getDataSourceOptions() for CLI and getModuleOptions() for NestJS runtime

## [0.0.1] - 2026-01-20

### Added

- **RequestIdMiddleware** - Adds X-Request-ID header to all requests for distributed tracing
- **Error codes** - Machine-readable error codes (BAD_REQUEST, NOT_FOUND, etc.) in error responses
- **Environment-based logging** - APP_LOG_LEVEL environment variable with configurable log levels (error, warn, log, debug, verbose)
- **Cross-platform support** - Added cross-env package for NODE_ENV support on Windows/Mac/Linux
- **Comprehensive README** - Added detailed project documentation with architecture overview and folder structure
- **JSDoc comments** - Added JSDoc documentation to interceptors, filters, and core utilities

### Changed

- **GlobalExceptionFilter** - Enhanced with request ID tracking, removed duplicate logging, added error codes to responses
- **Environment file resolution** - Dynamic .env.{NODE_ENV} file loading without .local suffix
- **npm scripts** - Updated all scripts to set NODE_ENV explicitly using cross-env
- **Error message handling** - Improved formatMessage to handle arrays, objects, and edge cases
- **Logger configuration** - Refactored getLogLevels to use APP_LOG_LEVEL from environment

### Fixed

- **Type safety** - Fixed unsafe assignment of `any` values in transform-response interceptor
- **Error response format** - Standardized error responses with consistent structure and optional fields

### Improved

- **Error logging** - Lightweight logging for client errors (4xx), detailed stack traces for server errors (5xx)
- **Request tracing** - Request IDs now included in both error responses and server logs

## [0.0.1] - 2026-01-20

### Added

- Initial NestJS project setup with TypeScript
- Users module with CRUD operations (mock implementation)
- Type-safe environment management with class-validator
- Global exception filter for standardized error handling
- Transform interceptor for consistent response format
- Graceful shutdown configuration
- Validation pipeline with class-validator
- API versioning (URI-based, default v1)
- ESLint and Prettier configuration
- Husky and lint-staged for pre-commit hooks
- Jest testing setup

[0.1.0]: https://github.com/yourusername/rd_shop/releases/tag/v0.1.0
[0.0.9]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.9
[0.0.8]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.8
[0.0.7]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.7
[0.0.6]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.6
[0.0.5]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.5
[0.0.4]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.4
[0.0.3]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.3
[0.0.2]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.2
[0.0.1]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.1
