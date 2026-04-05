# rd_shop — General E-Commerce Requirements Gap Analysis

## Product Requirements (features)

### Auth & Users

| Feature                    | Status | Notes                                     |
| -------------------------- | ------ | ----------------------------------------- |
| JWT access token           | ✅     | 15m expiry                                |
| Roles + scopes RBAC        | ✅     | 4 guards, 2 decorators                    |
| Refresh tokens             | ❌     | No rotation; user must re-login after 15m |
| Password reset flow        | ❌     | No forgot/reset endpoint                  |
| Email verification         | ❌     | Users are active immediately              |
| OAuth2 social login        | ❌     | Only email/password                       |
| User profile update        | ❌     | No PATCH /users/me                        |
| Shipping/billing addresses | ❌     | No address entity at all                  |
| Account deactivation       | ❌     | —                                         |

### Products

| Feature                        | Status | Notes                                           |
| ------------------------------ | ------ | ----------------------------------------------- |
| CRUD                           | ✅     | With stock tracking                             |
| Product images (S3)            | ✅     | 3-step presigned upload                         |
| Categories / tags              | ❌     | No classification system                        |
| Full-text search               | ❌     | Only `ILIKE %name%` on title                    |
| Product reviews / ratings      | ❌     | No review entity                                |
| Product variants (size, color) | ❌     | Single SKU per product                          |
| Soft delete                    | ❌     | Hard delete only (RESTRICT on ordered products) |
| Multiple images per product    | ❌     | Only `mainImageId` (1:1)                        |
| Sorting options                | ❌     | Only `createdAt DESC`                           |
| Product favorites / wishlist   | ❌     | —                                               |

### Orders & Cart

| Feature                               | Status | Notes                                                       |
| ------------------------------------- | ------ | ----------------------------------------------------------- |
| Order creation + stock reservation    | ✅     | Pessimistic locking, idempotent                             |
| Async processing + payment            | ✅     | RabbitMQ → gRPC                                             |
| Order listing + filters               | ✅     | Cursor pagination, status/date/product filters              |
| Shopping cart                         | ❌     | Orders created directly from item list — no persistent cart |
| Order cancellation                    | ❌     | `CANCELLED` status defined but no endpoint                  |
| Order status timeline / history       | ❌     | Only current status, no status change log                   |
| Partial order fulfillment             | ❌     | All-or-nothing                                              |
| Email notifications on status changes | ❌     | —                                                           |
| Order receipts / invoices             | ❌     | —                                                           |

### Payments

| Feature                  | Status | Notes                  |
| ------------------------ | ------ | ---------------------- |
| Authorize                | ✅     | gRPC implemented       |
| Query payment status     | ✅     | REST endpoint          |
| Capture                  | ❌     | Proto stub only        |
| Refund                   | ❌     | Proto stub only        |
| Multiple payment methods | ❌     | Single implicit method |
| Payment webhooks         | ❌     | Synchronous gRPC only  |

### Missing domains entirely

| Domain                    | What it would include                                                 |
| ------------------------- | --------------------------------------------------------------------- |
| **Discounts / coupons**   | Promo codes, percentage/fixed discounts, expiry, usage limits         |
| **Shipping**              | Shipping methods, cost calculation, tracking numbers, delivery status |
| **Tax**                   | Tax rates per region, tax calculation on order total                  |
| **Notifications**         | Email (transactional), push, in-app; templates, delivery tracking     |
| **Admin panel endpoints** | User management, order management, analytics, bulk operations         |
| **Rate limiting**         | Per-user/IP throttling on public endpoints                            |

---

## Developer Requirements (engineering quality)

### Testing

| Area                | Status     | Gap                                                                                      |
| ------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| Unit tests          | ✅ Partial | Coverage unknown; likely missing for many services                                       |
| Integration tests   | ✅ 1 spec  | Only `graphql-orders-pagination`; no coverage for orders creation, auth, files, products |
| E2e tests           | ❌ TBD     | `test/e2e/` reserved but empty                                                           |
| Coverage reporting  | ❌         | No `--coverage` in CI; no threshold enforcement                                          |
| Load / stress tests | ❌         | Concurrency doc exists (`TESTING_CONCURRENCY.md`) but likely manual, no k6/artillery     |

### Code duplication & shared code

| Duplication                           | Where                         | Fix                                           |
| ------------------------------------- | ----------------------------- | --------------------------------------------- |
| `config/typeORM.ts`                   | Identical in both apps        | Extract to `libs/shared/` or root `packages/` |
| `config/logger.ts`                    | Identical in both apps        | Same                                          |
| `core/environment/`                   | Schema + constants duplicated | Same                                          |
| `db/adapters/`                        | Adapter factory duplicated    | Same                                          |
| `db/logger/`                          | TypeORM logger duplicated     | Same                                          |
| `utils/env.ts`, `misc.ts`             | Both apps                     | Same                                          |
| Entity base fields (`id`, timestamps) | Repeated per entity           | Base entity class                             |

A `libs/common/` NestJS library (nest-cli monorepo supports this natively with `nest g library`) would eliminate all of the above.

### API documentation

| Area                          | Status            | Gap                                                           |
| ----------------------------- | ----------------- | ------------------------------------------------------------- |
| Swagger / OpenAPI             | ✅ Setup exists   | Likely incomplete decorators (`@ApiProperty`, `@ApiResponse`) |
| GraphQL schema docs           | ✅ Auto-generated | Code-first handles this                                       |
| Postman / Insomnia collection | ❌                | No exported collection for manual testing                     |
| API versioning strategy doc   | ❌                | v1 only; no v2 migration plan                                 |

### Observability & reliability

| Area                          | Status     | Gap                                                          |
| ----------------------------- | ---------- | ------------------------------------------------------------ |
| Structured logging            | ✅ Partial | Custom logger exists; correlation ID via `AsyncLocalStorage` |
| Request tracing (distributed) | ❌         | No OpenTelemetry / Jaeger integration                        |
| Metrics (Prometheus)          | ❌         | No `/metrics` endpoint                                       |
| Alerting                      | ❌         | No Grafana / PagerDuty integration                           |
| Health checks                 | ✅         | `/health`, `/ready`, `/status` — solid                       |
| Graceful shutdown             | ✅         | Implemented                                                  |

### Security hardening

| Area                  | Status | Gap                                  |
| --------------------- | ------ | ------------------------------------ |
| Helmet (HTTP headers) | ❓     | Likely not configured                |
| CORS                  | ❓     | Likely wide open in dev              |
| Rate limiting         | ❌     | No `@nestjs/throttler`               |
| Input sanitization    | ✅     | `ValidationPipe` + `whitelist: true` |
| SQL injection         | ✅     | TypeORM parameterized queries        |
| CSRF                  | N/A    | API-only, no cookies                 |
| Audit log             | ❌     | No record of who changed what        |

### Developer experience

| Area                               | Status | Gap                                                                |
| ---------------------------------- | ------ | ------------------------------------------------------------------ |
| DB seed                            | ✅     | Idempotent, prod-guarded                                           |
| Hot reload (dev)                   | ✅     | `start:dev` in compose                                             |
| Linting                            | ✅     | ESLint in CI                                                       |
| Type checking                      | ✅     | `tsc --noEmit` in CI                                               |
| Git hooks (pre-commit)             | ❌     | No husky / lint-staged                                             |
| Commit conventions                 | ❌     | No commitlint / conventional commits                               |
| Changelog automation               | ❌     | Manual CHANGELOG.md                                                |
| Database migration auto-generation | ❓     | Manual migration files; no `typeorm migration:generate` in scripts |
| Caching layer (Redis)              | ❌     | No cache for product listings, session data, etc.                  |

---

## Priorities

### Focus areas (in order)

1. **Products** — REST CRUD, sorting/filtering, categories, multiple images, full-text search → [products-plan.md](products-plan.md)
2. **Auth** — refresh tokens (HTTP-only cookies), email verification, password reset, roles/scopes formalization → [auth-plan.md](auth-plan.md)
3. **Users** — profile fields (name, phone, city, country), CRUD unmock, avatar, password change → [users-plan.md](users-plan.md)
4. **Observability & Reliability** — structured logging (Pino), security hardening, Prometheus metrics, OpenTelemetry tracing → [observability-plan.md](observability-plan.md)

### Next up

5. **Orders & Cart** — cancellation, status history, persistent cart, event notifications → [orders-cart-plan.md](orders-cart-plan.md)
6. **Payments** — capture, refund, status machine, void, payment history → [payments-plan.md](payments-plan.md)
7. **Code duplication & shared code** — `libs/common` library, base entity, shared DTOs → [code-duplication-plan.md](code-duplication-plan.md)

### Deprioritized (revisit later)

- Reviews/ratings, wishlists
- Multiple payment methods, webhooks
- E2e test infrastructure
- OAuth2 / social login
- Full Grafana dashboards
- Shipping, tax, discounts domains
