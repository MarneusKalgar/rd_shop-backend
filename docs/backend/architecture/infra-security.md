# Security Architecture

> Security controls implemented in the `rd_shop` backend.
> For the full OWASP ASVS mapping and evidence index see [`SECURITY-BASELINE.md`](../../../security-homework/SECURITY-BASELINE.md).

## Overview

Security hardening is layered across five concerns, applied in NestJS middleware/guard/service order:

```
Incoming request
  │
  ├─ pino-http     — request logging: redact Authorization + cookie headers
  ├─ helmet()      — HTTP security headers (CSP, HSTS, nosniff, …)
  ├─ ThrottlerGuard (APP_GUARD) — global rate limiting (3 tiers)
  │   └─ @Throttle() overrides — stricter limits on high-risk endpoints
  ├─ JwtAuthGuard  — JWT validation; injects userId into Pino log context
  ├─ RolesGuard    — coarse-grained role check
  ├─ ScopesGuard   — fine-grained scope check
  ├─ ValidationPipe— DTO validation (whitelist: true, forbidNonWhitelisted)
  │
  ├─ Controller / Service — business logic
  │   └─ AuditLogService.log() — fire-and-forget structured audit event
  │
  └─ GlobalExceptionFilter — sanitizes error responses (no stack traces)
```

---

## 1. Structured Logging (Pino)

**Module:** `apps/shop/src/config/logger.ts` → `LoggerModule.forRoot()`

- JSON output in production, pretty-print in development
- Per-request child logger with `requestId`, `method`, `url`, `statusCode`, `responseTime`
- `userId` injected into log context by `JwtAuthGuard` via `req.log.setBindings({ userId })`
- **Sensitive field redaction:** `req.headers.authorization`, `req.headers.cookie` — never appear in log output
- Health endpoints (`/health/*`) excluded from request logging

---

## 2. Security Headers (Helmet)

**Module:** `apps/shop/src/core/helmet/index.ts` → `setupHelmet(app)`

Applied as the first `app.use()` call in `main.ts`, before any route handler.

| Header                         | Value                                        |
| ------------------------------ | -------------------------------------------- |
| `Content-Security-Policy`      | `default-src 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options`       | `nosniff`                                    |
| `X-Frame-Options`              | `DENY`                                       |
| `Strict-Transport-Security`    | `max-age=15552000; includeSubDomains`        |
| `Referrer-Policy`              | `no-referrer`                                |
| `X-DNS-Prefetch-Control`       | `off`                                        |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                |
| `Cross-Origin-Resource-Policy` | `same-origin`                                |

CSP is intentionally strict (`default-src 'none'`) — this is a JSON API with no browser-rendered content. Swagger UI and GraphQL playground are only served in development.

---

## 3. Rate Limiting (ThrottlerModule)

**Module:** `apps/shop/src/app.module.ts` — `ThrottlerModule.forRoot()` + global `APP_GUARD`

### Tiers

| Name     | TTL  | Default Limit | Purpose                 |
| -------- | ---- | ------------- | ----------------------- |
| `short`  | 1 s  | 3 req         | Burst protection        |
| `medium` | 10 s | 20 req        | Normal traffic baseline |
| `long`   | 60 s | 100 req       | Sustained rate          |

All three tiers apply to every endpoint simultaneously. The most restrictive one that triggers wins.

### Per-Endpoint Overrides

| Endpoint                         | Override Tier | Limit / Window    | Rationale                              |
| -------------------------------- | ------------- | ----------------- | -------------------------------------- |
| `POST /auth/signin`              | medium        | 5 / 60 s          | Brute-force credential protection      |
| `POST /auth/forgot-password`     | long          | 3 / 3600 s        | Per-email via `UserEmailThrottleGuard` |
| `POST /auth/refresh`             | medium        | 10 / 60 s         | Token rotation rate                    |
| `POST /auth/resend-verification` | medium        | 1 / 60 s          | Anti-spam                              |
| `POST /auth/reset-password`      | medium        | 5 / 60 s          | Token consumption rate                 |
| `POST /auth/signup`              | medium        | 10 / 60 s         | Account creation rate                  |
| `POST /auth/logout`              | —             | `@SkipThrottle()` | Authenticated; no rate-limiting needed |
| `POST /auth/verify-email`        | —             | `@SkipThrottle()` | Token-gated; one-use                   |
| `POST /orders`                   | medium        | 5 / 60 s          | Order creation rate                    |
| `POST /orders/:id/cancellation`  | medium        | 5 / 60 s          | Cancel loop prevention                 |
| `POST /files/presigned-upload`   | medium        | 10 / 60 s         | S3 cost protection                     |
| `POST /products/:id/reviews`     | medium        | 5 / 60 s          | Review spam prevention                 |

### Special Guards

- **`UserEmailThrottleGuard`** — overrides `ThrottlerGuard.getTracker()` to key by `req.body.email` instead of IP, preventing abuse across proxies on `forgot-password`
- **`GqlThrottlerGuard`** — extracts the request from GraphQL execution context; applied on GraphQL resolvers that mutate state

### Proxy IP Resolution

`app.set('trust proxy', 1)` in `main.ts` — trusts one hop of `X-Forwarded-For` (Docker gateway / AWS ALB). Without this, all requests appear as the internal Docker IP.

---

## 4. Authentication & Authorization

**Modules:** `apps/shop/src/auth/`

### Guards (applied via `@UseGuards()`)

| Guard          | Applied on          | Purpose                                           |
| -------------- | ------------------- | ------------------------------------------------- |
| `JwtAuthGuard` | Protected routes    | Validates JWT; injects `AuthUser` into `req.user` |
| `RolesGuard`   | Admin routes        | Checks `user.roles` against `@Roles()` metadata   |
| `ScopesGuard`  | Fine-grained routes | Checks `user.scopes` against `@Scopes()` metadata |

### Token lifecycle

- **Access token**: JWT, 15 min TTL, signed with `JWT_SECRET`
- **Refresh token**: opaque random string, bcrypt-hashed in DB, `httpOnly` + `sameSite=strict` cookie, scoped to `/api/v1/auth`
- **Rotation**: old refresh token revoked atomically on each use (single-session model)
- **Revocation on security events**: all user tokens revoked on password change and password reset

---

## 5. Audit Logging

**Module:** `apps/shop/src/audit-log/`

### Architecture

```
Controller → Service → AuditLogService.log(CreateAuditEventDto)
                         │
                         └─ auditLogRepository.save()  ──→  audit_logs table
                                                       (fire-and-forget; errors swallowed)
```

### Event Schema (`audit_logs` table)

| Column           | Type                  | Notes                            |
| ---------------- | --------------------- | -------------------------------- |
| `id`             | uuid PK               | Auto-generated                   |
| `action`         | varchar(100)          | `AuditAction` enum value         |
| `actor_id`       | uuid nullable         | User performing the action       |
| `actor_role`     | varchar(50) nullable  | Role at time of action           |
| `outcome`        | varchar(20)           | `SUCCESS` or `FAILURE`           |
| `target_type`    | varchar(100) nullable | Entity type (`User`, `Order`)    |
| `target_id`      | varchar(255) nullable | Entity ID                        |
| `correlation_id` | varchar(255) nullable | `X-Request-ID` from HTTP request |
| `ip`             | varchar(45) nullable  | Client IP                        |
| `user_agent`     | text nullable         | Browser/client UA string         |
| `reason`         | text nullable         | Human-readable failure reason    |
| `created_at`     | timestamptz           | Auto-set by TypeORM              |

### Wired Events

| `AuditAction`                  | Service       | Location                                                            |
| ------------------------------ | ------------- | ------------------------------------------------------------------- |
| `AUTH_SIGNIN_FAILURE`          | AuthService   | `signin()` — both "user not found" and "invalid password" branches  |
| `AUTH_SIGNUP`                  | AuthService   | `signup()` — after user persisted                                   |
| `AUTH_LOGOUT`                  | AuthService   | `logout()` — after token revoked                                    |
| `AUTH_PASSWORD_RESET_REQUEST`  | AuthService   | `forgotPassword()`                                                  |
| `AUTH_PASSWORD_RESET_COMPLETE` | AuthService   | `resetPassword()`                                                   |
| `ORDER_CREATED`                | OrdersService | `createOrder()` — after transaction committed                       |
| `ORDER_IDEMPOTENT_HIT`         | OrdersService | `createOrder()` — early return on duplicate idempotency key         |
| `ORDER_CREATION_FAILED`        | OrdersService | `createOrder()` — catch block when PG error handler re-throws       |
| `ORDER_CANCELLED`              | OrdersService | `cancelOrder()`                                                     |
| `ORDER_PAYMENT_AUTHORIZED`     | OrdersService | `authorizePayment()` (worker path) — after gRPC success + DB update |
| `ORDER_PAYMENT_FAILED`         | OrdersService | `authorizePayment()` (worker path) — catch before re-throw          |
| `USER_ROLE_CHANGED`            | UsersService  | `updateRoles()` — actorId + actorRole from admin JWT                |
| `USER_SCOPE_CHANGED`           | UsersService  | `updateScopes()` — actorId + actorRole from admin JWT               |
| `USER_SOFT_DELETED`            | UsersService  | `remove()` — actorId + actorRole from admin JWT                     |

### Design decisions

- **varchar not enum column** — PostgreSQL `ALTER TYPE … ADD VALUE` cannot run inside a transaction; varchar avoids migration complications while the TypeScript enum provides compile-time safety
- **Fire-and-forget** — audit writes swallow errors to prevent audit failures from disrupting the primary business flow; failures are logged as `WARN` via Pino
- **`actorRole` on admin actions** — `USER_ROLE_CHANGED`, `USER_SCOPE_CHANGED`, `USER_SOFT_DELETED` capture `user.roles.join(',')` at call time; guards against post-hoc role revocation obscuring who held admin at time of action
- **Worker-path events have no HTTP context** — `ORDER_PAYMENT_AUTHORIZED` and `ORDER_PAYMENT_FAILED` are fired by the RabbitMQ worker, so `ip`, `userAgent`, and `correlationId` are null
- **Storage abstraction stays local to the service** — `AuditLogService` depends on a TypeORM `Repository<AuditLog>`, but the current AWS deployment still persists audit events in the `audit_logs` table. CloudWatch Logs complements request/application logging; it does not replace the audit store.

---

## 6. Input Validation & Sanitization

- **`ValidationPipe`** (global): `whitelist: true`, `forbidNonWhitelisted: true` — strips and rejects unknown fields
- **TypeORM parameterized queries** — no raw SQL string concatenation
- **ILIKE wildcard escaping** — `%`, `_`, `\` escaped in user-supplied search terms
- **`parseOpaqueToken()`** — validates format before DB lookup or bcrypt work
- **`GlobalExceptionFilter`** — all 4xx/5xx responses sanitized; no stack traces in HTTP responses

---

## 7. Secrets & Environment

- All secrets loaded via `ConfigService` from env vars — no hardcoded values
- Env validation at startup via `class-validator` schemas in `apps/shop/src/core/environment/schema.ts` — fail-fast on missing/invalid vars
- Local `.env.*` files still exist for development and compose-based flows; `.env.production` remains gitignored
- **AWS runtime delivery**: Pulumi publishes sensitive values to Secrets Manager and runtime parameters to SSM Parameter Store; ECS task definitions inject them into the running containers by ARN/name
- **CI access model**: GitHub Actions assumes AWS roles through OIDC, then runs Pulumi with environment-scoped secrets and variables. No active deploy step copies env files onto a VM
- **Never logged**: `Authorization` header, `cookie` header, `password`, `tokenHash`, `JWT_SECRET`, AWS credentials

---

## 8. Related Documents

- [SECURITY-BASELINE.md](../../../SECURITY-BASELINE.md) — full OWASP ASVS mapping, risk table, evidence index
- [docs/backend/requirements/security-hardening-plan.md](../requirements/security-hardening-plan.md) — implementation plan with task tracking
- [docs/backend/architecture/feature-auth-rbac.md](feature-auth-rbac.md) — JWT strategy, guards, decorators
- [docs/backend/architecture/infra-aws.md](infra-aws.md) — deployed AWS topology, stack split, ops tradeoffs
- [docs/backend/architecture/infra-docker-compose.md](infra-docker-compose.md) — Docker security (non-root, tini, distroless option)
- [docs/backend/architecture/infra-ci-pipeline.md](infra-ci-pipeline.md) — CI/CD secrets delivery
