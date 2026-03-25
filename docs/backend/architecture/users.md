# rd_shop — Users Domain

## Entity

`apps/shop/src/users/user.entity.ts` — table `users`

| Column            | Type         | Constraints                                                                     |
| ----------------- | ------------ | ------------------------------------------------------------------------------- |
| `id`              | UUID PK      | auto-generated                                                                  |
| `email`           | varchar(320) | unique index `IDX_users_email_unique`                                           |
| `password`        | varchar(255) | nullable, `select: false`                                                       |
| `firstName`       | varchar(50)  | nullable                                                                        |
| `lastName`        | varchar(50)  | nullable                                                                        |
| `phone`           | varchar(20)  | nullable                                                                        |
| `city`            | varchar(100) | nullable                                                                        |
| `country`         | varchar(2)   | nullable, ISO 3166-1 alpha-2                                                    |
| `postcode`        | varchar(20)  | nullable                                                                        |
| `avatarId`        | UUID         | nullable FK → `file_records`, ON DELETE SET NULL, indexed `IDX_users_avatar_id` |
| `roles`           | text[]       | default `[]`                                                                    |
| `scopes`          | text[]       | default `[]`                                                                    |
| `isEmailVerified` | boolean      | default `false`                                                                 |
| `createdAt`       | timestamptz  | auto                                                                            |
| `updatedAt`       | timestamptz  | auto                                                                            |
| `deletedAt`       | timestamptz  | nullable, soft-delete                                                           |

### Relations

- `avatar: ManyToOne → FileRecord` (nullable, SET NULL on delete)
- `orders: OneToMany → Order` (inverse side; cascade lives on Order)

`password` is excluded from default `SELECT` queries via TypeORM `select: false`. Methods that need it (e.g. `changePassword`) use explicit `select: ['id', 'password']`.

Soft-delete via `@DeleteDateColumn` — TypeORM automatically adds `WHERE deleted_at IS NULL` to all queries.

## Module

`apps/shop/src/users/users.module.ts`

```
imports:  TypeOrmModule.forFeature([User]), ConfigModule, AuthModule, FilesModule
exports:  UsersService, TypeOrmModule
```

Dependencies: `AuthModule` (for `TokenService`), `FilesModule` (for `FilesService`). `ConfigModule` provides `BCRYPT_SALT_ROUNDS`.

## REST Endpoints

All endpoints live under `api/v1/users`. `JwtAuthGuard` is applied at the controller class level.

### Self-service (authenticated user)

| Method | Path                 | Body / Query        | Returns           | Notes                    |
| ------ | -------------------- | ------------------- | ----------------- | ------------------------ |
| GET    | `/users/me`          | —                   | `UserResponseDto` | Own profile + avatar URL |
| PATCH  | `/users/me`          | `UpdateProfileDto`  | `UserResponseDto` | Partial update           |
| PATCH  | `/users/me/password` | `ChangePasswordDto` | 204               | Revokes all tokens       |
| PUT    | `/users/me/avatar`   | `SetAvatarDto`      | `UserResponseDto` | See avatar flow below    |
| DELETE | `/users/me/avatar`   | —                   | 204               | Sets `avatarId = null`   |

### Admin-only (`RolesGuard` + `@Roles(ADMIN)`)

| Method | Path         | Body / Query   | Returns                | Notes       |
| ------ | ------------ | -------------- | ---------------------- | ----------- |
| GET    | `/users`     | `FindUsersDto` | `UsersListResponseDto` | Paginated   |
| GET    | `/users/:id` | —              | `UserResponseDto`      | By UUID     |
| DELETE | `/users/:id` | —              | 204                    | Soft-delete |

## Service Methods

`apps/shop/src/users/users.service.ts`

| Method           | Access | Key logic                                                                                                                      |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `getProfile`     | Self   | `findUserOrFail` → `UserResponseDto.fromEntity` → resolve avatar presigned URL                                                 |
| `updateProfile`  | Self   | `findUserOrFail` → `Object.assign(user, dto)` → save → resolve avatar URL                                                      |
| `changePassword` | Self   | Verify `newPassword === confirmedPassword` → bcrypt compare current → hash new → update + revoke all tokens via `TokenService` |
| `setAvatar`      | Self   | `findUserOrFail` first (prevents orphaned files) → `filesService.prepareFileForEntity` → save `avatarId`                       |
| `removeAvatar`   | Self   | Blind `update(userId, { avatarId: null })` — does not delete FileRecord or S3 object                                           |
| `findAll`        | Admin  | QueryBuilder with cursor pagination + optional ILIKE search                                                                    |
| `findById`       | Admin  | `findUserOrFail` → resolve avatar URL                                                                                          |
| `remove`         | Admin  | `findUserOrFail` → soft-delete + revoke all tokens (parallel)                                                                  |

### Private helpers

- `findUserOrFail(id)` — `findOne` + 404 guard; used by `findById`, `getProfile`, `remove`, `setAvatar`, `updateProfile`
- `resolveAvatarUrl(avatarId)` — delegates to `FilesService.getPresignedUrlForFileId`; returns `null` for missing or non-READY files

## Pagination — `findAll`

Cursor-based, ordered by `(createdAt DESC, id DESC)`.

```
1. Build QueryBuilder with .limit(limit + 1)   — fetch one extra to detect next page
2. If dto.search → ILIKE on firstName, lastName, email (wildcard-escaped, ESCAPE '\')
3. If dto.cursor → look up cursor user → andWhere composite (createdAt, id) condition
4. Slice result: page = first `limit` items, nextCursor = last item's id (if hasNextPage)
```

Search sanitization: `%`, `_`, `\` in user input are escaped before wrapping in `%…%`. DTO enforces `@MaxLength(100)`.

Default limit: 10. Max limit: 100. Both enforced via `class-validator` in `FindUsersDto`.

## Password Change Flow

```
1. Validate newPassword === confirmedPassword         → 400 if mismatch
2. Load user with password (select: false override)   → 404 if not found
3. bcrypt.compare(currentPassword, storedHash)        → 401 if wrong
4. bcrypt.hash(newPassword, saltRounds)
5. Promise.all: update password + revokeAllUserTokens → forces re-login
```

`BCRYPT_SALT_ROUNDS` read from config at construction time (default 10).

## Avatar Flow

### Set avatar (`PUT /users/me/avatar`)

```
1. findUserOrFail(userId)                              → 404 if user missing (before any file work)
2. filesService.prepareFileForEntity(userId, fileId)
   → findFileRecordOrFail                              → 404 if file missing
   → checkIsOwner                                      → 403 if not owner
   → checkFileExists in S3                             → 400 if not uploaded
   → mark READY if PENDING
   → return { fileId, presignedUrl }
3. user.avatarId = fileId → save
4. Return UserResponseDto with avatarUrl = presignedUrl
```

User existence is verified **before** `prepareFileForEntity` to prevent orphaned READY files on missing user.

Previous avatar is **not** deleted (S3 object or FileRecord) — orphan cleanup is deferred to a future cron job.

### Remove avatar (`DELETE /users/me/avatar`)

Sets `avatarId = null` on user. FileRecord and S3 object remain. No user existence check (blind update).

### Avatar URL resolution

`resolveAvatarUrl` → `FilesService.getPresignedUrlForFileId(avatarId)` → returns `null` unless `fileRecord.status === READY`.

Used by: `getProfile`, `findById`, `updateProfile`, `setAvatar` (inlined presigned URL from prepare step).

## Soft-Delete

`remove(id)` calls `userRepository.softDelete(id)` which sets `deletedAt` timestamp. TypeORM's `@DeleteDateColumn` filter automatically excludes soft-deleted users from all `find` / `findOne` / QueryBuilder queries.

On deletion, all refresh tokens for the user are revoked in parallel via `TokenService.revokeAllUserTokens`.

## DTOs

| DTO                    | Purpose                                 | Key validations                                                       |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `CreateUserDto`        | Auth signup (used by `AuthService`)     | `@IsEmail`, `@MaxLength(50)` names, `@MinLength(8)` password          |
| `UpdateProfileDto`     | Self-service profile update             | All optional; `@IsISO31661Alpha2` country; `@MaxLength` on all fields |
| `ChangePasswordDto`    | Password change                         | Three `@IsString @MinLength(8)` fields                                |
| `SetAvatarDto`         | Set avatar by file ID                   | `@IsUUID` fileId                                                      |
| `FindUsersDto`         | Admin user listing                      | `@IsUUID` cursor, `@Max(100)` limit, `@MaxLength(100)` search         |
| `UserResponseDto`      | All user responses                      | Maps from entity via `fromEntity()`; **never includes `password`**    |
| `UsersListResponseDto` | Paginated list wrapper                  | `data: UserResponseDto[]`, `limit`, `nextCursor`                      |
| `UpdateUserDto`        | Legacy admin update (not actively used) | Optional email, firstName, lastName, password                         |

## GraphQL

### UserType schema — `apps/shop/src/graphql/schemas/user.ts`

Exposes: `id`, `email`, `firstName`, `lastName`, `phone`, `city`, `country`, `postcode`, `avatarId`, `avatarUrl`, `isEmailVerified`, `roles`, `createdAt`, `updatedAt`, `orders`.

Does **not** expose: `password`, `scopes`, `deletedAt`.

### UsersResolver — `apps/shop/src/graphql/resolvers/users.ts`

Currently **commented out** — dropped temporarily while the main focus is on the REST API. When re-enabled:

- `user(id)` — nullable query; catches `NotFoundException` → returns `null`
- `users` — returns `UserResponseDto[]` mapped to `UserType[]`

### UserLoader — `apps/shop/src/graphql/loaders/user.ts`

Request-scoped DataLoader. Batches `userIds` → `repository.find({ id: In(ids) })`. Used by `OrdersResolver.user()` field to resolve order → user without N+1.

## Security

- **Authentication:** `JwtAuthGuard` on entire controller — all endpoints require valid JWT
- **Authorization:** Admin endpoints additionally guarded by `RolesGuard` + `@Roles(ADMIN)`
- **No user-to-user access:** Self-service endpoints always use `userId` from JWT (`user.sub`), never from request params
- **Password safety:** `select: false` on entity column; never mapped in `UserResponseDto.fromEntity()`
- **Input validation:** `ValidationPipe` with `whitelist: true` strips unknown properties
- **Search injection:** LIKE wildcards (`%`, `_`, `\`) escaped; `ESCAPE '\'` clause in SQL; parameterized queries throughout
