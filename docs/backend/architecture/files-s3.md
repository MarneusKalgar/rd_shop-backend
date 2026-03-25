# rd_shop — Files & S3 Upload

## Upload flow (3-step)

```
1. POST /api/v1/files/presigned-upload
   → Validate contentType + size (see constraints)
   → Create FileRecord (status: PENDING)
   → Generate S3 object key
   → GetPresignedUploadUrl (PUT, default 900s TTL)
   → Return: { uploadUrl, fileId, key, expiresInSeconds, uploadMethod: 'PUT' }

2. CLIENT PUT request directly to S3 presigned URL
   (outside the API — no server involvement)

3. POST /api/v1/files/complete-upload { fileId }
   → HeadObjectCommand — verify file exists in S3
   → Update FileRecord: status = READY, completedAt = now
   → Return: { fileId, status, publicUrl, ... }

--- product image association (separate calls, admin only) ---

4. POST /api/v1/admin/products/:id/images/:fileId
   → Validate product exists + file is READY + file has no entityId
   → Set FileRecord.entityId = productId
   → Return: 204

5. PATCH /api/v1/admin/products/:id/images/:fileId/main   (optional)
   → Validate product + file READY + file associated with product
   → Set Product.mainImageId = fileId
   → Return: 204
```

## FileRecord entity — `apps/shop/src/files/file-record.entity.ts`

| Field         | Type                 | Notes                                    |
| ------------- | -------------------- | ---------------------------------------- |
| `id`          | UUID PK              | —                                        |
| `bucket`      | varchar(120)         | S3 bucket                                |
| `key`         | varchar(500)         | Full S3 object key                       |
| `ownerId`     | UUID FK→User         | ON DELETE CASCADE                        |
| `entityId`    | UUID nullable        | Links to Product/User for association    |
| `size`        | bigint               | Bytes                                    |
| `contentType` | varchar(255)         | MIME type                                |
| `status`      | enum                 | PENDING → READY                          |
| `visibility`  | enum                 | PRIVATE (default) / PUBLIC               |
| `completedAt` | timestamptz nullable | Set on finalization                      |
| Indices       | —                    | owner_id, entity_id, object_key (unique) |

## S3 object key structure — `apps/shop/src/files/utils/`

```
product → products/{entityId}/images/{fileId}.{ext}
user    → users/{ownerId}/avatars/{fileId}.{ext}
other   → misc/{ownerId}/{fileId}.{ext}
```

Allowed extensions: `.jpeg`, `.jpg`, `.png`, `.webp`

## Constraints — `apps/shop/src/files/constants/index.ts`

```typescript
ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
MIN_FILE_SIZE_BYTES = 1;
```

## S3Service — `apps/shop/src/files/s3.service.ts`

| Method                      | AWS Command         | Notes                                                     |
| --------------------------- | ------------------- | --------------------------------------------------------- |
| `getPresignedUploadUrl()`   | `PutObjectCommand`  | Default 900s; `AWS_S3_PRESIGNED_URL_EXPIRATION`           |
| `getPresignedDownloadUrl()` | `GetObjectCommand`  | Default 3600s; `AWS_S3_PRESIGNED_URL_DOWNLOAD_EXPIRATION` |
| `checkFileExists()`         | `HeadObjectCommand` | Returns false on 404                                      |
| `getPublicUrl()`            | —                   | CloudFront URL > path-style URL > AWS virtual-hosted URL  |
| `healthCheck()`             | `HeadBucketCommand` | Used by `/ready` endpoint                                 |

## Environment variables

| Variable                                   | Required | Purpose                                                   |
| ------------------------------------------ | -------- | --------------------------------------------------------- |
| `AWS_S3_BUCKET`                            | ✅       | Target bucket                                             |
| `AWS_REGION`                               | ✅       | AWS region                                                |
| `AWS_ACCESS_KEY_ID`                        | ✅       | Credentials                                               |
| `AWS_SECRET_ACCESS_KEY`                    | ✅       | Credentials                                               |
| `AWS_S3_ENDPOINT`                          | optional | Custom endpoint (MinIO for local dev)                     |
| `AWS_S3_FORCE_PATH_STYLE`                  | optional | `true` for MinIO/path-style                               |
| `AWS_CLOUDFRONT_URL`                       | optional | CloudFront distribution; if set, used for all public URLs |
| `AWS_S3_PRESIGNED_URL_EXPIRATION`          | optional | Upload URL TTL (default 900s)                             |
| `AWS_S3_PRESIGNED_URL_DOWNLOAD_EXPIRATION` | optional | Download URL TTL (default 3600s)                          |

## Auth on file endpoints

**Upload endpoints** (`presigned-upload`, `complete-upload`): `JwtAuthGuard` + `RolesGuard(admin, support)` + `ScopesGuard(products:images:write)`  
**Product image management endpoints** (steps 4–5): `JwtAuthGuard` + `RolesGuard(admin)` + `ScopesGuard(products:images:write)` — live in `AdminProductsController`, not `FilesController`  
`userId` always taken from JWT, never from request body.

## GraphQL integration

`Product.mainImage` field resolved in `ProductsResolver` via `FileRecord.key` → presigned download URL.  
`FileRecord.status` must be `READY` — PENDING files are not surfaced.
