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

- [ ] Add columns to `User` entity
- [ ] Add `avatar` ManyToOne relation to `FileRecord` (same pattern as `Product.mainImage`)
- [ ] Generate migration: `npm run db:generate -- src/db/migrations/AddUserProfileFields`
- [ ] Update existing DTOs to remove firstName/lastName references that don't match (fix the mismatch)

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

- [ ] Implement `getProfile()` in `UsersService`
- [ ] Implement `updateProfile()` in `UsersService`
- [ ] Implement `findAll()` with cursor pagination
- [ ] Implement `findById()`
- [ ] Implement `remove()` — handle cascade (user with orders cannot be hard-deleted)
- [ ] Implement `changePassword()` with current password verification
- [ ] Add auth guards to `UsersController` (`JwtAuthGuard`, `RolesGuard`)
- [ ] Add `GET /users/me` and `PATCH /users/me` endpoints
- [ ] Add `PATCH /users/me/password` endpoint
- [ ] Create DTOs: `UpdateProfileDto`, `ChangePasswordDto`, `UserResponseDto`
- [ ] Ensure `password` is never included in any response

---

## Phase 3 — User avatar

### 3.1 Reuse existing file upload pattern

The 3-step presigned upload flow already supports `entityType: 'user'` (with a TODO stub in `FilesService.associateFileWithEntity`). Implementation:

1. **`POST /api/v1/files/presigned-upload`** — create upload URL with `entityType: 'user'`, `entityId: userId`
2. **Client uploads to S3** via presigned PUT URL
3. **`POST /api/v1/files/:fileId/complete?entityType=user`** — verify + associate

### 3.2 Implement avatar association

In `FilesService.associateFileWithEntity()`, replace the TODO:

```typescript
case 'user':
  await this.usersService.associateAvatar(fileRecord.entityId!, fileRecord.id);
  break;
```

In `UsersService`:

```typescript
async associateAvatar(userId: string, fileRecordId: string): Promise<void> {
  await this.userRepository.update(userId, { avatarId: fileRecordId });
}
```

### 3.3 Dedicated endpoint (convenience)

```
PUT /api/v1/users/me/avatar     body: { fileId: string }
DELETE /api/v1/users/me/avatar
```

`PUT` — sets `avatarId` after file upload is complete (alternative to the `entityType` flow).
`DELETE` — sets `avatarId = null`.

### 3.4 Tasks

- [ ] Implement `associateAvatar()` in `UsersService`
- [ ] Wire up `'user'` case in `FilesService.associateFileWithEntity()`
- [ ] Add `PUT /users/me/avatar` and `DELETE /users/me/avatar` endpoints
- [ ] Include avatar URL in `UserResponseDto` (presigned download or public URL)
- [ ] GraphQL: add `avatar` field on `UserType` with DataLoader

---

## Implementation order

```
Phase 1 (Entity + profile fields)   ← Foundation — migration first
  ↓
Phase 2 (CRUD implementation)        ← Unmock all service methods, add guards
  ↓
Phase 3 (Avatar)                     ← Builds on Phase 1 entity + existing file upload
```

---

## Testing

Deferred to dedicated testing plan. Key areas to cover:

- Profile CRUD (self-access vs admin access)
- Password change (current password validation)
- Avatar upload lifecycle
- Admin-only endpoints (role guard enforcement)
- Cannot delete user with existing orders
