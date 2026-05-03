# Security Baseline — rd_shop

> OWASP ASVS mini-review for the `rd_shop` NestJS backend.
> Last updated: May 2026.

## Service Overview

Two-service NestJS monorepo:

- **shop** (`apps/shop`) — HTTP REST + GraphQL (Apollo) + RabbitMQ consumer, port 8080
- **payments** (`apps/payments`) — gRPC-only internal service, port 5001

Entry points: `POST /api/v1/auth/*`, `GET|POST /api/v1/orders/*`, `GET /api/v1/products/*`, `POST /api/v1/files/*`, `/graphql`, `/health/*`.

---

## Risk Surface Summary

| Surface Area                           | Risk                                | Control (pre-HW)                            | Added                                                                             | Evidence                                                            | Residual Risk                                 |
| -------------------------------------- | ----------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| `POST /api/v1/auth/signin`             | Brute force / credential stuffing   | JWT auth, bcrypt                            | Throttle 5/min per IP, audit `AUTH_SIGNIN_FAILURE`                                | [rate-limit.txt](../security-evidence/rate-limit.txt)               | No CAPTCHA; anomaly detection not implemented |
| `POST /api/v1/auth/signup`             | Spam account creation               | None                                        | Throttle 10/min, audit `AUTH_SIGNUP`                                              | [rate-limit.txt](../security-evidence/rate-limit.txt)               | No email domain verification                  |
| `POST /api/v1/auth/forgot-password`    | Account enumeration, email flooding | DB check (3/hr)                             | Throttle 3/hr per **email** (`UserEmailThrottleGuard`), safe 200 always, audit    | [rate-limit.txt](../security-evidence/rate-limit.txt)               | None significant                              |
| `POST /api/v1/auth/refresh`            | Token replay / session hijacking    | `httpOnly` cookie, single-session           | Throttle 10/min                                                                   | [headers.txt](../security-evidence/headers.txt)                     | No device fingerprinting                      |
| `POST /api/v1/auth/logout`             | Session not invalidated             | Refresh token revocation                    | Audit `AUTH_LOGOUT`                                                               | [audit-log-example.txt](../security-evidence/audit-log-example.txt) | —                                             |
| `POST /api/v1/orders`                  | Order spam, inventory abuse         | JWT + scope guard                           | Throttle 5/min, audit `ORDER_CREATED`                                             | [audit-log-example.txt](../security-evidence/audit-log-example.txt) | —                                             |
| `POST /api/v1/orders/:id/cancellation` | Rapid cancel loops                  | JWT + scope guard                           | Throttle 5/min, audit `ORDER_CANCELLED`                                           | [audit-log-example.txt](../security-evidence/audit-log-example.txt) | —                                             |
| `PATCH /api/v1/admin/users/:id/roles`  | Privilege escalation                | `UserRole.ADMIN` + scope guard              | Audit `USER_ROLE_CHANGED` with actorId + actorRole                                | [audit-log-example.txt](../security-evidence/audit-log-example.txt) | —                                             |
| `PATCH /api/v1/admin/users/:id/scopes` | Permission creep                    | Admin guard                                 | Audit `USER_SCOPE_CHANGED` with actorId + actorRole                               | [audit-log-example.txt](../security-evidence/audit-log-example.txt) | —                                             |
| `DELETE /api/v1/admin/users/:id`       | Accidental/malicious delete         | Admin guard                                 | Audit `USER_SOFT_DELETED` with actorId + actorRole                                | [audit-log-example.txt](../security-evidence/audit-log-example.txt) | No hard-delete protection                     |
| `POST /api/v1/files/presigned-upload`  | S3 cost abuse, storage exhaustion   | JWT auth                                    | Throttle 10/min                                                                   | [rate-limit.txt](../security-evidence/rate-limit.txt)               | —                                             |
| `POST /api/v1/products/:id/reviews`    | Review spam                         | JWT auth                                    | Throttle 5/min                                                                    | [rate-limit.txt](../security-evidence/rate-limit.txt)               | —                                             |
| Request headers                        | Token / cookie leakage in logs      | No redaction                                | Pino `redact: [authorization, cookie]`                                            | [headers.txt](../security-evidence/headers.txt)                     | —                                             |
| All responses                          | Stack traces, internal details      | `GlobalExceptionFilter`                     | — (already done)                                                                  | —                                                                   | —                                             |
| Env vars / secrets                     | Secrets in logs / source            | Env validation + gitignored local env files | Pulumi ESC for deploy-time config, AWS Secrets Manager / SSM for runtime delivery | [secret-flow-note.md](../security-evidence/secret-flow-note.md)     | Rotation not automated                        |
| Transport / TLS                        | Plain HTTP in dev                   | `secure` cookie in prod                     | Documented below                                                                  | [tls-note.md](../security-evidence/tls-note.md)                     | No TLS until AWS migration                    |

---

## 1. Authentication / Session / JWT

### What exists

- **Access token**: JWT, RS256 or HS256 via `@nestjs/passport`, signed with `JWT_SECRET`, TTL 15 min
- **Refresh token**: opaque random string, bcrypt-hashed, stored in `refresh_tokens` table, `httpOnly`+ `sameSite=strict` cookie scoped to `/api/v1/auth`
- **Token rotation**: old token revoked atomically on each refresh (single-session model)
- **Replay prevention**: `parseOpaqueToken()` rejects malformed tokens before any DB work
- **Password hashing**: bcrypt with configurable salt rounds (default 10), `select: false` on entity
- **Email verification**: token-gated, single-use (`consumed_at IS NULL` atomic `UPDATE`)
- **Password reset**: single-use token, all refresh tokens revoked on success

### Added in this work

- Structured audit logging for all auth lifecycle events (see Part 5)
- Rate limiting on all auth endpoints (see Part 4)
- `Authorization` and `cookie` headers redacted from all request logs

### Residual risk

- No MFA
- No device fingerprinting / anomaly detection
- No CAPTCHA on high-risk endpoints

### Backlog / TODO

- MFA (TOTP or WebAuthn) — post-MVP
- Anomaly detection (multiple failures from different IPs) — [observability plan](../docs/backend/requirements/observability-plan.md)

---

## 2. Access Control / Roles / Scopes

### What exists

- **4-layer guard stack**: `JwtAuthGuard` → `RolesGuard` → `ScopesGuard` (optional `AdminGuard`)
- **`@Roles()`** — coarse-grained role check (`ADMIN`, `SUPPORT`, `USER`)
- **`@Scopes()`** — fine-grained permission check (`ORDERS_WRITE`, `USERS_READ`, etc.)
- **`@CurrentUser()`** — injects JWT payload; `userId` is always taken from the token, never from request params/body
- **TypeORM soft-delete** — users/products never physically removed; token revocation on soft-delete

### Added in this work

- Audit trail for admin permission changes (`USER_ROLE_CHANGED`, `USER_SCOPE_CHANGED`, `USER_SOFT_DELETED`) with `actorId` and `actorRole` (role at time of action) from authenticated admin token

### Residual risk

- No attribute-based access control (ABAC) — not required for current feature set
- No row-level security at DB layer

### Backlog / TODO

- Resource ownership validation (ensure user can only cancel **their own** order) — already implemented via `user.sub` filter

---

## 3. Secrets Management

> Full details moved to [security-evidence/secret-flow-note.md](../security-evidence/secret-flow-note.md).

**Summary:**

- All secrets loaded via `ConfigService` from env vars — no hardcoded values
- Deploy-time Pulumi config: Pulumi ESC environments imported by `infra/Pulumi.<stack>.yaml`
- Runtime delivery: Pulumi publishes secrets/config to AWS Secrets Manager / SSM, ECS task definitions inject them into containers
- Header redaction (`Authorization`, `cookie`) enforced by Pino `redact` config
- Deploy-time secrets were rotated during the Pulumi ESC migration cutover
- Rotation automation still deferred to [AWS migration plan](../docs/backend/requirements/aws-migration-plan.md)

### Backlog / TODO

- Automated JWT secret rotation
- RabbitMQ credential rotation runbook
- Review whether Pulumi ESC should be paired with additional approval / audit policy for production secret edits

---

## 4. Transport Security / TLS

> Full details moved to [security-evidence/tls-note.md](../security-evidence/tls-note.md).

**Summary:**

- Current deployment (VM + Docker Compose): no TLS anywhere; all internal traffic trusted by network placement
- App is TLS-ready: `secure` cookie flag gated on `isProduction()`, `APP_URL` env-driven, S3 presigned URLs use HTTPS
- TLS termination (ALB + ACM) deferred to [AWS migration plan](../docs/backend/requirements/aws-migration-plan.md)

### Backlog / TODO

- HTTP → HTTPS redirect, ACM certificate, gRPC mTLS — see [aws-migration-plan.md](../docs/backend/requirements/aws-migration-plan.md)

---

## 5. Input Surface / Abuse Protection

### What exists

- **Global `ValidationPipe`**: `whitelist: true`, `forbidNonWhitelisted: true` — strips unknown fields, rejects unknown properties
- **`class-validator` DTOs**: all controllers use typed, validated DTOs
- **ILIKE wildcard escaping**: `%`, `_`, `\` escaped before use in LIKE queries
- **TypeORM parameterized queries**: no raw SQL string interpolation
- **CORS**: environment-driven origin allow-list, `credentials: true`
- **`parseOpaqueToken()`**: format validation rejects malformed tokens before DB/bcrypt work

### Added in this work

- **Global rate limiting** (3-tier `ThrottlerModule`): `short` 3/s, `medium` 20/10s, `long` 100/min
- **Per-endpoint overrides** for high-risk write operations:
  - `POST /auth/signin`, `POST /auth/reset-password`: 5/min
  - `POST /auth/forgot-password`: 3/hour keyed **by email** (`UserEmailThrottleGuard`)
  - `POST /auth/refresh`: 10/min
  - `POST /auth/resend-verification`: 1/min
  - `POST /auth/signup`: 10/min
  - `POST /orders`, `POST /orders/:id/cancellation`: 5/min
  - `POST /files/presigned-upload`: 10/min
  - `POST /products/:id/reviews`: 5/min
- **`GqlThrottlerGuard`**: throttling on GraphQL mutations
- **`app.set('trust proxy', 1)`**: correct client IP from Docker gateway / ALB `X-Forwarded-For`
- **Security headers via `helmet`**: see Part 6

### Removed in this work

- `RequestIdMiddleware` (pino-http `genReqId` handles request ID natively)
- DB-based rate-limit queries in `AuthService.forgotPassword` and `AuthService.resendVerification` (replaced by throttler guards)

### Residual risk

- No CAPTCHA on `signup` / `forgot-password`
- No IP allow-list for admin endpoints
- No request body size limit beyond NestJS defaults

---

## 6. Security Headers

### Configuration

`apps/shop/src/core/helmet/index.ts` — `setupHelmet(app)` called in `main.ts`.

```typescript
helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
});
```

### Headers set on every API response

| Header                         | Value                                        | Purpose                                          |
| ------------------------------ | -------------------------------------------- | ------------------------------------------------ |
| `X-Content-Type-Options`       | `nosniff`                                    | Prevent MIME sniffing                            |
| `X-Frame-Options`              | `DENY`                                       | Prevent clickjacking                             |
| `X-DNS-Prefetch-Control`       | `off`                                        | Prevent DNS prefetch leakage                     |
| `Strict-Transport-Security`    | `max-age=31536000; includeSubDomains`        | Force HTTPS (effective once TLS is in place)     |
| `Content-Security-Policy`      | `default-src 'none'; frame-ancestors 'none'` | Strict CSP for API-only surface                  |
| `Referrer-Policy`              | `no-referrer`                                | No referrer leakage                              |
| `X-XSS-Protection`             | `0`                                          | Disabled (deprecated; CSP is the modern control) |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                | Isolates browsing context                        |
| `Cross-Origin-Resource-Policy` | `same-origin`                                | Restricts cross-origin resource sharing          |

### Surface-specific notes

- **API only** — strict `default-src 'none'` CSP; no inline scripts needed
- **Swagger UI** (`/api-docs`) — only served in development, not production
- **GraphQL playground** (`/graphql`) — only served in development, not production
- **File downloads** — served via S3/CloudFront presigned URLs, not from this server

### Evidence

See [security-evidence/headers.txt](../security-evidence/headers.txt).

---

## 7. Audit Logging

### Architecture

- **Storage**: `audit_logs` PostgreSQL table (TypeORM entity `AuditLog`)
- **Service**: `AuditLogService.log()` — fire-and-forget, swallows errors with a warning
- **Schema**: `action` (varchar 100), `actor_id` (uuid nullable), `actor_role`, `outcome`, `target_type`, `target_id`, `correlation_id` (X-Request-ID), `ip`, `user_agent`, `reason`, `created_at`
- **Sensitive data**: raw JWTs, passwords, secrets are never included in audit events
- **Correlation**: `X-Request-ID` (generated by pino-http `genReqId`) propagated as `correlationId`

### Events logged

| Action                         | Trigger                                      | actorId        | targetType | targetId         |
| ------------------------------ | -------------------------------------------- | -------------- | ---------- | ---------------- |
| `AUTH_SIGNIN_FAILURE`          | Invalid credentials                          | null or userId | `User`     | null or userId   |
| `AUTH_SIGNUP`                  | New user registration                        | userId         | `User`     | userId           |
| `AUTH_LOGOUT`                  | Refresh token revoked                        | userId         | `User`     | —                |
| `AUTH_PASSWORD_RESET_REQUEST`  | `forgotPassword` called                      | userId         | `User`     | userId           |
| `AUTH_PASSWORD_RESET_COMPLETE` | Password reset completed                     | userId         | `User`     | userId           |
| `ORDER_CREATED`                | Order transaction committed                  | userId         | `Order`    | orderId          |
| `ORDER_IDEMPOTENT_HIT`         | Duplicate idempotency key on create/checkout | userId         | `Order`    | existing orderId |
| `ORDER_CREATION_FAILED`        | Unrecoverable error after PG error handler   | userId         | `Order`    | —                |
| `ORDER_CANCELLED`              | Order cancelled                              | userId         | `Order`    | orderId          |
| `ORDER_PAYMENT_AUTHORIZED`     | gRPC payment authorized (worker path)        | userId         | `Order`    | orderId          |
| `ORDER_PAYMENT_FAILED`         | gRPC payment failed (worker path)            | userId         | `Order`    | orderId          |
| `USER_ROLE_CHANGED`            | Admin updates user roles                     | adminId        | `User`     | userId           |
| `USER_SCOPE_CHANGED`           | Admin updates user scopes                    | adminId        | `User`     | userId           |
| `USER_SOFT_DELETED`            | Admin soft-deletes user                      | adminId        | `User`     | userId           |

Admin actions (`USER_ROLE_CHANGED`, `USER_SCOPE_CHANGED`, `USER_SOFT_DELETED`) additionally populate `actorRole` with the admin's roles at the time of the action (point-in-time capture; guards against post-hoc role revocation obscuring history).

All HTTP-path events include `ip`, `userAgent`, and `correlationId` from the originating request. Worker-path events (`ORDER_PAYMENT_*`) have no HTTP context; `ip`, `userAgent`, and `correlationId` are null.

### Evidence

See [security-evidence/audit-log-example.txt](security-evidence/audit-log-example.txt).

---

## 8. Logging / Observability

### What exists

- **Pino structured logging** via `nestjs-pino` — JSON in production, pretty-print in development
- **Request logging**: `method`, `url`, `statusCode`, `responseTime`, `requestId` on every request
- **`userId` binding**: injected into request log context by `JwtAuthGuard` via `req.log.setBindings()`
- **Health endpoints excluded** from request logging (`/health/*`)
- **GraphQL query counters** via `QueryLoggerMiddleware` + `AsyncLocalStorage`
- **Header redaction**: `Authorization` and `cookie` fields never appear in logs

### Added in this work

- Replaced `RequestIdMiddleware` with pino-http native `genReqId`
- Migrated `QueryLoggerMiddleware` to inject `PinoLogger`
- Added `userId` binding in `JwtAuthGuard`
- Added `redact` config for authorization/cookie headers

### Residual risk

- No centralized log aggregation (CloudWatch / ELK) in current VM deployment
- No alerting on audit event anomalies (multiple `AUTH_SIGNIN_FAILURE` from same IP)

### Backlog / TODO

- CloudWatch Logs integration ([AWS migration plan](../docs/backend/requirements/aws-migration-plan.md) / [observability plan](../docs/backend/requirements/observability-plan.md))
- Alert on repeated `AUTH_SIGNIN_FAILURE` within a time window
- Migrate audit log backing store to CloudWatch after AWS migration

---

## What Was Changed in This Work

### New packages

```
nestjs-pino pino-http pino-pretty @nestjs/throttler helmet
```

### New files

| File                                                     | Purpose                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| `apps/shop/src/config/logger.ts`                         | Pino configuration (redact, serializers, genReqId)             |
| `apps/shop/src/core/helmet/index.ts`                     | `setupHelmet()` with strict CSP                                |
| `apps/shop/src/audit-log/audit-log.entity.ts`            | `AuditLog` TypeORM entity + `AuditAction`/`AuditOutcome` enums |
| `apps/shop/src/audit-log/audit-log.service.ts`           | `AuditLogService.log()` — fire-and-forget audit persistence    |
| `apps/shop/src/audit-log/audit-log.module.ts`            | Module wiring                                                  |
| `apps/shop/src/auth/guards/gql-throttler.guard.ts`       | GraphQL-aware `ThrottlerGuard`                                 |
| `apps/shop/src/auth/guards/user-email-throttle.guard.ts` | Email-keyed throttle guard for unauthenticated auth endpoints  |

### Modified files

| File                                               | Change                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/shop/src/main.ts`                            | `setupHelmet()`, `app.useLogger()`, `trust proxy 1`                                               |
| `apps/shop/src/app.module.ts`                      | `LoggerModule.forRoot()`, `ThrottlerModule.forRoot()` with 3-tier config, global `ThrottlerGuard` |
| `apps/shop/src/auth/v1/auth.controller.ts`         | `@Throttle()` on all auth endpoints; `@CurrentUser()` + context on logout                         |
| `apps/shop/src/auth/auth.service.ts`               | Audit events for signin, signup, logout, password reset                                           |
| `apps/shop/src/orders/v1/orders.controller.ts`     | `@Throttle()` on create/cancel; context extraction                                                |
| `apps/shop/src/orders/orders.service.ts`           | Audit events for `ORDER_CREATED`, `ORDER_CANCELLED`                                               |
| `apps/shop/src/users/v1/admin-users.controller.ts` | `@CurrentUser()` + `extractContext()` on all write endpoints                                      |
| `apps/shop/src/users/users.service.ts`             | Audit events for `USER_ROLE_CHANGED`, `USER_SCOPE_CHANGED`, `USER_SOFT_DELETED`                   |
| `apps/shop/src/files/v1/files.controller.ts`       | `@Throttle()` on presigned-upload                                                                 |
| `apps/shop/src/products/v1/reviews.controller.ts`  | `@Throttle()` on createReview                                                                     |
| `apps/shop/src/auth/guards/jwt-auth.guard.ts`      | `req.log.setBindings({ userId })` after JWT validation                                            |

### Deleted files

- `apps/shop/src/common/middlewares/request-id.ts` — replaced by pino-http `genReqId`

---

## How to Verify

### Security headers

```bash
curl -si http://localhost:8080/api/v1/products | grep -E 'x-content-type|x-frame|content-security|strict-transport|referrer'
```

### Rate limiting (429 example)

```bash
# Trigger medium-tier limit on signin (5/min)
for i in {1..6}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:8080/api/v1/auth/signin \
    -H 'Content-Type: application/json' \
    -d '{"email":"test@example.com","password":"wrong"}';
done
# Expected: 401 401 401 401 401 429
```

### Audit log entry

```sql
SELECT action, actor_id, outcome, ip, created_at
FROM audit_logs
ORDER BY created_at DESC
LIMIT 10;
```

### Request ID propagation

```bash
curl -si http://localhost:8080/api/v1/products | grep x-request-id
```

---

## Backlog (Future Work)

| Item                                       | Priority | Rationale                                                                           |
| ------------------------------------------ | -------- | ----------------------------------------------------------------------------------- |
| MFA (TOTP / WebAuthn)                      | Medium   | Strong authentication for admin accounts                                            |
| CAPTCHA on signin/signup                   | Low      | Mitigates bot-driven credential stuffing                                            |
| Anomaly detection on `AUTH_SIGNIN_FAILURE` | Medium   | Brute-force alerting                                                                |
| IP allow-list for admin endpoints          | Low      | Defense-in-depth for privilege operations                                           |
| AWS Secrets Manager / rotation             | High     | Replace manual `.env` rotation                                                      |
| CloudWatch Logs integration                | High     | Centralized log aggregation + alerting                                              |
| Audit log migration to CloudWatch          | Medium   | Tamper-resistance + retention policies                                              |
| HTTP → HTTPS redirect (ALB)                | High     | In AWS migration scope                                                              |
| gRPC inter-service mTLS                    | Medium   | In AWS migration scope                                                              |
| Payment capture/refund audit events        | Medium   | Once [payments plan](../docs/backend/requirements/payments-plan.md) Phases 1–2 land |
