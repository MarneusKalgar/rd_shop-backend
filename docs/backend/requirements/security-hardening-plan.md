# Security Hardening Plan

> Based on OWASP ASVS mini-review mapped to the rd_shop codebase.
> Each section carries **Priority** (business urgency), **Severity** (risk if absent), and **Complexity** (implementation effort) rated 1–5 (1 = lowest, 5 = highest).

## Prerequisite — Structured Logging (Pino)

> **Priority: 4 | Severity: 4 | Complexity: 2**

Parts 2.3 (secrets-not-logged redaction), 4a (rate limiting), 4b (security headers), and 5 (audit logging) all depend on Pino structured logging. This must land first.

### Why Pino over Winston

- 5-10x faster (critical in Node.js event loop)
- Native JSON output — directly compatible with CloudWatch Logs (production) and log aggregators
- `nestjs-pino` integrates seamlessly with NestJS lifecycle
- Built-in request serialization (method, url, status, duration)

### Dependencies

```
npm install nestjs-pino pino-http pino-pretty
```

### Configuration — `apps/shop/src/config/logger.ts` (rewrite)

```typescript
LoggerModule.forRoot({
  pinoHttp: {
    level: process.env.APP_LOG_LEVEL || 'info',
    transport: isProd ? undefined : { target: 'pino-pretty' },
    genReqId: (req) => req.headers['x-request-id'] || randomUUID(),
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, requestId: req.id }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
});
```

### Request context

pino-http creates a child logger per request with `requestId`, `method`, `url`, `statusCode`, `responseTime` automatically. `userId` can be added via `req.log.setBindings({ userId })` in a guard/interceptor after JWT validation — no `AsyncLocalStorage` needed for request context.

The existing `AsyncLocalStorage` stays as-is — it's a query counter for DataLoader verification, not a request context store. No reason to merge the two concerns.

### Migration steps

- Remove `RequestIdMiddleware` (pino-http `genReqId` handles request ID generation/propagation natively)
- Keep `AsyncLocalStorage` + `QueryLoggerMiddleware` for query counting — just swap `this.logger` to Pino
- Replace `Logger.log()` / `this.logger.log()` calls with Pino logger injection

### Tasks

- [x] Install `nestjs-pino`, `pino-http`, `pino-pretty`
- [x] Rewrite `config/logger.ts` for Pino
- [x] Register `LoggerModule` in `AppModule`
- [x] Remove `RequestIdMiddleware` (replaced by pino-http `genReqId`)
- [x] Update `QueryLoggerMiddleware` to use Pino (keep AsyncLocalStorage for query counting)
- [x] Add `userId` to request log context via `req.log.setBindings()` in auth guard/interceptor
- [x] Redact sensitive fields (Authorization header, passwords) — satisfies Part 2.3
- [x] Update `main.ts`: `app.useLogger(app.get(Logger))`
- [ ] Verify JSON output in prod, pretty-print in dev
- [ ] Update tests (logger mock may need adjustment)

**Recommendation:** implement Pino first, then Parts 4b → 4a → 5 → 2 → 3 → 1 → 6.

---

## Implementation status legend

| Symbol | Meaning                                                 |
| ------ | ------------------------------------------------------- |
| ✅     | Fully implemented — no further work needed              |
| ⚠️     | Partially implemented — rework / additional work needed |
| ❌     | Absent — full implementation needed                     |

---

## Part 1 — Security Review & Baseline (SECURITY-BASELINE.md)

> **Priority: 3 | Severity: 3 | Complexity: 2**

Create a living `SECURITY-BASELINE.md` document at the repo root mapping the project into OWASP ASVS categories.

### Requirements

| #   | Requirement                                                                                                                  | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.1 | Document current posture for each ASVS category (Authentication, Access Control, Secrets, Transport, Input Surface, Logging) | ✅     |
| 1.2 | For each category, list: what exists, residual risk, what was added in this HW, backlog/TODO                                 | ✅     |
| 1.3 | Translate the checklist into a concrete engineering backlog with actionable items                                            | ✅     |

### Current state

No `SECURITY-BASELINE.md` exists. Architecture docs (`docs/backend/architecture/`) cover individual features but no unified security posture document.

### What to implement

- Create `SECURITY-BASELINE.md` at repo root
- Populate each ASVS category with current findings (much of the analysis is already available from the architecture docs — consolidate it)
- Include a summary table and backlog section

---

## Part 2 — Secrets Management

> **Priority: 3 | Severity: 4 | Complexity: 2**

### Requirements

| #   | Requirement                                                                      | Status                       |
| --- | -------------------------------------------------------------------------------- | ---------------------------- |
| 2.1 | Secrets are not hardcoded in application code                                    | ✅                           |
| 2.2 | Secrets are not committed to the repository                                      | ✅                           |
| 2.3 | Secrets are not logged (raw JWT, passwords, payment details)                     | ✅                           |
| 2.4 | Environment separation — different configs for dev/test/prod                     | ✅                           |
| 2.5 | Env validation at startup (fail-fast on missing secrets)                         | ✅                           |
| 2.6 | Secrets delivery — document current flow (Pulumi ESC → AWS runtime stores → ECS) | ✅                           |
| 2.7 | Document what must never be logged                                               | ✅                           |
| 2.8 | Secrets rotation strategy (JWT, DB, AWS)                                         | 🔜 Deferred to AWS migration |
| 2.9 | External secrets manager integration                                             | ✅                           |

### Current secrets delivery flow

```
Pulumi ESC (rd-shop/stage, rd-shop/production)
  │  deploy-time Pulumi config via imported stack environments
  ↓
GitHub Actions deploy workflow
  │  OIDC AWS auth + Pulumi CLI + imported ESC values
  ↓
AWS Secrets Manager + SSM Parameter Store
  │  Pulumi publishes runtime secrets and non-secret config
  ↓
ECS task definitions (`valueFrom` by ARN / parameter name)
  │
  ↓
Container env at task start
```

**Security properties of current flow:**

- Deploy-time Pulumi secrets live in Pulumi ESC, not active stack-local `secure:` entries
- Runtime app secrets are injected from Secrets Manager / SSM, not copied onto a VM filesystem
- Per-environment isolation exists at three layers: GitHub Environments, Pulumi ESC environments, and AWS runtime secret names / SSM paths
- Production deploys still require manual approval gate
- ECS task execution role is scoped to the runtime secret ARN set and SSM path prefix
- Deploy-time secrets were rotated during the Pulumi ESC migration cutover

### Fully implemented

- **No hardcoded secrets in source** — all secrets loaded via `ConfigService` from env vars
- **Local `.env.*` files are gitignored and limited to dev / compose flows** — deployed stage / production runtime config no longer depends on VM env files
- **Env validation at startup** — `apps/shop/src/core/environment/schema.ts` and `apps/payments/src/core/environment/schema.ts` use `class-validator` decorators; app crashes immediately on invalid/missing vars
- **Separate env files still exist for local/dev flows** — `.env.development`, `.env.test`, `.env.production`, `.env.example` per service
- **Token secrets use `crypto.randomBytes()`** — no weak RNG
- **Deploy-time secrets isolated per stack** — `rd-shop/stage` and `rd-shop/production` are separate Pulumi ESC environments

### Partially implemented — rework needed

- **Secrets not logged** — `GlobalExceptionFilter` does not expose stack traces to clients (good), but no redaction of `Authorization` header or cookie values in internal logs exists yet. Blocked on Pino migration (observability plan Phase 1: `redact: ['req.headers.authorization', 'req.headers.cookie']`).
- **What-not-to-log documentation** — implicit in code (password `select: false`, token hashes only), but not formally documented

### What to deliver now

- **2.6 — Document the current secrets flow** in `SECURITY-BASELINE.md`: where deploy-time secrets live (Pulumi ESC), how runtime secrets reach ECS (Pulumi → Secrets Manager / SSM → task definitions), what can't be logged
- **2.7 — Formalize a "never-log" policy** — create a short list of fields/headers that must be excluded from logs (Authorization, cookie, password, tokenHash, raw JWT, payment card details). This list will feed into Pino `redact` config when implemented.

### Deferred to AWS migration plan

- **Secrets rotation** — external secret stores are now in place, but rotation automation and runbooks are still incomplete
  - **AWS Secrets Manager** — native path for runtime secret delivery and eventual rotation of managed credentials
  - **Pulumi ESC** — current deploy-time secret source for Pulumi stack config, but secret rotation is still procedural
- **Rotation automation** — JWT / RabbitMQ rotation still needs an explicit operational runbook and dual-key/cutover design where applicable

---

## Part 3 — Transport Security / TLS Posture

> **Priority: 2 | Severity: 3 | Complexity: 1**

> **Context:** The current production deployment is a pre-configured VM running Docker Compose — the same compose files used for local dev. There is no reverse proxy, load balancer, or TLS termination in the current setup. The entire Docker network topology (shop-network, internal networks, shared bridge) is a **local development workaround** and will be replaced during AWS migration (ALB + ECS / EKS). Implementing a reverse proxy or HTTPS redirect now would be throwaway work.

### Requirements

| #   | Requirement                                                        | Status                       |
| --- | ------------------------------------------------------------------ | ---------------------------- |
| 3.1 | Document where TLS terminates (current state + target state)       | ✅                           |
| 3.2 | HTTP → HTTPS redirect on edge                                      | 🔜 Deferred to AWS migration |
| 3.3 | Classify traffic: public / internal / trusted-by-placement         | ✅                           |
| 3.4 | Provide architecture note showing intended TLS design              | ✅                           |
| 3.5 | App-level TLS readiness (cookie secure flag, scheme-agnostic URLs) | ✅                           |

### Already TLS-ready in application code

- **Refresh cookie `secure: true` in production** — enforced via `isProduction()` check in cookie options
- **Scheme-agnostic URLs** — `APP_URL` env var drives all generated links (reset password, verification); no hardcoded `http://`
- **S3 presigned URLs** — generated as HTTPS by AWS SDK

### What to deliver now

A **transport security architecture note** in `SECURITY-BASELINE.md` covering:

**Current state (VM + Docker Compose):**

| Segment                    | Protocol | TLS | Notes                                     |
| -------------------------- | -------- | --- | ----------------------------------------- |
| Client → Shop API          | HTTP     | ❌  | No edge TLS; VM has no proxy/cert         |
| Shop → Postgres            | TCP      | ❌  | Same Docker network, trusted by placement |
| Shop → RabbitMQ            | AMQP     | ❌  | Same Docker network                       |
| Shop → MinIO (S3)          | HTTP     | ❌  | Same Docker network                       |
| Shop → Payments (gRPC)     | HTTP/2   | ❌  | Shared Docker bridge network              |
| Client → MinIO (presigned) | HTTP     | ❌  | Dev only; prod uses S3/CloudFront HTTPS   |

**Target state (AWS migration):**

| Segment                | Protocol      | TLS | Notes                                 |
| ---------------------- | ------------- | --- | ------------------------------------- |
| Client → ALB           | HTTPS         | ✅  | ACM certificate, TLS 1.2+             |
| ALB → Shop (ECS)       | HTTP          | ❌  | Internal VPC, trusted by placement    |
| Shop → RDS Postgres    | TCP           | ✅  | RDS enforces SSL by default           |
| Shop → AmazonMQ / SQS  | AMQPS / HTTPS | ✅  | Managed service, TLS enforced         |
| Shop → S3              | HTTPS         | ✅  | AWS SDK default                       |
| Shop → Payments (gRPC) | HTTP/2        | ✅  | Service mesh or internal ALB with TLS |
| Client → CloudFront    | HTTPS         | ✅  | ACM cert on distribution              |

### Deferred to AWS migration plan

- HTTP → HTTPS redirect (ALB listener rule)
- ACM certificate provisioning
- Security group / VPC configuration
- gRPC inter-service TLS (service mesh or mTLS)

---

## Part 4 — Rate Limiting & Security Headers

### Part 4a — Rate Limiting

> **Priority: 5 | Severity: 5 | Complexity: 3**

### Requirements

| #   | Requirement                                                        | Status |
| --- | ------------------------------------------------------------------ | ------ |
| 4.1 | Global rate-limiting policy for normal API traffic                 | ✅     |
| 4.2 | Stricter policy for risky endpoints (auth, payments, admin writes) | ✅     |
| 4.3 | Distinguish between normal and risky traffic throttling modes      | ✅     |
| 4.4 | GraphQL-aware throttling (GqlThrottlerGuard)                       | ✅     |
| 4.5 | Correct client IP resolution behind reverse proxy                  | ✅     |
| 4.6 | Document throttling evidence (429 response example)                | ❌     |

### Partially implemented — rework needed

- **DB-based rate limiting on two auth endpoints** — temporary workaround:
  - `forgotPassword` — max 3 password reset tokens per user per hour (DB query count)
  - `resendVerification` — max 1 email verification request per minute (DB recency check)
  - Both have explicit `TODO` comments referencing migration to `@nestjs/throttler`
- These are **application-level business rules**, not infrastructure rate limiting — they protect against abuse but not brute-force/DDoS

### Absent — full implementation needed

- **`@nestjs/throttler` integration** — package not yet installed; need:
  - `ThrottlerModule.forRoot()` with global default (e.g., 60 req/min)
  - `@Throttle({ default: { limit: 5, ttl: 60000 } })` on auth endpoints (`signin`, `signup`, `forgot-password`, `reset-password`, `refresh`)
  - `@Throttle()` on payment/refund actions and admin write endpoints
  - `GqlThrottlerGuard` for GraphQL mutations
  - Custom `UserEmailThrottleGuard` keying by `req.body.email` for unauthenticated auth endpoints
- **Proxy IP resolution** — `app.set('trust proxy', ...)` or `X-Forwarded-For` handling not configured
- **Evidence** — need example 429 response in docs

### Dependencies

```
npm install @nestjs/throttler
```

### Configuration

```typescript
ThrottlerModule.forRoot([
  { name: 'short', ttl: 1000, limit: 3 }, // 3 req/sec
  { name: 'medium', ttl: 10000, limit: 20 }, // 20 req/10sec
  { name: 'long', ttl: 60000, limit: 100 }, // 100 req/min
]);
```

Custom stricter limits on auth endpoints:

- `/auth/signin`: 5 attempts per minute per IP
- `/auth/forgot-password`: 3 per hour per email
- `/auth/refresh`: 10 per minute

> **Important:** `@nestjs/throttler` rate-limits by IP by default. The auth endpoints
> `forgot-password` (3/hour per email) and `resend-verification` (1/min per userId)
> must rate-limit by **user identity**, not IP, to prevent abuse across proxies.
> This requires a custom `ThrottlerGuard` that extracts the key from the request body
> or JWT payload:
>
> ```typescript
> @Injectable()
> export class UserEmailThrottleGuard extends ThrottlerGuard {
>   protected async getTracker(req: Request): Promise<string> {
>     return req.body?.email ?? req.ip;
>   }
> }
> ```
>
> When these guards are in place, remove the manual DB-based rate-limit queries
> (`threeHoursAgo` / `oneMinuteAgo`) from `AuthService.forgotPassword()` and
> `AuthService.resendVerification()`.

### Tasks

- [x] Install `@nestjs/throttler`
- [x] Configure `ThrottlerModule.forRoot()` with multi-tier limits
- [x] Apply `@Throttle()` on auth endpoints (`signin`, `forgot-password`, `refresh`)
- [x] Implement `UserEmailThrottleGuard` for identity-based throttling
- [x] Apply `@Throttle()` on payment/refund and admin write endpoints
- [x] Implement `GqlThrottlerGuard` for GraphQL mutations
- [x] Configure proxy IP resolution (`app.set('trust proxy', ...)`)
- [x] Remove DB-based rate-limit queries from `AuthService` after throttler is in place
- [ ] Tests: verify rate limit responses (429)

### Part 4b — Security Headers

> **Priority: 4 | Severity: 4 | Complexity: 1**

### Requirements

| #    | Requirement                                                      | Status |
| ---- | ---------------------------------------------------------------- | ------ |
| 4.7  | Helmet middleware (or equivalent explicit headers)               | ✅     |
| 4.8  | Surface-aware headers (API-only, Swagger UI, GraphQL playground) | ✅     |
| 4.9  | Document header baseline and rationale                           | ✅     |
| 4.10 | Evidence — example response with security headers                | ❌     |

### Absent — full implementation needed

- **`helmet` not installed** — zero security headers on any response
- Need to install `helmet` and add `app.use(helmet())` in `apps/shop/src/main.ts`
- Consider surface-specific overrides:
  - API-only: strict CSP (`default-src 'none'`)
  - GraphQL playground (dev only): relaxed CSP for inline scripts
  - Swagger UI (if enabled): CSP allowing Swagger assets
- Headers to set: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Content-Security-Policy`, `Referrer-Policy`, `X-XSS-Protection: 0` (deprecated but harmless)

### Dependencies

```
npm install helmet
```

### Configuration — `apps/shop/src/main.ts`

```typescript
app.use(helmet());
```

Sets secure HTTP headers automatically. Consider surface-specific overrides:

- API-only: strict CSP (`default-src 'none'`)
- GraphQL playground (dev only): relaxed CSP for inline scripts
- Swagger UI (if enabled): CSP allowing Swagger assets

### Tasks

- [x] Install `helmet`
- [x] Add `app.use(helmet())` in `main.ts`
- [x] Configure surface-aware CSP overrides if needed
- [ ] Verify headers with `curl -I`
- [x] Document header baseline in `SECURITY-BASELINE.md`

---

## Part 5 — Audit Logging

> **Priority: 4 | Severity: 4 | Complexity: 3**

### Requirements

| #   | Requirement                                                                                               | Status |
| --- | --------------------------------------------------------------------------------------------------------- | ------ |
| 5.1 | Structured audit logging for ≥ 3 critical events                                                          | ✅     |
| 5.2 | Audit event contains: action, actorId, actorRole, targetType, targetId, outcome, timestamp, correlationId | ✅     |
| 5.3 | Optional fields: reason, ip, userAgent                                                                    | ✅     |
| 5.4 | Sensitive data exclusion (no raw JWT, passwords, secrets, full payment details)                           | ✅     |
| 5.5 | Audit log answers: who did what, on what, when, with what result                                          | ✅     |

### Suggested critical events to audit (pick ≥ 3)

| Event                                                | Domain          | Why                           |
| ---------------------------------------------------- | --------------- | ----------------------------- |
| Login failure / suspicious auth                      | Auth            | Brute-force detection         |
| Role/scope change                                    | Admin           | Privilege escalation tracking |
| Order status change (manual override / cancellation) | Orders          | Financial audit trail         |
| Payment authorization                                | Payments (gRPC) | Financial compliance          |
| User soft-delete                                     | Admin           | Account lifecycle             |
| Password reset request / completion                  | Auth            | Account takeover detection    |
| File access policy change                            | Files           | Data access governance        |

### Partially implemented — rework needed

- **Sensitive data not exposed in HTTP responses** — `GlobalExceptionFilter` strips stack traces; password field uses `select: false`; error responses contain only sanitized messages
- **Request ID propagation** — `RequestIdMiddleware` generates/propagates `X-Request-ID` (can serve as `correlationId`)
- **Missing**: no dedicated audit log service, interceptor, or storage. Current logging is operational (NestJS Logger), not security-audit grade.

### Absent — full implementation needed

- **AuditLogService** — create a dedicated service that produces structured audit events
- **AuditLogInterceptor** (optional) — NestJS interceptor to auto-capture controller-level actions
- **Audit event schema** — define a standardized interface:
  ```
  { action, actorId, actorRole, targetType, targetId, outcome, timestamp, correlationId, ip?, userAgent?, reason? }
  ```
- **Integration** — wire into auth, admin, orders, and payments flows

### Storage decision: DB table vs. CloudWatch

| Criteria                    | DB table (`audit_logs`)                                                    | CloudWatch Logs                                                                    |
| --------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Setup complexity**        | Low — TypeORM entity + repository, same migrations pipeline                | Medium — AWS SDK integration, log group/stream management, IAM permissions         |
| **Query capability**        | Full SQL: `WHERE actorId = ? AND action = ? AND timestamp BETWEEN ? AND ?` | CloudWatch Insights query language (powerful but different syntax; higher latency) |
| **Retention control**       | Manual (cron/migration to archive old rows)                                | Built-in retention policies (1 day → 10 years), automatic                          |
| **Cost (current scale)**    | Free (same Postgres instance)                                              | Pay per ingestion + storage (~$0.50/GB ingest, $0.03/GB/month stored)              |
| **Cost (at scale)**         | Grows with DB — may need partitioning or archival                          | Scales linearly, no DB pressure                                                    |
| **Admin UI / search**       | Custom query or existing DB tooling (pgAdmin, DBeaver)                     | CloudWatch console, Logs Insights, or Grafana integration                          |
| **Tamper resistance**       | Mutable — app DB user can UPDATE/DELETE rows                               | Immutable — logs cannot be modified after ingestion                                |
| **Portability**             | Fully portable; no cloud vendor dependency                                 | AWS-only; migration to another cloud requires rewrite                              |
| **Latency**                 | Sub-ms (local DB write)                                                    | Network call per batch (~50-200ms); async batching mitigates impact                |
| **Availability coupling**   | Audit fails if DB is down (same failure domain)                            | Independent — audit works even if app DB is degraded                               |
| **AWS migration readiness** | Stays as-is with RDS; can migrate to CloudWatch later                      | Already in target stack; no rework after AWS migration                             |

**Recommendation:** Start with a **DB table** now:

- Zero external dependencies, fastest to implement, queryable with existing tooling
- Add a `NOT NULL` constraint on all required fields to enforce schema at DB level
- Design the `AuditLogService` interface to be storage-agnostic (repository pattern) so the backing store can be swapped to CloudWatch post-AWS-migration without touching callers
- Consider a `@Transactional` approach where the audit record is written in the same transaction as the business operation (guarantees audit trail even on partial failures)

---

## Part 6 — Evidence & Verification

> **Priority: 2 | Severity: 2 | Complexity: 1**

### Requirements

| #   | Requirement                                                | Status |
| --- | ---------------------------------------------------------- | ------ |
| 6.1 | Example response with security headers                     | ❌     |
| 6.2 | Example of rate limit triggering (429 response)            | ❌     |
| 6.3 | Document in README or security doc how to verify hardening | ✅     |

### Absent — full implementation needed

- After Parts 4-5 are implemented, capture:
  - `curl -I` output showing Helmet headers
  - Repeated `POST /auth/signin` showing 429 after threshold
  - Audit log entry for a critical action
- Add verification instructions to `SECURITY-BASELINE.md` or project README

---

## Summary — Grouped by Implementation Status

### ✅ Fully Implemented (no further work)

| Area                               | Details                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| JWT auth (access + refresh tokens) | Passport JWT, short-lived access (15m), opaque refresh in DB, bcrypt-hashed                                                   |
| RBAC guards & decorators           | `JwtAuthGuard`, `RolesGuard`, `ScopesGuard`, `@Roles()`, `@Scopes()`, `@CurrentUser()`                                        |
| Refresh token cookie security      | `httpOnly`, `secure` (prod), `sameSite: strict`, scoped to `/api/v1/auth`                                                     |
| Password hashing                   | bcrypt with configurable salt rounds (default 10), `select: false` on entity                                                  |
| Input validation                   | Global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `class-validator` DTOs                          |
| SQL injection prevention           | TypeORM parameterized queries, ILIKE wildcard escaping                                                                        |
| CORS configuration                 | Environment-driven origin allow-list, `credentials: true`, `maxAge: 86400`                                                    |
| Opaque token format validation     | `parseOpaqueToken()` rejects malformed tokens before DB/bcrypt work                                                           |
| User enumeration prevention        | `forgotPassword` always returns safe 200 regardless of email existence                                                        |
| Env var validation at startup      | `class-validator` schemas in both services; fail-fast on missing/invalid vars                                                 |
| Secret exclusion from repo         | Deploy-time secrets in Pulumi ESC; runtime secrets in Secrets Manager / SSM; local `.env.*` kept only for dev / compose flows |
| Docker security                    | Non-root user (1001), tini init, distroless option, `.env*` deleted at build time                                             |
| Error response sanitization        | No stack traces to clients; 4xx logged without trace, 5xx trace internal-only                                                 |
| Request ID propagation             | `X-Request-ID` middleware generates/forwards UUID per request                                                                 |
| Token reuse prevention             | Atomic `UPDATE … WHERE used_at IS NULL` on verification and reset tokens                                                      |
| Refresh token rotation             | Old token revoked atomically when new one is issued; single-session model                                                     |

### ⚠️ Partially Implemented — Rework / Additional Work Needed

| Area                                | What exists                                                   | What's missing                                                                           |
| ----------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Rate limiting on auth endpoints     | DB-based: forgot-password (3/hr), resend-verification (1/min) | Not infrastructure-grade; no global throttling; no `@nestjs/throttler`                   |
| Secrets not logged                  | Password `select: false`, no stack traces in responses        | No `Authorization` / cookie header redaction in internal logs; blocked on Pino migration |
| Sensitive data exclusion from audit | Passwords excluded from queries, error responses sanitized    | No formal "never-log" policy documented                                                  |

> **Note:** All items above are now fully implemented. Table preserved for historical reference.

### ❌ Absent — Full Implementation Needed

| Area                                                   | Part | Priority | Severity | Complexity |
| ------------------------------------------------------ | ---- | -------- | -------- | ---------- |
| Security baseline document (SECURITY-BASELINE.md)      | 1    | 3        | 3        | 2          |
| Secrets delivery flow documentation                    | 2    | 3        | 4        | 1          |
| "Never-log" policy document                            | 2    | 3        | 4        | 1          |
| Transport / TLS architecture note (current + target)   | 3    | 2        | 3        | 1          |
| Global rate limiting (`@nestjs/throttler`)             | 4a   | 5        | 5        | 3          |
| Per-endpoint strict throttling (auth, payments, admin) | 4a   | 5        | 5        | 3          |
| GraphQL throttling (`GqlThrottlerGuard`)               | 4a   | 5        | 5        | 3          |
| Proxy IP resolution (`trust proxy`)                    | 4a   | 5        | 5        | 3          |
| Security headers (`helmet`)                            | 4b   | 4        | 4        | 1          |
| Audit logging service (≥ 3 critical events, DB table)  | 5    | 4        | 4        | 3          |
| Audit event schema & storage-agnostic interface        | 5    | 4        | 4        | 3          |
| Evidence documentation (headers, 429, audit entry)     | 6    | 2        | 2        | 1          |

> **Note:** All items above are now fully implemented except evidence documentation (Part 6) and test coverage. Table preserved for historical reference.

### 🔜 Deferred to AWS Migration

| Area                                       | Part | Rationale                                                     |
| ------------------------------------------ | ---- | ------------------------------------------------------------- |
| Secrets rotation strategies (JWT, DB, AWS) | 2    | Requires external secrets manager (Secrets Manager vs. Vault) |
| External secrets manager integration       | 2    | Cloud-dependent; evaluate during AWS migration                |
| HTTP → HTTPS redirect                      | 3    | ALB listener rule; current VM has no proxy/cert               |
| ACM certificate / TLS termination          | 3    | AWS-native; no value implementing on throwaway VM             |
| CloudWatch audit log migration             | 5    | Start with DB table now; swap backing store post-migration    |

---

## Suggested Implementation Order

1. **Pino structured logging (Prerequisite)** — foundation for Parts 2.3, 4a, 4b, and 5
2. **Security headers (Part 4b)** — lowest complexity, high impact, quick win
3. **Rate limiting (Part 4a)** — highest priority+severity, protects auth surface
4. **Audit logging (Part 5)** — compliance requirement, DB table storage, storage-agnostic interface
5. **Secrets & TLS documentation (Parts 2 + 3)** — document current flow + target state, no code changes
6. **Security baseline doc (Part 1)** — consolidation of all above into OWASP-aligned document
7. **Evidence (Part 6)** — capture after implementation of Parts 2-5

---

## Dependency: Payments plan (Capture / Refund)

Payments plan Phases 1–2 deliver `POST /orders/:orderId/payment/capture` and `POST /orders/:orderId/payment/refund` — both admin-only financial write endpoints. They are **not** in scope for this security plan (they are business features, not security controls), but once implemented they need:

- **Part 4a** — `@Throttle()` on both endpoints (same strict policy as other admin write actions)
- **Part 5** — audit events for `PAYMENT_CAPTURED` and `PAYMENT_REFUNDED` status transitions

If security hardening lands first: adding throttle + audit to the new payment endpoints is a trivial follow-up during payments implementation. If payments lands first: the generic infrastructure (throttler, audit service) will retroactively cover them.

---

## Cross-references

- Observability & monitoring (CloudWatch Metrics, Dashboards, X-Ray): `docs/backend/requirements/observability-plan.md`
- Payments plan (Capture / Refund): `docs/backend/requirements/payments-plan.md` Phases 1–2
- Auth architecture: `docs/backend/architecture/feature-auth-rbac.md`
- Order flow (audit targets): `docs/backend/architecture/feature-order-creation-flow.md`
- Payments (audit targets): `docs/backend/architecture/feature-grpc-payments.md`
- Docker security: `docs/backend/architecture/infra-docker-compose.md`
- CI/CD & secrets delivery: `.github/workflows/deploy-stage.yml`, `.github/workflows/deploy-production.yml`
- Security architecture overview: `docs/backend/architecture/infra-security.md`
- Security baseline (OWASP ASVS mapping): `SECURITY-BASELINE.md`

---

## Part 7 — Gaps Identified vs. Raw Requirements

> Items discovered during review of `.temp/raw-security.md` that are not fully covered by Parts 1–6.

### 7.1 AUTH_SIGNUP / AUTH_LOGOUT audit events not wired

**Status:** ✅ Fixed

Both `AuditAction.AUTH_SIGNUP` and `AuditAction.AUTH_LOGOUT` were defined in the enum but not called in the service methods. Now wired:

- `AuthService.signup()` — fires `AUTH_SIGNUP` after user persisted
- `AuthService.logout()` — fires `AUTH_LOGOUT` after refresh token revoked; controller passes `actorId` from `@CurrentUser()` and `AuditEventContext` from `@Req()`

### 7.2 Payment capture/refund audit events

**Status:** 🔜 Blocked on payments plan Phases 1–2

`PAYMENT_CAPTURED` and `PAYMENT_REFUNDED` action constants need to be added to `AuditAction` enum and wired into the payment service once those endpoints are implemented. See [Dependency: Payments plan](#dependency-payments-plan-capture--refund).

### 7.3 Security evidence files not generated

**Status:** ❌ Manual step — see Part 8 below

The raw requirements expect a `security-evidence/` directory with actual captured output (curl responses, Postman screenshots, DB query results). This requires a running instance of the application to capture. See Part 8 for the complete evidence checklist and where each artifact can be obtained.

### 7.4 No `security-evidence/` directory scaffold

**Tasks:**

- [ ] Create `security-evidence/` directory at repo root
- [ ] Capture and commit `headers.txt`
- [ ] Capture and commit `rate-limit.txt`
- [ ] Capture and commit `audit-log-example.txt`
- [ ] Commit `secret-flow-note.md` (can reference `SECURITY-BASELINE.md` Section 3)
- [ ] Commit `tls-note.md` (can reference `SECURITY-BASELINE.md` Section 4)

---

## Part 8 — Evidence Checklist

> Required evidence artifacts per raw-security.md Sections 6 and 7.

### 8.1 Security Headers (`security-evidence/headers.txt`)

**What to capture:** HTTP response headers showing Helmet output.

**How to reproduce:**

```bash
# Start the application locally (docker compose up or npm run start:dev)
curl -si http://localhost:8080/api/v1/products | \
  grep -Ei 'x-content-type|x-frame|content-security|strict-transport|referrer|x-dns|cross-origin'
```

**Expected output includes:**

```
content-security-policy: default-src 'none'; frame-ancestors 'none'
x-content-type-options: nosniff
x-frame-options: DENY
strict-transport-security: max-age=15552000; includeSubDomains
referrer-policy: no-referrer
x-dns-prefetch-control: off
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
```

**Save as:** `security-evidence/headers.txt`

---

### 8.2 Rate Limit Triggering (`security-evidence/rate-limit.txt`)

**What to capture:** HTTP 429 response with `X-RateLimit-*` headers after threshold is hit.

**Method A — signin (5/min per IP):**

```bash
for i in {1..6}; do
  curl -s -o /dev/null -w "Request $i: %{http_code}\n" \
    -X POST http://localhost:8080/api/v1/auth/signin \
    -H 'Content-Type: application/json' \
    -d '{"email":"test@example.com","password":"wrongpassword"}';
done
# Expected: 401 401 401 401 401 429
```

**Method B — Postman Collection Runner:**

1. Create a `POST /api/v1/auth/signin` request with wrong credentials
2. Run 6 iterations with 0ms delay in Collection Runner
3. Observe 429 on iteration 6 with `X-RateLimit-Remaining-medium: 0`

**Method C — forgot-password (3/hr per email, `UserEmailThrottleGuard`):**

```bash
for i in {1..4}; do
  curl -s -o /dev/null -w "Request $i: %{http_code}\n" \
    -X POST http://localhost:8080/api/v1/auth/forgot-password \
    -H 'Content-Type: application/json' \
    -d '{"email":"test@example.com"}';
done
# Expected: 200 200 200 429
```

**Response body on 429:**

```json
{ "statusCode": 429, "message": "ThrottlerException: Too Many Requests" }
```

**Response headers on 429:**

```
x-ratelimit-limit-medium: 5
x-ratelimit-remaining-medium: 0
x-ratelimit-reset-medium: <epoch-ms>
```

**Save as:** `security-evidence/rate-limit.txt`

---

### 8.3 Audit Log Entry (`security-evidence/audit-log-example.txt`)

**What to capture:** One or more rows from the `audit_logs` table after performing a tracked action.

**How to reproduce:**

```bash
# 1. Sign in with bad credentials to trigger AUTH_SIGNIN_FAILURE
curl -X POST http://localhost:8080/api/v1/auth/signin \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"wrong"}'

# 2. Query the audit_logs table
docker exec -it rd_shop_backend_shop_dev-postgres \
  psql -U postgres -d rd_shop_dev \
  -c "SELECT action, actor_id, outcome, ip, correlation_id, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 5;"
```

**Expected output (example):**

```
       action        | actor_id | outcome |    ip     |          correlation_id          |          created_at
---------------------+----------+---------+-----------+----------------------------------+----------------------------
 AUTH_SIGNIN_FAILURE |          | FAILURE | 127.0.0.1 | a1b2c3d4-...                     | 2026-04-07 19:00:00.000+00
```

**Additional events to demonstrate:**

- `ORDER_CREATED` — create an order via `POST /api/v1/orders`
- `USER_ROLE_CHANGED` — call `PATCH /api/v1/admin/users/:id/roles` as admin

**Save as:** `security-evidence/audit-log-example.txt`

---

### 8.4 Secrets Flow Note (`security-evidence/secret-flow-note.md`)

**What to provide:** Description of how secrets reach runtime.

**Source:** Copy or reference `SECURITY-BASELINE.md` Section 3 ("Secrets Management") — the delivery flow diagram and "what must never be logged" table are already there.

**Save as:** `security-evidence/secret-flow-note.md`

---

### 8.5 TLS Note (`security-evidence/tls-note.md`)

**What to provide:** Current TLS posture and intended target design.

**Source:** Copy or reference `SECURITY-BASELINE.md` Section 4 ("Transport Security / TLS") — current state table, target state table, and traffic classification are already there.

**Save as:** `security-evidence/tls-note.md`

---

### 8.6 Summary Table

| Evidence Artifact       | Status     | Source / How to Get It                                        |
| ----------------------- | ---------- | ------------------------------------------------------------- |
| `headers.txt`           | ❌ Pending | `curl -si localhost:8080/api/v1/products` against running app |
| `rate-limit.txt`        | ❌ Pending | Shell loop or Postman runner — `POST /auth/signin` × 6        |
| `audit-log-example.txt` | ❌ Pending | `docker exec ... psql` after triggering a tracked action      |
| `secret-flow-note.md`   | ❌ Pending | Extract from `SECURITY-BASELINE.md` Section 3                 |
| `tls-note.md`           | ❌ Pending | Extract from `SECURITY-BASELINE.md` Section 4                 |
| `SECURITY-BASELINE.md`  | ✅ Done    | `SECURITY-BASELINE.md` at repo root                           |

**All evidence requires a running Docker Compose environment.** Use:

```bash
cd apps/shop && docker compose -f compose.dev.yml up -d
```
