# rd_shop — Auth & RBAC

## Strategy

Passport JWT (`passport-jwt`). Bearer token extracted from `Authorization` header.

`JwtStrategy.validate(payload)` returns `{ sub, email, roles, scopes }` → attached to `request.user`.

## JWT payload

```typescript
{ sub: string, email: string, roles: string[], scopes: string[], iat, exp }
```

Default expiry: `JWT_ACCESS_EXPIRES_IN` (default `15m`).

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

## AuthService

`apps/shop/src/auth/auth.service.ts`

- `signup(dto)` — bcrypt hash password, create User, return JWT
- `signin(dto)` — bcrypt compare, return JWT
- Password field on User is nullable (users created by seeding may have no password)

## Health endpoints bypass auth

`HEALTH_PATHS_TO_BYPASS` in AppModule excludes `/health`, `/ready`, `/status` from JWT guards and `api/` prefix.

## userId source

`userId` is **never accepted in request body**. Always taken from `req.user.sub` (JWT token). Prevents spoofing.
