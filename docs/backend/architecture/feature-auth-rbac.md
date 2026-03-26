# rd_shop — Auth & RBAC

## Strategy

Passport JWT (`passport-jwt`). Bearer token extracted from `Authorization` header.

`JwtStrategy.validate(payload)` returns `{ sub, email, roles, scopes }` → attached to `request.user`.

Two-token scheme:

- **Access token** — short-lived JWT (`JWT_ACCESS_EXPIRES_IN`, default `15m`), sent as `Authorization: Bearer` header
- **Refresh token** — opaque token stored in DB, delivered via `HttpOnly` cookie (`refreshToken`), TTL `JWT_REFRESH_EXPIRES_IN` (default `7d`)

Refresh tokens are **not JWTs**. They are opaque `${uuid}:${randomHex}` strings. The UUID allows O(1) DB lookup; only the hex secret is bcrypt-hashed in the DB. This enables instant revocation and reuse detection without a JWT blocklist.

The same `${uuid}:${randomHex}` format is used for all three opaque token types (refresh, email verification, password reset). `parseOpaqueToken()` enforces a minimum raw-secret length of 64 characters to reject malformed inputs before any DB lookup or bcrypt work.

## JWT payload

```typescript
{ sub: string, email: string, roles: UserRole[], scopes: UserScope[], iat, exp }
```

## Guards

| Guard             | File           | Usage                                                             |
| ----------------- | -------------- | ----------------------------------------------------------------- |
| `JwtAuthGuard`    | `auth/guards/` | HTTP REST — `@UseGuards(JwtAuthGuard)` on controllers             |
| `GqlJwtAuthGuard` | `auth/guards/` | GraphQL — extends JwtAuthGuard, reads ctx from GraphQL context    |
| `RolesGuard`      | `auth/guards/` | Checks `user.roles.includes(role)` — any match                    |
| `ScopesGuard`     | `auth/guards/` | Checks `user.scopes.includes(scope)` for **every** required scope |

## Decorators

- `@Roles(...roles: UserRole[])` — `SetMetadata(ROLES_KEY, roles)` — enforced by RolesGuard
- `@Scopes(...scopes: UserScope[])` — `SetMetadata(SCOPES_KEY, scopes)` — enforced by ScopesGuard
- `@CurrentUser()` — param decorator; extracts `request.user` from HTTP or GQL context

## Endpoints

| Method | Path                        | Auth    | Cookie                 | Response body                               |
| ------ | --------------------------- | ------- | ---------------------- | ------------------------------------------- |
| POST   | `/auth/signup`              | none    | none                   | `{ id, email, message }`                    |
| POST   | `/auth/signin`              | none    | Sets `refreshToken`    | `{ accessToken, user }`                     |
| POST   | `/auth/refresh`             | none    | Rotates `refreshToken` | `{ accessToken }`                           |
| POST   | `/auth/logout`              | JwtAuth | Clears `refreshToken`  | 204                                         |
| POST   | `/auth/verify-email`        | none    | none                   | `{ message }`                               |
| POST   | `/auth/resend-verification` | JwtAuth | none                   | `{ message }`                               |
| POST   | `/auth/forgot-password`     | none    | none                   | `{ message }` (always 200 — no enumeration) |
| POST   | `/auth/reset-password`      | none    | none                   | `{ message }`                               |

Signup intentionally does **not** issue tokens — the user must sign in explicitly after registration.

## AuthService

`apps/shop/src/auth/auth.service.ts`

- `signup(dto)` — validates `password === confirmedPassword`, bcrypt hash, creates User with `NewUser` permissions, sends verification email, returns `{ id, email, message }`
- `signin(dto)` — bcrypt compare, delegates to `buildAuthResult(user)`, returns `AuthResult`
- `refresh(cookieValue)` — throws `UnauthorizedException` if missing; delegates to `TokenService.rotateRefreshToken()`
- `logout(cookieValue)` — parses token ID from cookie value, delegates to `TokenService.revokeRefreshToken()`; no-ops on invalid input
- `verifyEmail(token)` — delegates to `TokenService.consumeVerificationToken()`, sets `isEmailVerified = true` on the user
- `resendVerification(userId)` — throws if already verified or last token was issued < 1 minute ago; otherwise re-issues and resends
- `forgotPassword(dto)` — always returns safe 200; sends reset link only if user exists and rate limit (3 per hour) not reached
- `resetPassword(dto)` — validates passwords match, delegates to `TokenService.consumePasswordResetToken()`, hashes new password, revokes all refresh tokens
- `buildAuthResult(user)` — private; runs `generateAccessToken` + `issueRefreshToken` in parallel via `Promise.all`

Password field on User has `select: false` — only loaded explicitly via `addSelect('user.password')`.

## TokenService

`apps/shop/src/auth/token.service.ts`

Encapsulates all token operations. `AuthService` delegates to it.

| Method                                | Description                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `generateAccessToken(user)`           | Signs and returns a JWT access token                                                                               |
| `issueRefreshToken(userId)`           | Revokes all active tokens for user, creates and returns new cookie value                                           |
| `issueVerificationToken(userId)`      | Persists hashed record, returns raw `${id}:${secret}` string                                                       |
| `issuePasswordResetToken(userId)`     | Persists hashed record, returns raw `${id}:${secret}` string                                                       |
| `rotateRefreshToken(cookieValue)`     | Validates old token, atomically revokes it, issues new access + refresh pair                                       |
| `consumeVerificationToken(rawToken)`  | Validates token, atomically marks used (`UPDATE … WHERE used_at IS NULL AND expires_at > NOW()`); returns `userId` |
| `consumePasswordResetToken(rawToken)` | Validates token, atomically marks used (`UPDATE … WHERE used_at IS NULL`); returns `userId`                        |
| `validateRefreshToken(cookieValue)`   | Parses `id:secret`, DB lookup, bcrypt compare, returns `RefreshToken`                                              |
| `validateVerificationToken(rawToken)` | Parses `id:secret`, DB lookup, bcrypt compare, checks `isUsable`; returns stored record                            |
| `revokeRefreshToken(tokenId)`         | Sets `revokedAt = now` on a single token                                                                           |
| `revokeAllUserTokens(userId)`         | Bulk revoke — used at signin (single-session model) and password reset                                             |

Cookie/token value format: `${tokenId}:${rawSecret}` — UUID prefix for O(1) lookup, only the secret is bcrypt-hashed.

The `consume*` methods close the race window that exists when validate and mark-used are two separate operations: the atomic `UPDATE … WHERE … AND used_at IS NULL` ensures a second concurrent request sees 0 affected rows and receives a 400.

## RefreshToken entity

`apps/shop/src/auth/refresh-token.entity.ts` — table `refresh_tokens`

```
id:         UUID PK
userId:     UUID FK → users (CASCADE DELETE)
tokenHash:  varchar(255)     bcrypt hash of rawSecret
expiresAt:  timestamptz
revokedAt:  timestamptz nullable
createdAt:  timestamptz
INDEX: IDX_refresh_tokens_user_active (userId, revokedAt)
```

Virtual getter: `get isActive(): boolean` — `revokedAt === null && expiresAt > new Date()`

## EmailVerificationToken entity

`apps/shop/src/auth/email-verification-token.entity.ts` — table `email_verification_tokens`

```
id:         UUID PK
userId:     UUID FK → users (CASCADE DELETE)
tokenHash:  varchar(255)     bcrypt hash of rawSecret
expiresAt:  timestamptz      (default TTL: EMAIL_VERIFICATION_EXPIRES_IN, default 24h)
usedAt:     timestamptz nullable
createdAt:  timestamptz
```

Virtual getter: `get isUsable(): boolean` — `usedAt === null && expiresAt > new Date()`

## PasswordResetToken entity

`apps/shop/src/auth/password-reset-token.entity.ts` — table `password_reset_tokens`

```
id:         UUID PK
userId:     UUID FK → users (CASCADE DELETE)
tokenHash:  varchar(255)     bcrypt hash of rawSecret
expiresAt:  timestamptz      (default TTL: PASSWORD_RESET_EXPIRES_IN, default 1h)
usedAt:     timestamptz nullable
createdAt:  timestamptz
```

Virtual getter: `get isUsable(): boolean` — `usedAt === null && expiresAt > new Date()`

## Roles & Scopes

Defined as enums in `apps/shop/src/auth/permissions/constants.ts`.

**`UserRole`**

| Value       | Constant           |
| ----------- | ------------------ |
| `'admin'`   | `UserRole.ADMIN`   |
| `'support'` | `UserRole.SUPPORT` |
| `'user'`    | `UserRole.USER`    |

**`UserScope`**

| Value                     | Constant                          |
| ------------------------- | --------------------------------- |
| `'files:write'`           | `UserScope.FILES_WRITE`           |
| `'orders:read'`           | `UserScope.ORDERS_READ`           |
| `'orders:write'`          | `UserScope.ORDERS_WRITE`          |
| `'payments:read'`         | `UserScope.PAYMENTS_READ`         |
| `'payments:write'`        | `UserScope.PAYMENTS_WRITE`        |
| `'products:images:read'`  | `UserScope.PRODUCTS_IMAGES_READ`  |
| `'products:images:write'` | `UserScope.PRODUCTS_IMAGES_WRITE` |
| `'products:read'`         | `UserScope.PRODUCTS_READ`         |
| `'products:write'`        | `UserScope.PRODUCTS_WRITE`        |
| `'users:read'`            | `UserScope.USERS_READ`            |
| `'users:write'`           | `UserScope.USERS_WRITE`           |

**Predefined permission sets** — `apps/shop/src/auth/permissions/definitions.ts`

| Set                  | Roles       | Scopes                                                        |
| -------------------- | ----------- | ------------------------------------------------------------- |
| `NewUserPermissions` | `[USER]`    | `ORDERS_READ`, `ORDERS_WRITE`, `FILES_WRITE`, `PRODUCTS_READ` |
| `AdminPermissions`   | `[ADMIN]`   | all 11 scopes                                                 |
| `SupportPermissions` | `[SUPPORT]` | `ORDERS_READ`, `PAYMENTS_READ`, `PRODUCTS_READ`, `USERS_READ` |

`UserPermissions.NewUser` permissions are assigned automatically on `signup`.

## Cookie constants

`apps/shop/src/auth/constants/index.ts`

```typescript
REFRESH_COOKIE_NAME = 'refreshToken';
UUID_LENGTH = 36;
MIN_RAW_SECRET_LENGTH = 64; // minimum hex-secret length enforced in parseOpaqueToken()
buildRefreshCookieOptions(maxAge); // returns CookieOptions: httpOnly, secure (prod), sameSite: strict, path: /api/v1/auth
REFRESH_COOKIE_CLEAR_OPTIONS; // same base options without maxAge — used by logout
```

## Health endpoints bypass auth

`HEALTH_PATHS_TO_BYPASS` in AppModule excludes `/health`, `/ready`, `/status` from JWT guards and `api/` prefix.

## userId source

`userId` is **never accepted in request body**. Always taken from `req.user.sub` (JWT token). Prevents spoofing.
