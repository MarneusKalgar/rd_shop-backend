## Overview

This document describes the implementation of a secure file upload system using presigned S3 URLs with a two-phase upload workflow. The system integrates with the **Products** domain to manage product images.

---

## 1. Domain Integration

### Integrated Domain: **Products**

The file upload feature is integrated with the **Products** module to manage product images.

**Implementation Details:**

- **Entity Association**: [`Product.mainImageId`](src/products/product.entity.ts) references [`FileRecord.id`](src/files/file-record.entity.ts)
- **Service Integration**: [`ProductsService.associateMainImage()`](src/products/products.service.ts) binds uploaded files to products
- **Database Migration**: [`AddProductMainImageRelation1771615585358`](src/db/migrations/1771615585358-AddProductMainImageRelation.ts) adds foreign key relationship

**Database Schema:**

```
FileRecord (1) ←───── (0..1) Product
   id                    main_image_id (FK, nullable)
```

**User Integration (Planned):**

The system is designed to support user avatars but is not yet implemented (see TODO in [`FilesService.associateFileWithEntity`](src/files/files.service.ts)):

```typescript
case 'user':
  // TODO: Implement user avatar association
  this.logger.log(`User avatar association not yet implemented`);
  break;
```

---

## 2. Presign → Upload → Complete Workflow

### Architecture Overview

The system uses a **two-phase upload pattern** to minimize server load and maximize security:

1. **Phase 1**: Generate presigned URL (server-side)
2. **Phase 2**: Direct S3 upload (client-side)
3. **Phase 3**: Complete and verify (server-side)

```
┌─────────────────────────────────────────────────────────┐
│ Client                                                   │
└─────────────────────────────────────────────────────────┘
     │
     │ 1. POST /v1/files/presigned-upload
     │    { entityType, entityId, contentType, size }
     ▼
┌─────────────────────────────────────────────────────────┐
│ Server: FilesService                                     │
│  • Generate S3 key: products/{entityId}/images/{uuid}    │
│  • Create FileRecord (status: PENDING)                   │
│  • Generate presigned PUT URL (15 min expiry)            │
└─────────────────────────────────────────────────────────┘
     │
     │ 2. Returns: { uploadUrl, fileId, key }
     ▼
┌─────────────────────────────────────────────────────────┐
│ Client                                                   │
│  • PUT file directly to S3 using uploadUrl               │
│  • No server involvement in actual upload                │
└─────────────────────────────────────────────────────────┘
     │
     │ 3. POST /v1/files/complete-upload
     │    { fileId, entityType }
     ▼
┌─────────────────────────────────────────────────────────┐
│ Server: FilesService                                     │
│  • Verify file exists in S3                              │
│  • Update status: PENDING → READY                        │
│  • Associate with product (set mainImageId)              │
└─────────────────────────────────────────────────────────┘
     │
     │ 4. Returns: { fileId, status: READY, publicUrl }
     ▼
┌─────────────────────────────────────────────────────────┐
│ Client: File upload complete                             │
└─────────────────────────────────────────────────────────┘
```

---

### Phase 1: Create Presigned Upload URL

**Endpoint**: `POST /v1/files/presigned-upload`

**Request:**

```json
{
  "entityType": "product",
  "entityId": "650e8400-e29b-41d4-a716-446655440001",
  "contentType": "image/jpeg",
  "size": 1024000
}
```

**Response:**

```json
{
  "uploadUrl": "https://rd-shop-files-private.s3.amazonaws.com/products/.../images/uuid.jpeg?X-Amz-Algorithm=...",
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "key": "products/650e8400.../images/uuid.jpeg",
  "status": "PENDING",
  "expiresInSeconds": 900,
  "uploadMethod": "PUT"
}
```

**Key Generation Logic**: [`getObjectKey()`](src/files/utils/files.ts)

```typescript
export const getObjectKey = (ownerId: string, dto: CreatePresignedUploadDto): string => {
  const fileId = randomUUID(); // Server-generated, client cannot control
  const extension = getFileExtension(dto.contentType);

  switch (dto.entityType) {
    case 'product':
      return `products/${dto.entityId}/images/${fileId}${extension}`;
    case 'user':
      return `users/${ownerId}/avatars/${fileId}${extension}`;
    default:
      return `misc/${ownerId}/${fileId}${extension}`;
  }
};
```

---

### Phase 2: Client Uploads Directly to S3

**Client-Side Implementation:**

```typescript
// Client receives presigned URL from Phase 1
const { uploadUrl } = await createPresignedUpload(formData);

// Direct upload to S3 (no server involvement)
const response = await fetch(uploadUrl, {
  method: 'PUT',
  body: file,
  headers: {
    'Content-Type': 'image/jpeg',
  },
});

if (response.status === 200) {
  console.log('Upload successful');
}
```

**Benefits:**

- ✅ **Reduced Server Load**: File data never touches application server
- ✅ **Scalability**: S3 handles upload bandwidth
- ✅ **Security**: Presigned URL has time limit (15 minutes)
- ✅ **Direct Transfer**: Client → S3 (no proxy)

---

### Phase 3: Complete Upload

**Endpoint**: `POST /v1/files/complete-upload`

**Request:**

```json
{
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "entityType": "product"
}
```

**Response:**

```json
{
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "READY",
  "bucket": "rd-shop-files-private",
  "key": "products/650e8400.../images/uuid.jpeg",
  "contentType": "image/jpeg",
  "size": 1024000,
  "ownerId": "user-uuid",
  "completedAt": "2024-06-01T12:00:00Z",
  "createdAt": "2024-06-01T11:55:00Z",
  "publicUrl": "https://...presigned-download-url..."
}
```

---

## 3. Access Control Implementation

### Multi-Layer Security Model

The file system implements **defense-in-depth** with multiple security layers:

```
┌──────────────────────────────────────────────────────────┐
│ Layer 1: Authentication (JWT)                             │
│  ✓ Valid JWT token required                               │
│  ✓ User identity verified                                 │
└──────────────────────────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 2: Role-Based Access Control (RBAC)                │
│  ✓ User must have 'admin' OR 'support' role              │
└──────────────────────────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 3: Scope-Based Permissions                         │
│  ✓ User must have specific scopes:                       │
│    - products:images:write (upload)                       │
│    - products:images:read (download)                      │
└──────────────────────────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 4: Ownership Validation                             │
│  ✓ User must own the file (fileRecord.ownerId === userId)│
└──────────────────────────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 5: Status Validation                                │
│  ✓ File must be READY for download                       │
└──────────────────────────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 6: S3 Bucket Security                               │
│  ✓ Private bucket (no public access)                     │
│  ✓ Presigned URLs required (time-limited)                │
└──────────────────────────────────────────────────────────┘
```

---

### Layer 1-3: Controller-Level Guards

**Implementation**: [`FilesController`](src/files/v1/files.controller.ts)

```typescript
@Controller({ path: 'files', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, ScopesGuard) // ✅ Applied to entire controller
export class FilesController {
  // Upload endpoints
  @Post('presigned-upload')
  @Roles('admin', 'support') // ✅ RBAC: admin OR support
  @Scopes('products:images:write') // ✅ Scope: must have write permission
  async createPresignedUpload(
    @CurrentUser() user: AuthUser, // ✅ JWT-verified user
    @Body() body: CreatePresignedUploadDto,
  ) {
    return this.filesService.createPresignedUpload(user.sub, body);
  }

  @Post('complete-upload')
  @Roles('admin', 'support')
  @Scopes('products:images:write')
  async completeUpload(/*...*/) {}

  // Download endpoints
  @Get(':fileId/url')
  @Roles('admin', 'support')
  @Scopes('products:images:read') // ✅ Read scope required
  async getFileUrl(/*...*/) {}

  @Get(':fileId')
  @Roles('admin', 'support')
  @Scopes('products:images:read')
  async getFileById(/*...*/) {}
}
```

---

### Layer 4: Ownership Validation

**Implementation**: [`FilesService.checkIsOwner()`](src/files/files.service.ts)

```typescript
checkIsOwner(fileRecord: FileRecord, userId: string) {
  const isOwner = fileRecord.ownerId === userId;

  if (!isOwner) {
    throw new ForbiddenException('You do not have access to this file');
  }
}
```

**Database Schema Enforcement:**

```typescript
// src/files/file-record.entity.ts
@Entity('file_records')
export class FileRecord {
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string; // ✅ Non-nullable

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  owner: User; // ✅ Required relationship
}
```

---

### Layer 5: Status Validation

**Status Enum:**

```typescript
export enum FileStatus {
  PENDING = 'PENDING', // After presigned URL created
  READY = 'READY', // After S3 upload verified
}
```

---

### Layer 6: S3 Bucket Security

**Bucket Configuration**: [`docker-compose.yml`](docker-compose.yml)

```yaml
minio-init:
  entrypoint: >
    /bin/sh -c "
    mc mb --ignore-existing local/${AWS_S3_BUCKET};
    mc anonymous set none local/${AWS_S3_BUCKET};
    # ✅ 'none' = no public access, presigned URLs required
    "
```

**Access Methods:**

| Access Type  | Method            | Expiration | Use Case               |
| ------------ | ----------------- | ---------- | ---------------------- |
| **Upload**   | Presigned PUT URL | 15 minutes | Client uploads file    |
| **Download** | Presigned GET URL | 1 hour     | Client downloads file  |
| **Public**   | CloudFront URL    | N/A        | Not implemented (TODO) |

**Environment Configuration**: [`.env.example`](.env.example)

```bash
AWS_S3_BUCKET=rd-shop-files-private  # ✅ Private bucket
AWS_S3_PRESIGNED_URL_EXPIRATION=900  # 15 min upload
AWS_S3_PRESIGNED_URL_DOWNLOAD_EXPIRATION=3600  # 1 hour download
```

---

### Path Isolation & Security

**Server-Controlled Key Generation:**

```typescript
// Client CANNOT control the S3 key
// Server generates key using:
// - User ID from JWT (ownerId)
// - Server-generated UUID (fileId)
// - Validated entity ID
// - Content type extension

const key = getObjectKey(userId, dto);
// Result: products/{entityId}/images/{random-uuid}.jpeg
```

**Benefits:**

- ✅ No path traversal attacks (`../` prevented)
- ✅ UUID prevents guessing file names
- ✅ Owner ID embedded in path
- ✅ Entity ID validated before use

**Input Validation**: [`CreatePresignedUploadDto`](src/files/dto/create-presigned-upload.dto.ts)

```typescript
export class CreatePresignedUploadDto {
  @IsUUID() // ✅ Must be valid UUID
  @IsOptional()
  entityId: string;

  @IsEnum(['product', 'user']) // ✅ Only allowed types
  @IsNotEmpty()
  entityType: 'product' | 'user';

  @IsIn(ALLOWED_IMAGE_MIME_TYPES) // ✅ Whitelist content types
  contentType: string;

  @Max(FILE_SIZE_LIMITS.MAX) // ✅ Max 10MB
  @Min(FILE_SIZE_LIMITS.MIN)
  size: number;
}
```

---

## 4. File URL Generation

### Overview

The system generates **two types of presigned URLs**:

1. **Upload URL**: Time-limited PUT URL for client to upload file
2. **Download URL**: Time-limited GET URL for client to view/download file

Both URLs are **temporary** and **secured by AWS signatures**.

---

### Upload URL Generation

**When**: During Phase 1 (Create Presigned Upload)

**Example URL:**

```
https://rd-shop-files-private.s3.eu-central-1.amazonaws.com/
  products/650e8400-e29b-41d4-a716-446655440001/images/a1b2c3d4-uuid.jpeg
  ?X-Amz-Algorithm=AWS4-HMAC-SHA256
  &X-Amz-Credential=AKIAIOSFODNN7EXAMPLE/20240601/eu-central-1/s3/aws4_request
  &X-Amz-Date=20240601T120000Z
  &X-Amz-Expires=900
  &X-Amz-SignedHeaders=content-length;content-type;host
  &X-Amz-Signature=abc123...
```

**URL Components:**

- **Bucket**: `rd-shop-files-private`
- **Key**: `products/{entityId}/images/{uuid}.jpeg`
- **Algorithm**: AWS4-HMAC-SHA256 signature
- **Expiration**: 900 seconds (15 minutes)
- **Signature**: Prevents tampering

---

### Download URL Generation

**When**: After upload completion, when user requests file access

**Endpoint**: `GET /v1/files/:fileId/url`

**Example Response:**

```json
{
  "url": "https://rd-shop-files-private.s3.amazonaws.com/products/.../images/uuid.jpeg?X-Amz-Algorithm=...&X-Amz-Expires=3600..."
}
```

---

### URL Embedding in File Records

**When Retrieving File Metadata:**

**Used In:**

- `POST /v1/files/complete-upload` response
- `GET /v1/files/:fileId` response

---

### Public URL Support (TODO)

**Current Limitation:**

The system does not yet support permanent public URLs via CloudFront/CDN.

**Note**: This method is defined but not yet integrated. The TODO comment in [`FilesService`](src/files/files.service.ts) line 20 indicates:

```typescript
// TODO add public URL generation logic
```

**Configuration**: [`.env.example`](.env.example)

```bash
AWS_CLOUDFRONT_URL=  # Optional CDN URL for public files
```

---

### URL Expiration Times

| URL Type         | Expiration | Configuration                                   | Use Case                             |
| ---------------- | ---------- | ----------------------------------------------- | ------------------------------------ |
| **Upload URL**   | 15 minutes | `AWS_S3_PRESIGNED_URL_EXPIRATION=900`           | Client must upload within 15 minutes |
| **Download URL** | 1 hour     | `AWS_S3_PRESIGNED_URL_DOWNLOAD_EXPIRATION=3600` | Client can download for 1 hour       |

**Security Benefits:**

- ✅ **Time-Limited Access**: URLs automatically expire
- ✅ **Single-Use Intent**: Upload URLs typically used once
- ✅ **Reduced Attack Surface**: Stolen URLs have limited validity
- ✅ **No Long-Term Credentials**: Client never sees AWS keys

---

## 5. Error Handling

### HTTP Status Codes

| Status  | Error          | Scenario                                  |
| ------- | -------------- | ----------------------------------------- |
| **400** | `BAD_REQUEST`  | File not uploaded to S3 before completion |
| **401** | `UNAUTHORIZED` | Invalid/expired JWT token                 |
| **403** | `FORBIDDEN`    | Insufficient role/scope or not file owner |
| **404** | `NOT_FOUND`    | File record doesn't exist                 |

**Examples:**

```typescript
// File not found in S3
throw new BadRequestException('File not found in S3 bucket. Please upload the file first.');

// Not file owner
throw new ForbiddenException('You do not have access to this file');

// File record not found
throw new NotFoundException(`File record with ID ${fileId} not found`);

// File not ready for download
throw new BadRequestException('File is not ready for download');
```

---

## 6. Configuration

### Environment Variables

**Required Configuration**: [`.env.example`](.env.example)

```bash
# AWS S3 Configuration
AWS_REGION=eu-central-1
AWS_S3_BUCKET=rd-shop-files-private
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Optional: For Cloudflare R2 or MinIO
AWS_S3_ENDPOINT=https://your-endpoint
AWS_S3_FORCE_PATH_STYLE=true

# Optional: CloudFront CDN
AWS_CLOUDFRONT_URL=https://your-cloudfront-domain

# Presigned URL Expiration
AWS_S3_PRESIGNED_URL_EXPIRATION=900           # 15 minutes for upload
AWS_S3_PRESIGNED_URL_DOWNLOAD_EXPIRATION=3600 # 1 hour for download
```

### File Size & Type Limits

**Constants**: [`src/files/constants/index.ts`](src/files/constants/index.ts)

```typescript
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const;

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MIN_FILE_SIZE_BYTES = 1;
```

---

## 7. Local Development with MinIO

### Docker Compose Setup

**Configuration**: [`docker-compose.yml`](docker-compose.yml)

```yaml
services:
  minio:
    image: minio/minio:latest
    container_name: rd_shop-minio
    environment:
      MINIO_ROOT_USER: ${AWS_ACCESS_KEY_ID:-minioadmin}
      MINIO_ROOT_PASSWORD: ${AWS_SECRET_ACCESS_KEY:-minioadmin}
    command: server /data --console-address ":9001"
    ports:
      - '9000:9000' # S3 API
      - '9001:9001' # Web Console
    volumes:
      - minio_rd_shop_files_module:/data

  minio-init:
    image: minio/mc:latest
    depends_on:
      - minio
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin;
      mc mb --ignore-existing local/rd-shop-files-private;
      mc anonymous set none local/rd-shop-files-private;
      "
```

**Access:**

- **S3 API**: `http://localhost:9000`
- **Web Console**: `http://localhost:9001`
- **Credentials**: `minioadmin / minioadmin`

---

## 9. API Documentation

### Swagger Endpoints

**Available at**: `http://localhost:4000/api-docs`

**Decorated with**: [`@ApiTags`, `@ApiOperation`, `@ApiResponse`](src/files/v1/files.controller.ts)

```typescript
@ApiTags('files')
@Controller({ path: 'files', version: '1' })
export class FilesController {
  @ApiOperation({
    summary: 'Create presigned upload URL',
    description: 'Generate a presigned URL for uploading a file to S3...',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    type: PresignedUploadResponseDto,
    description: 'Presigned URL created successfully',
  })
  @Post('presigned-upload')
  async createPresignedUpload(/*...*/) {}
}
```

---

## 10. Summary

### Key Features Implemented

✅ **Two-Phase Upload Workflow**: Presign → Upload → Complete
✅ **Direct S3 Upload**: Client uploads directly to S3 (reduced server load)
✅ **Multi-Layer Security**: JWT + RBAC + Scopes + Ownership + Status validation
✅ **Server-Controlled Keys**: Client cannot manipulate S3 object paths
✅ **Time-Limited URLs**: 15-minute upload, 1-hour download
✅ **Private Bucket**: No public access, presigned URLs required
✅ **Product Integration**: Files associated with products as `mainImageId`
✅ **Status Management**: PENDING → READY workflow with verification
✅ **Ownership Tracking**: All files tied to user accounts
✅ **Local Development**: MinIO Docker setup for S3-compatible storage

---

## Related Documentation

- **Authentication**: See homework on JWT implementation
- **Products Module**: [`ProductsService`](src/products/products.service.ts)
- **Database Migrations**: [`CreateFileRecordsTable1771615497787`](src/db/migrations/1771615497787-CreateFileRecordsTable.ts)
- **S3 Configuration**: [`.env.example`](.env.example)
