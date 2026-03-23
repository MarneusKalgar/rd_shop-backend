# rd_shop — Auth & RBAC

## Strategy

Passport JWT (`passport-jwt`). Bearer token extracted from `Authorization` header.

`JwtStrategy.validate(payload)` returns `{ sub, email, roles, scopes }` → attached to `request.user`.

Two-token scheme:

- **Access token** — short-lived JWT (`JWT_ACCESS_EXPIRES_IN`, default `15m`), sent as `Authorization: Bearer` header
- **Refresh token** — opaque token stored in DB, delivered via `HttpOnly` cookie (`refreshToken`), TTL `JWT_REFRESH_EXPIRES_IN` (default `7d`)

Refresh tokens are **not JWTs**. They are opaque `${uuid}:${randomHex}` strings. The UUID allows O(1) DB lookup; only the hex secret is bcrypt-hashed in the DB. This enables instant revocation and reuse detection without a JWT blocklist.

## JWT payload

```typescript
{ sub: string, email: string, roles: string[], scopes: string[], iat, exp }
```

## Guards

| Guard             | File           | Usage                                                             |
| ----------------- | -------------- | ----------------------------------------------------------------- |
| `JwtAuthGuard`    | `auth/guards/` | HTTP REST — `@UseGuards(JwtAuthGuard)` on controllers             |
| `GqlJwtAuthGuard` | `auth/guards/` | GraphQL — extends JwtAuthGuard, reads ctx from GraphQL context    |
| `RolesGuard`      | `auth/guards/` | Checks `user.roles.includes(role)` — any match                    |
| `ScopesGuard`     | `auth/guards/` | Checks `user.scopes.includes(scope)` for **every** required scope |

## Decorators

- `@Roles(...roles)` — `SetMetadata(ROLES_KEY, roles)` — enforced by RolesGuard
- `@Scopes(...scopes)` — `SetMetadata(SCOPES_KEY, scopes)` — enforced by ScopesGuard
- `@CurrentUser()` — param decorator; extracts `request.user` from HTTP or GQL context

## Endpoints

| Method | Path            | Auth    | Cookie                 | Response body            |
| ------ | --------------- | ------- | ---------------------- | ------------------------ |
| POST   | `/auth/signup`  | none    | none                   | `{ id, email, message }` |
| POST   | `/auth/signin`  | none    | Sets `refreshToken`    | `{ accessToken, user }`  |
| POST   | `/auth/refresh` | none    | Rotates `refreshToken` | `{ accessToken }`        |
| POST   | `/auth/logout`  | JwtAuth | Clears `refreshToken`  | 204                      |

Signup intentionally does **not** issue tokens — the user must sign in explicitly after registration.

## AuthService

`apps/shop/src/auth/auth.service.ts`

- `signup(dto)` — validates `password === confirmedPassword`, bcrypt hash, create User, return `{ id, email, message }`
- `signin(dto)` — bcrypt compare, delegate to `buildAuthResult(user)`, return `AuthResult`
- `refresh(cookieValue)` — throws `UnauthorizedException` if missing; delegates to `TokenService.rotateRefreshToken()`
- `logout(cookieValue)` — parses token ID from cookie value, delegates to `TokenService.revokeRefreshToken()`
- `buildAuthResult(user)` — private; runs `generateAccessToken` + `issueRefreshToken` in parallel via `Promise.all`

Password field on User has `select: false` — only loaded explicitly via `addSelect('user.password')`.

## TokenService

`apps/shop/src/auth/token.service.ts`

Encapsulates all token operations. `AuthService` delegates to it.

| Method                              | Description                                                              |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `generateAccessToken(user)`         | Signs and returns a JWT access token                                     |
| `issueRefreshToken(userId)`         | Revokes all active tokens for user, creates and returns new cookie value |
| `rotateRefreshToken(cookieValue)`   | Validates old token, revokes it, issues new access + refresh pair        |
| `validateRefreshToken(cookieValue)` | Parses `id:secret`, DB lookup, bcrypt compare, returns `RefreshToken`    |
| `revokeRefreshToken(tokenId)`       | Sets `revokedAt = now` on a single token                                 |
| `revokeAllUserTokens(userId)`       | Bulk revoke — used at signin (single-session model)                      |

Cookie value format: `${tokenId}:${rawSecret}` — UUID prefix for O(1) lookup, only the secret is bcrypt-hashed.

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

## Cookie constants

`apps/shop/src/auth/constants/cookie.ts`

```typescript
REFRESH_COOKIE_NAME = 'refreshToken';
REFRESH_COOKIE_OPTIONS; // httpOnly, secure (prod), sameSite: strict, path: /api/v1/auth, maxAge: 7d
REFRESH_COOKIE_CLEAR_OPTIONS; // same without maxAge — used by logout
```

## Health endpoints bypass auth

`HEALTH_PATHS_TO_BYPASS` in AppModule excludes `/health`, `/ready`, `/status` from JWT guards and `api/` prefix.

## userId source

`userId` is **never accepted in request body**. Always taken from `req.user.sub` (JWT token). Prevents spoofing.
