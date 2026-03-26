# Users — Implementation Plan

## Current state

- `User` entity: `id`, `email` (unique), `password` (nullable, select:false), `roles` text[], `scopes` text[]
- No firstName/lastName columns (DTOs reference them — mismatch)
- No profile fields (city, country, phone, etc.)
- No avatar support (FileRecord has `entityType: 'user'` TODO stub)
- `UsersController` exists with full CRUD routes but **all service methods return mock data**
- No auth guards on users controller
- `UsersService.findByEmail()` works (used by auth); everything else is mock

---

## Phase 1 — Entity update + profile fields

### 1.1 New columns on User entity

```
+ firstName:    varchar(50) nullable
+ lastName:     varchar(50) nullable
+ phone:        varchar(20) nullable
+ city:         varchar(100) nullable
+ country:      varchar(2) nullable      ISO 3166-1 alpha-2 (e.g., "US", "GB", "UA")
+ postcode:     varchar(20) nullable
+ avatarId:     uuid nullable FK → file_records (SET NULL on delete)
```

### 1.2 Migration

After updating the entity, auto-generate from the schema diff:

```bash
cd apps/shop && npm run db:generate -- src/db/migrations/AddUserProfileFields
```

### 1.3 Updated User entity

```typescript
@Entity('users')
class User {
  id: string; // UUID PK (existing)
  email: string; // unique (existing)
  password: string; // select: false (existing)
  roles: string[]; // text[] (existing)
  scopes: string[]; // text[] (existing)
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  city: string | null;
  country: string | null; // ISO 3166-1 alpha-2
  postcode: string | null;
  avatarId: string | null; // FK → file_records
  avatar: FileRecord | null; // ManyToOne relation
  createdAt: Date;
  updatedAt: Date;
}
```

### 1.4 Tasks

- [x] Add columns to `User` entity
- [x] Add `avatar` ManyToOne relation to `FileRecord` (same pattern as `Product.mainImage`)
- [x] Generate migration: `npm run db:generate -- src/db/migrations/AddUserProfileFields`
- [x] Update existing DTOs to remove firstName/lastName references that don't match (fix the mismatch)

---

## Phase 2 — Users CRUD (real implementation)

### 2.1 Implement service methods

Replace all mock/TODO returns with real logic:

| Method                       | Logic                                         | Access              |
| ---------------------------- | --------------------------------------------- | ------------------- |
| `getProfile(userId)`         | Find by id, exclude password                  | Self only (JwtAuth) |
| `updateProfile(userId, dto)` | Update own profile fields                     | Self only (JwtAuth) |
| `findAll(paginationDto)`     | Paginated list, exclude passwords             | Admin only          |
| `findById(id)`               | Find user by id                               | Admin only          |
| `remove(id)`                 | Soft delete or hard delete with cascade check | Admin only          |

### 2.2 Endpoints

| Method   | Path                        | Guards                 | Description                                                                   |
| -------- | --------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| `GET`    | `/api/v1/users/me`          | JwtAuth                | Get own profile                                                               |
| `PATCH`  | `/api/v1/users/me`          | JwtAuth                | Update own profile (name, phone, city, country, postcode)                     |
| `PATCH`  | `/api/v1/users/me/password` | JwtAuth                | Change password (body: `{ currentPassword, newPassword, confirmedPassword }`) |
| `GET`    | `/api/v1/users`             | JwtAuth + Roles(admin) | List all users (paginated)                                                    |
| `GET`    | `/api/v1/users/:id`         | JwtAuth + Roles(admin) | Get user by ID                                                                |
| `DELETE` | `/api/v1/users/:id`         | JwtAuth + Roles(admin) | Delete user                                                                   |

### 2.3 DTOs

**UpdateProfileDto:**

```typescript
class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string; // ISO 3166-1 alpha-2

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postcode?: string;
}
```

**ChangePasswordDto:**

```typescript
class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;

  @IsString()
  @MinLength(8)
  confirmedPassword: string; // must match newPassword
}
```

**UserResponseDto** (excludes password, used in all responses):

```typescript
class UserResponseDto {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  postcode: string | null;
  avatarId: string | null;
  roles: string[];
  createdAt: Date;
}
```

### 2.4 Password change logic

1. Verify `newPassword === confirmedPassword` → 400 if mismatch
2. Load user with password (`select: false` — need explicit query)
3. Verify `currentPassword` against stored hash → 401 if wrong
4. Hash `newPassword`, update user
5. Revoke refresh token (force re-login with new credentials) — depends on auth plan Phase 1

### 2.5 Integration with orders

User profile fields (`city`, `country`, `postcode`, `phone`, `firstName`, `lastName`) can be used as default shipping info when creating orders. The order creation flow can read these from the user profile, no separate Address entity needed.

### 2.6 Tasks

- [x] Implement `getProfile()` in `UsersService`
- [x] Implement `updateProfile()` in `UsersService`
- [x] Implement `findAll()` with cursor pagination
- [x] Implement `findById()`
- [x] Implement `remove()` — handle cascade (user with orders cannot be hard-deleted)
- [x] Implement `changePassword()` with current password verification
- [x] Add auth guards to `UsersController` (`JwtAuthGuard`, `RolesGuard`)
- [x] Add `GET /users/me` and `PATCH /users/me` endpoints
- [x] Add `PATCH /users/me/password` endpoint
- [x] Create DTOs: `UpdateProfileDto`, `ChangePasswordDto`, `UserResponseDto`
- [x] Ensure `password` is never included in any response

---

## Phase 3 — User avatar

### 3.1 Upload flow

Steps 1–2 of the presigned upload flow remain the same (get presigned URL, upload to S3). Step 3 changes — instead of completing via the generic files endpoint with `entityType=user`, the client calls a **dedicated user endpoint** to associate the avatar:

1. **`POST /api/v1/files/presigned-upload`** — create upload URL with `entityType: 'user'`, `entityId: userId`
2. **Client uploads to S3** via presigned PUT URL
3. **`PUT /api/v1/users/me/avatar`** — verify file in S3, mark as READY, associate with user

### 3.2 Endpoints

| Method   | Path                      | Guards  | Description                                                                                         |
| -------- | ------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `PUT`    | `/api/v1/users/me/avatar` | JwtAuth | Body: `{ fileId: string }`. Validates ownership, checks S3, marks file READY, sets `user.avatarId`. |
| `DELETE` | `/api/v1/users/me/avatar` | JwtAuth | Sets `avatarId = null` on user. Does **not** delete the FileRecord or S3 object.                    |

### 3.3 `PUT /users/me/avatar` logic

```
1. Load FileRecord by fileId — 404 if not found
2. Verify fileRecord.ownerId === currentUser.id — 403 if not
3. Verify file exists in S3 (S3Service.checkFileExists) — 400 if not
4. If fileRecord.status === PENDING:
     - Mark fileRecord.status = READY, set completedAt
5. Update user.avatarId = fileRecord.id
6. Return updated user profile (with avatar URL)
```

### 3.4 Remove `entityType=user` workaround from FilesService

The `'user'` case in `FilesService.associateFileWithEntity()` should be removed along with the TODO stub. The `entityType` field on `CreatePresignedUploadDto` / `CompleteUploadDto` keeps `'user'` as a valid value only for S3 key generation (`users/{ownerId}/avatars/{fileId}.ext`), but the files `complete-upload` endpoint should **not** perform avatar association. If `entityType=user` is passed to `complete-upload`, it marks the file as READY without any entity association.

### 3.5 `UsersService` methods

```typescript
async setAvatar(userId: string, fileRecordId: string): Promise<void> {
  await this.userRepository.update(userId, { avatarId: fileRecordId });
}

async removeAvatar(userId: string): Promise<void> {
  await this.userRepository.update(userId, { avatarId: null });
}
```

### 3.6 Tasks

- [x] Implement `setAvatar()` and `removeAvatar()` in `UsersService`
- [x] Add `PUT /users/me/avatar` — validate file ownership, S3 existence, mark READY, set avatarId
- [x] Add `DELETE /users/me/avatar` — set avatarId to null
- [x] Remove `'user'` case from `FilesService.associateFileWithEntity()` (keep entityType for S3 key path only)
- [x] Include avatar URL in `UserResponseDto` (presigned download or public URL)
- [ ] GraphQL: add `avatar` field on `UserType` with DataLoader

---

## Phase 4 — Admin users controller alignment

### Problem

Admin operations on users are split across two modules:

| Endpoint                                     | Controller        | Location                    | Guards                                         |
| -------------------------------------------- | ----------------- | --------------------------- | ---------------------------------------------- |
| `PATCH /api/admin/users/:userId/permissions` | `AdminController` | `admin/v1/admin.controller` | Class-level `JwtAuth + RolesGuard` (no Scopes) |
| `GET /api/v1/users`                          | `UsersController` | `users/v1/users.controller` | Method-level `@Roles(ADMIN) + RolesGuard`      |
| `GET /api/v1/users/:id`                      | `UsersController` | `users/v1/users.controller` | Method-level `@Roles(ADMIN) + RolesGuard`      |
| `DELETE /api/v1/users/:id`                   | `UsersController` | `users/v1/users.controller` | Method-level `@Roles(ADMIN) + RolesGuard`      |

Issues:

- `AdminController` has no URI versioning (route is `/admin`, not `/v1/admin`)
- `AdminController` uses `RolesGuard` but **not** `ScopesGuard` — inconsistent with `AdminProductsController`
- Admin user operations live in two different modules and controllers
- `UsersController` mixes self-service endpoints (`/me/*`) with admin endpoints, using method-level guards instead of class-level

### Target state

Follow the `AdminProductsController` pattern — a dedicated `AdminUsersController` inside the **users domain**:

```
apps/shop/src/users/v1/admin-users.controller.ts   ← NEW
```

```typescript
@ApiTags('admin / users')
@Controller({ path: 'admin/users', version: '1' })
@Roles(UserRole.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard, ScopesGuard)
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}
  // all admin user endpoints here
}
```

Route: `/api/v1/admin/users`

### 4.1 Endpoints to move into `AdminUsersController`

| Method   | Path               | Scopes        | Source                                              |
| -------- | ------------------ | ------------- | --------------------------------------------------- |
| `GET`    | `/`                | `USERS_READ`  | Move from `UsersController.getUsers()`              |
| `GET`    | `/:id`             | `USERS_READ`  | Move from `UsersController.getUserById()`           |
| `DELETE` | `/:id`             | `USERS_WRITE` | Move from `UsersController.deleteUser()`            |
| `PATCH`  | `/:id/permissions` | `USERS_WRITE` | Move from `AdminController.updateUserPermissions()` |

### 4.2 Move `updateUserPermissions` logic into `UsersService`

`AdminService` has a single method (`updateUserPermissions`) that operates on the `User` entity. `UsersService` already has the `userRepository` — absorb this method:

```typescript
// UsersService
async updateUserPermissions(
  userId: string,
  dto: UpdateUserPermissionsDto,
): Promise<UpdateUserPermissionsResponseDto> {
  const user = await this.userRepository.findOne({ where: { id: userId } });
  if (!user) throw new NotFoundException('User not found');
  await this.userRepository.update(userId, { roles: dto.roles, scopes: dto.scopes });
  return { message: 'User permissions updated successfully' };
}
```

### 4.3 Move DTOs

Move `UpdateUserPermissionsDto` and `UpdateUserPermissionsResponseDto` from `admin/dto/` to `users/dto/`.

### 4.4 Clean up `UsersController`

After extraction, `UsersController` keeps only self-service endpoints:

- `GET /me` — get own profile
- `PATCH /me` — update own profile
- `PATCH /me/password` — change password
- `PUT /me/avatar` — set avatar
- `DELETE /me/avatar` — remove avatar

No more method-level `@Roles(ADMIN)` or `@UseGuards(RolesGuard)` in this controller.

### 4.5 Simplify `AdminModule`

After moving `AdminController` + `AdminService` out:

- `AdminModule` keeps only the dev-only testing controllers (`AdminTestingController`, `AdminTestingService`)
- Remove `AdminController` and `AdminService` from `AdminModule`
- Remove `TypeOrmModule.forFeature([User])` (no longer needed — testing service creates its own user)
- Rename module to reflect its testing-only purpose, or keep as-is if testing controllers still need it

### 4.6 Register in `UsersModule`

Add `AdminUsersController` to the `controllers` array in `UsersModule`.

### 4.7 Tasks

- [x] Create `apps/shop/src/users/v1/admin-users.controller.ts` with class-level `@Roles(ADMIN)`, `@UseGuards(JwtAuthGuard, RolesGuard, ScopesGuard)`
- [x] Move `GET /`, `GET /:id`, `DELETE /:id` from `UsersController` to `AdminUsersController`
- [x] Move `PATCH /:id/permissions` from `AdminController` to `AdminUsersController`
- [x] Add `@Scopes()` decorator to each endpoint (`USERS_READ` / `USERS_WRITE`)
- [x] Move `updateUserPermissions` method from `AdminService` to `UsersService`
- [x] Move `UpdateUserPermissionsDto` and `UpdateUserPermissionsResponseDto` to `users/dto/`
- [x] Remove admin endpoints and method-level `@Roles` / `@UseGuards(RolesGuard)` from `UsersController`
- [x] Register `AdminUsersController` in `UsersModule`
- [x] Remove `AdminController` and `AdminService` from `AdminModule`
- [x] Update `AdminModule` — remove `TypeOrmModule.forFeature([User])` if no longer needed
- [ ] Update integration tests to use new `/api/v1/admin/users` routes

---

## Implementation order

```
Phase 1 (Entity + profile fields)   ← Foundation — migration first
  ↓
Phase 2 (CRUD implementation)        ← Unmock all service methods, add guards
  ↓
Phase 3 (Avatar)                     ← Builds on Phase 1 entity + existing file upload
  ↓
Phase 4 (Admin alignment)           ← Consolidate admin endpoints into users domain
```

---

## Testing

Deferred to dedicated testing plan. Key areas to cover:

- Profile CRUD (self-access vs admin access)
- Password change (current password validation)
- Avatar upload lifecycle
- Admin-only endpoints (role guard enforcement)
- Cannot delete user with existing orders
