# Auth — Implementation Plan

## Current state

- JWT access token (15m), extracted from `Authorization: Bearer` header
- 2 endpoints: `POST /auth/signin` (returns `{ accessToken, user }`), `POST /auth/signup` (returns `{ id, email, message }`)
- No refresh token, no logout, no password reset, no email verification
- `SignupDto`: `email` + `password` (min 8 chars) — no password confirmation
- Signup creates users with empty `roles: []` and `scopes: []`
- No `cookie-parser` installed
- Roles/scopes: `text[]` columns, no enum — values only defined implicitly in seed data
- Guards: `RolesGuard` (OR — any matching role), `ScopesGuard` (AND — all scopes required)
- `JwtPayload` includes `sub`, `email`, `roles`, `scopes`
- No centralized token management — JWT signing scattered in `AuthService.generateAuthResponse()`

---

## Phase 1 — Refresh tokens

### 1.1 TokenService

Encapsulates all token operations. `AuthService` delegates to it.

```typescript
// apps/shop/src/auth/token.service.ts
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly configService: ConfigService,
  ) {}

  async generateAccessToken(user: User): Promise<string>;
  async generateRefreshToken(userId: string): Promise<string>; // returns raw token
  async storeRefreshToken(userId: string, rawToken: string): Promise<void>;
  async rotateRefreshToken(oldRawToken: string): Promise<{ accessToken; rawRefreshToken }>;
  async revokeRefreshToken(tokenHash: string): Promise<void>;
  async revokeAllUserTokens(userId: string): Promise<void>;
  async validateRefreshToken(rawToken: string): Promise<RefreshToken>;
}
```

### 1.2 RefreshToken entity — `apps/shop/src/auth/refresh-token.entity.ts`

Relation: **User (1) → RefreshToken (many)**. One-to-many because the table keeps history (revoked tokens remain as rows). Only one token is _active_ at a time (single-session design).

```
id:         UUID PK
userId:     UUID FK → users (CASCADE)
tokenHash:  varchar(255)     bcrypt hash of refresh token
expiresAt:  timestamptz
revokedAt:  timestamptz nullable
createdAt:  timestamptz
INDEX: (userId, revokedAt IS NULL)   — find active token
```

**Virtual property** (not stored in DB — computed from `revokedAt` and `expiresAt`):

```typescript
get isActive(): boolean {
  return this.revokedAt === null && this.expiresAt > new Date();
}
```

This allows clean checks in service code (`if (token.isActive)`) instead of repeating the two-condition logic.

On signin/refresh, any existing active token for the user is revoked before issuing a new one.

### 1.3 Cookie-based refresh token

**Install:** `npm install cookie-parser @types/cookie-parser`

**main.ts** addition:

```typescript
import cookieParser from 'cookie-parser';
app.use(cookieParser());
```

**Cookie settings:**

```typescript
// path derived from global prefix + version + controller path
const AUTH_PATH = `/${API_PREFIX}/v${DEFAULT_VERSION}/auth`;

const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: AUTH_PATH, // only sent to auth endpoints
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};
```

`API_PREFIX` and `DEFAULT_VERSION` should be extracted as shared constants (currently `'api'` and `'1'` are inline strings in `main.ts`).

**Flow:**

- `POST /auth/signin` → response body: `{ accessToken, user }` + `Set-Cookie: refreshToken=<token>; HttpOnly; ...`
- `POST /auth/refresh` → reads cookie, rotates token, sets new cookie
- `POST /auth/logout` → reads cookie, revokes token, clears cookie
- Refresh token **never appears in response body**

### 1.4 Signup changes

**Extended `SignupDto`:**

```typescript
class SignupDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(8)
  confirmedPassword: string; // NEW — must match password
}
```

Custom validator: `@Match('password')` or validation in service layer — `password !== confirmedPassword` → 400.

**Updated signup response:** Returns `{ accessToken, user }` + sets refresh token cookie (same as signin).

### 1.5 Endpoints

| Endpoint             | Method  | Auth          | Cookie                                                                  | Response body            |
| -------------------- | ------- | ------------- | ----------------------------------------------------------------------- | ------------------------ |
| `POST /auth/signin`  | updated | none          | Sets `refreshToken`                                                     | `{ accessToken, user }`  |
| `POST /auth/signup`  | updated | none          | None _(no tokens on signup — intentional deviation from original plan)_ | `{ id, email, message }` |
| `POST /auth/refresh` | new     | none (cookie) | Rotates `refreshToken`                                                  | `{ accessToken }`        |
| `POST /auth/logout`  | new     | JwtAuth       | Clears `refreshToken`                                                   | 204                      |

### 1.6 Env vars

```
JWT_REFRESH_EXPIRES_IN=7d    # refresh token TTL (default: 7d)
```

### 1.7 Tasks

- [x] Create `TokenService` — encapsulate all JWT + refresh token logic
- [x] Create `RefreshToken` entity (ManyToOne → User)
- [x] Generate migration: `npm run db:generate -- src/db/migrations/CreateRefreshTokens`
- [x] Install `cookie-parser`, configure in `main.ts`
- [x] Update `POST /auth/signin` — generate token pair, set refresh cookie, return `{ accessToken, user }`
- [x] Update `POST /auth/signup` — add `confirmedPassword` field + validation _(intentional deviation: tokens not issued on signup — user must sign in explicitly)_
- [x] Update `SignupDto` with `confirmedPassword`
- [x] Update `SigninResponseDto` (no `refreshToken` in body)
- [x] Implement `POST /auth/refresh` — read cookie, rotate token, set new cookie
- [x] Implement `POST /auth/logout` — revoke token, clear cookie
- [x] Register `TokenService` in `AuthModule`
- [x] Refactor `AuthService.generateAuthResponse()` to delegate to `TokenService`

---

## Phase 2 — Email verification

### 2.1 User entity addition

```
+ isEmailVerified: boolean (default false)
```

Both this column and the `EmailVerificationToken` entity (2.2) are covered by a single migration — see tasks section (2.6).

### 2.2 EmailVerificationToken entity

Relation: **User (1) → EmailVerificationToken (many)**. Multiple tokens may exist (old ones expire or get used, new ones issued on resend).

```
id:         UUID PK
userId:     UUID FK → users (CASCADE)
tokenHash:  varchar(255)
expiresAt:  timestamptz    (24h)
usedAt:     timestamptz nullable
createdAt:  timestamptz
```

### 2.3 MailService (shared)

**Install:** `npm install @aws-sdk/client-sesv2`

Single `MailModule` + `MailService` used by both auth and order emails.

```typescript
// apps/shop/src/mail/mail.service.ts
@Injectable()
export class MailService {
  constructor(private readonly sesClient: SESv2Client) {}

  async sendVerificationEmail(email: string, token: string): Promise<void>;
  async sendPasswordResetEmail(email: string, token: string): Promise<void>; // used in Phase 3
  async sendOrderConfirmation(to: string, order: Order): Promise<void>; // used by orders plan
  async sendOrderPaid(to: string, order: Order): Promise<void>;
  async sendOrderCancelled(to: string, order: Order): Promise<void>;
}
```

**Dev mode:** When `AWS_SES_REGION` is not set, log the email content to console instead of sending. Production uses AWS SES.

**Env vars:**

```
AWS_SES_REGION=us-east-1
SES_FROM_ADDRESS=noreply@rdshop.com
APP_URL=http://localhost:3000   # for building verification/reset links
```

### 2.4 Signup flow update

1. Create user (existing)
2. Issue tokens + cookie (from Phase 1)
3. Generate email verification token → hash and store in DB
4. Send verification email (or log in dev)
5. Return `{ accessToken, user }` — user can use the app immediately, `isEmailVerified: false` is non-blocking for now

### 2.5 Endpoints

| Endpoint                                | Auth    | Description                                                        |
| --------------------------------------- | ------- | ------------------------------------------------------------------ |
| `POST /api/v1/auth/verify-email`        | none    | Body: `{ token }` — validates token, sets `isEmailVerified = true` |
| `POST /api/v1/auth/resend-verification` | JwtAuth | Generates new token, sends email; rate limit: 1 per minute         |

### 2.6 Tasks

- [x] Add `isEmailVerified` to User entity
- [x] Create `EmailVerificationToken` entity (ManyToOne → User)
- [x] Generate migration: `npm run db:generate -- src/db/migrations/AddEmailVerification`
- [x] Create `MailModule` + `MailService` (with dev-mode console fallback)
- [x] Configure AWS SES client in `MailModule` (dev fallback: console logger when `AWS_SES_REGION` is not set)
- [x] Update signup flow — generate verification token + send email after user creation
- [x] Implement `POST /auth/verify-email` — validate token, mark user verified
- [x] Implement `POST /auth/resend-verification` — generate new token + send
- [x] Rate limiting on resend-verification

---

## Phase 3 — Password reset

### 3.1 PasswordResetToken entity

Relation: **User (1) → PasswordResetToken (many)**. Same pattern as verification tokens — old ones expire/get used.

```
id:         UUID PK
userId:     UUID FK → users (CASCADE)
tokenHash:  varchar(255)
expiresAt:  timestamptz    (1h)
usedAt:     timestamptz nullable
createdAt:  timestamptz
```

### 3.2 Endpoints

| Endpoint                            | Auth | Description                                                                                     |
| ----------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `POST /api/v1/auth/forgot-password` | none | Body: `{ email }` — sends reset link. **Always returns 200** (prevents user enumeration)        |
| `POST /api/v1/auth/reset-password`  | none | Body: `{ token, newPassword, confirmedPassword }` — resets password, revokes all refresh tokens |

### 3.3 Forgot password flow

1. Receive `{ email }`
2. Look up user by email — if not found, return 200 anyway (no enumeration)
3. If user exists: generate reset token → hash and store → send email via `MailService`
4. Return `{ message: 'If this email exists, a reset link has been sent' }`

### 3.4 Reset password flow

1. Receive `{ token, newPassword, confirmedPassword }`
2. Validate `newPassword === confirmedPassword` → 400 if mismatch
3. Find `PasswordResetToken` by hash — 400 if not found, expired, or already used
4. Hash `newPassword`, update user's password
5. Mark token as used (`usedAt = now`)
6. Revoke all refresh tokens for the user (force re-login)
7. Return `{ message: 'Password reset successfully' }`

### 3.5 Security

- Rate limit: 3 requests per hour per email on forgot-password
- Token expiry: 1 hour
- Single use: token invalidated after use
- Force re-login: all refresh tokens revoked on reset

### 3.6 Tasks

- [x] Create `PasswordResetToken` entity (ManyToOne → User)
- [x] Generate migration: `npm run db:generate -- src/db/migrations/CreatePasswordResetTokens`
- [x] Implement `POST /auth/forgot-password` — generate token, send email, always 200
- [x] Implement `POST /auth/reset-password` — validate token, update password, revoke refresh tokens
- [x] Add `sendPasswordResetEmail()` to `MailService` (scaffolded in Phase 2)
- [x] Rate limiting on forgot-password

---

## Phase 4 — Roles & scopes formalization

### 4.1 Problem

Currently roles and scopes are untyped `string[]`. Values only defined in seed data with inconsistent naming (`read:orders` vs `orders:read`). New users get empty arrays — no way to assign roles except direct DB manipulation.

### 4.2 Define enums

```typescript
// apps/shop/src/auth/constants/roles.ts
export enum UserRole {
  ADMIN = 'admin',
  SUPPORT = 'support',
  USER = 'user',
}

// apps/shop/src/auth/constants/scopes.ts
export enum UserScope {
  ORDERS_READ = 'orders:read',
  ORDERS_WRITE = 'orders:write',
  PRODUCTS_READ = 'products:read',
  PRODUCTS_WRITE = 'products:write',
  PRODUCTS_IMAGES_READ = 'products:images:read',
  PRODUCTS_IMAGES_WRITE = 'products:images:write',
  PAYMENTS_READ = 'payments:read',
  PAYMENTS_WRITE = 'payments:write',
  FILES_WRITE = 'files:write',
  USERS_READ = 'users:read',
  USERS_WRITE = 'users:write',
}
```

### 4.3 Default role/scopes on signup

New users automatically get:

```typescript
{
  roles: [UserRole.USER],
  scopes: [UserScope.ORDERS_READ, UserScope.ORDERS_WRITE, UserScope.FILES_WRITE, UserScope.PRODUCTS_READ],
}
```

### 4.4 Fix inconsistent seed data

Normalize existing seed data to use `resource:action` convention consistently (e.g., `read:orders` → `orders:read`).

### 4.5 Type-safe decorators

Update `@Roles()` and `@Scopes()` decorators to accept enum values:

```typescript
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
export const Scopes = (...scopes: UserScope[]) => SetMetadata(SCOPES_KEY, scopes);
```

### 4.6 Admin role management endpoint

```
PATCH /api/v1/admin/users/:userId/roles    body: { roles: UserRole[], scopes: UserScope[] }
```

Admin-only. Allows assigning/revoking roles and scopes for any user.

### 4.7 Tasks

- [x] Create `UserRole` and `UserScope` enums
- [x] Set default role + scopes on signup
- [x] Fix seed data — normalize to `resource:action` convention
- [x] Update `@Roles()` and `@Scopes()` decorators to use enums
- [x] Update guards to work with enum values
- [x] Admin endpoint for role/scope management
- [x] Generate migration: `npm run db:generate -- src/db/migrations/NormalizeRolesScopes` (review generated SQL — may need manual edits for data normalization)

---

## Phase 5 — OAuth2 social login (deferred)

Add Google/GitHub login via Passport strategies. Link accounts by email. Users authenticated via OAuth skip email verification.

---

## Implementation order

```
Phase 1 (Refresh tokens)       ← Foundation: TokenService, cookie-based refresh, signin/signup update
  ↓
Phase 2 (Email verification)   ← MailService + verification flow, integrated into signup
  ↓
Phase 3 (Password reset)       ← Builds on MailService from Phase 2 + TokenService from Phase 1
  ↓
Phase 4 (Roles & scopes)       ← Formalize access control
  ↓
Phase 5 (OAuth2)               ← Deferred
```

---

## Deprioritized

- **logout-all endpoint** — single-session model makes this unnecessary for now; can add later if multi-session support is needed
- **Multi-session support** — overkill for current project scope
- **Refresh token reuse detection** — relevant only with multi-session; the single active token model handles this implicitly (old token is always revoked)
