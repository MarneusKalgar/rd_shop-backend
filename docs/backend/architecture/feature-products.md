# rd_shop — Products Domain

## Product Entity

`apps/shop/src/products/product.entity.ts` — table `products`

| Column        | Type          | Constraints                                      |
| ------------- | ------------- | ------------------------------------------------ |
| `id`          | UUID PK       | auto-generated                                   |
| `title`       | varchar(200)  | unique index `IDX_products_title_unique`         |
| `description` | text          | nullable                                         |
| `brand`       | varchar(100)  | nullable                                         |
| `country`     | varchar(2)    | nullable, ISO 3166-1 alpha-2                     |
| `category`    | enum          | `ProductCategory`, default `other`               |
| `price`       | numeric(12,2) | indexed `IDX_products_price`                     |
| `stock`       | int           | default `0`                                      |
| `isActive`    | boolean       | default `true`                                   |
| `mainImageId` | UUID          | nullable FK → `file_records`, ON DELETE SET NULL |
| `createdAt`   | timestamptz   | auto                                             |
| `updatedAt`   | timestamptz   | auto                                             |
| `deletedAt`   | timestamptz   | nullable, soft-delete `@DeleteDateColumn`        |

### Relations

- `mainImage: ManyToOne → FileRecord` (nullable, SET NULL on delete)
- `orderItems: OneToMany → OrderItem` (inverse side)

Soft-delete via `@DeleteDateColumn` — TypeORM automatically adds `WHERE deleted_at IS NULL` to all queries. The FK from `order_items.productId` keeps historical data intact after soft-delete.

---

## ProductReview Entity

`apps/shop/src/products/product-review.entity.ts` — table `product_reviews`

| Column      | Type          | Constraints                        |
| ----------- | ------------- | ---------------------------------- |
| `id`        | UUID PK       | auto-generated                     |
| `productId` | UUID          | FK → `products`, ON DELETE CASCADE |
| `userId`    | UUID          | FK → `users`, ON DELETE CASCADE    |
| `rating`    | smallint      | `CHECK ("rating" BETWEEN 1 AND 5)` |
| `text`      | varchar(1000) | NOT NULL                           |
| `createdAt` | timestamptz   | auto                               |
| `updatedAt` | timestamptz   | auto                               |

**Constraints:**

- `@Unique('UQ_product_reviews_user_product', ['userId', 'productId'])` — one review per user per product
- `@Check('"rating" BETWEEN 1 AND 5')` — DB-level rating validation

### Relations

- `product: ManyToOne → Product` (CASCADE)
- `user: ManyToOne → User` (CASCADE)

---

## ProductCategory Enum & Category Constants

`apps/shop/src/products/constants/index.ts`

```typescript
export enum ProductCategory {
  ACCESSORIES = 'accessories',
  AUDIO = 'audio',
  CAMERAS = 'cameras',
  LAPTOPS = 'laptops',
  MONITORS = 'monitors',
  OTHER = 'other',
  PERIPHERALS = 'peripherals',
  SMARTPHONES = 'smartphones',
  STORAGE = 'storage',
  TABLETS = 'tablets',
  WEARABLES = 'wearables',
}
```

Each enum value has associated display metadata exported as two constants:

```typescript
export interface ProductCategoryMeta {
  name: ProductCategory; // enum value (used as the API key)
  nameEn: string; // English display name
  nameUk: string; // Ukrainian display name
}

export const PRODUCT_CATEGORIES_MAP: Map<ProductCategory, ProductCategoryMeta>;
export const PRODUCT_CATEGORIES: ProductCategoryMeta[]; // Array.from(PRODUCT_CATEGORIES_MAP.values())
```

`PRODUCT_CATEGORIES_MAP` enables O(1) lookup by enum key. `PRODUCT_CATEGORIES` is the ready-to-return ordered array used by the categories endpoint. Icons are intentionally omitted — they are mapped on the frontend side.

---

## Module

`apps/shop/src/products/products.module.ts`

```
controllers: ProductsController, AdminProductsController, ReviewsController
providers:   ProductsService, ProductsRepository, ReviewsService
imports:     TypeOrmModule.forFeature([Product, ProductReview]), forwardRef(() => FilesModule)
exports:     TypeOrmModule, ProductsService, ProductsRepository, ReviewsService
```

`forwardRef` is required because `FilesModule` exports `S3Service` used by `ProductsService`, and `FilesModule`'s `FileRecord` repository is injected via `TypeOrmModule`.

---

## REST API — Public Endpoints

`apps/shop/src/products/v1/products.controller.ts` — path `products`, no auth

| Method | Path          | Description                                        | Response                       |
| ------ | ------------- | -------------------------------------------------- | ------------------------------ |
| GET    | `/categories` | Static list of all categories with names and icons | `ProductCategoriesResponseDto` |
| GET    | `/`           | Paginated list with filters + sort                 | `ProductsListResponseDto`      |
| GET    | `/:id`        | Single product with images + rating                | `ProductDataResponseDto`       |

> `GET /categories` is declared **before** `GET /:id` in the controller to prevent NestJS from matching the literal segment `categories` as a UUID param.

### Query parameters (`FindProductsQueryDto`)

| Param       | Type               | Default     | Notes                                                                      |
| ----------- | ------------------ | ----------- | -------------------------------------------------------------------------- |
| `cursor`    | UUID               | —           | Keyset pagination cursor (product ID)                                      |
| `limit`     | int 1–50           | `10`        | —                                                                          |
| `sortBy`    | `ProductSortBy`    | `createdAt` | `createdAt \| price \| title`                                              |
| `sortOrder` | `SortOrder`        | `DESC`      | `ASC \| DESC`                                                              |
| `isActive`  | boolean            | —           | Filter by active status                                                    |
| `category`  | `ProductCategory`  | —           | Enum exact match                                                           |
| `brand`     | string \| string[] | —           | One or more brands; each matched via ILIKE partial match, joined with `OR` |
| `country`   | string \| string[] | —           | One or more ISO 3166-1 alpha-2 codes; exact match via `IN`                 |
| `minPrice`  | decimal string     | —           | Inclusive lower bound                                                      |
| `maxPrice`  | decimal string     | —           | Inclusive upper bound                                                      |
| `search`    | string             | —           | ILIKE on `title` OR `description`, max 200                                 |

Multi-value params accept either repeated query-string keys (`?brand=Sony&brand=Apple`) or a single value (`?brand=Sony`). A `@Transform(toArray)` decorator (from `common/dto`) normalises both forms to an array before validation.

Cursor is the `id` of the last product on the previous page. The `ProductsRepository.findWithFilters` method builds the full QueryBuilder with all filter/sort/pagination logic.

---

## REST API — Admin Endpoints

`apps/shop/src/products/v1/admin-products.controller.ts` — path `admin/products`  
Class-level guards: `JwtAuthGuard`, `RolesGuard(admin)`, `ScopesGuard`

| Method | Path                       | Scope                   | Response                       | Description                         |
| ------ | -------------------------- | ----------------------- | ------------------------------ | ----------------------------------- |
| POST   | `/`                        | `products:write`        | `ProductDataResponseDto` 201   | Create product                      |
| PATCH  | `/:id`                     | `products:write`        | `ProductDataResponseDto` 200   | Partial update                      |
| DELETE | `/:id`                     | `products:write`        | 204                            | Soft delete                         |
| GET    | `/:id/images`              | `products:images:read`  | `ProductImagesDataResponseDto` | List all associated images          |
| POST   | `/:id/images/:fileId`      | `products:images:write` | 204                            | Associate a READY file with product |
| DELETE | `/:id/images/:fileId`      | `products:images:write` | 204                            | Remove image association            |
| PATCH  | `/:id/images/:fileId/main` | `products:write`        | `ProductDataResponseDto` 200   | Promote image to main               |

---

## REST API — Review Endpoints

`apps/shop/src/products/v1/reviews.controller.ts` — path `products`

| Method | Path           | Guard         | Response                    | Description                    |
| ------ | -------------- | ------------- | --------------------------- | ------------------------------ |
| GET    | `/:id/reviews` | none (public) | `ReviewsListResponseDto`    | Paginated review list          |
| POST   | `/:id/reviews` | JwtAuthGuard  | `ReviewDataResponseDto` 201 | Create review for current user |
| PATCH  | `/:id/reviews` | JwtAuthGuard  | `ReviewDataResponseDto` 200 | Update current user's review   |
| DELETE | `/:id/reviews` | JwtAuthGuard  | 204                         | Delete current user's review   |

One review per user per product — enforced at DB level (`UNIQUE`) and application level (409 Conflict on duplicate create).

---

## Image Management Flow

Full lifecycle after file upload completes (`FileStatus.READY`):

```
POST /files/presigned-upload          → FileRecord created (PENDING, entityId = null)
CLIENT PUT → S3                       → file uploaded
POST /files/complete-upload           → FileRecord.status = READY
POST /admin/products/:id/images/:fileId
  → validates: product exists, file READY, file.entityId IS NULL
  → sets: FileRecord.entityId = productId
PATCH /admin/products/:id/images/:fileId/main   (optional)
  → validates: product exists, file READY, file.entityId = productId
  → sets: Product.mainImageId = fileId
  → returns: updated ProductDataResponseDto
DELETE /admin/products/:id/images/:fileId
  → sets: FileRecord.entityId = null
  → if fileId = product.mainImageId: also sets Product.mainImageId = null
```

**Public product response** (`GET /products/:id`):

- `mainImageUrl` — presigned download URL for the main image
- `images[]` — all READY `FileRecord`s where `entityId = productId`, **excluding** the main image (so the main image is never duplicated)

**Admin image list** (`GET /admin/products/:id/images`):

- Returns **all** associated images including the main image (for management UI purposes)

---

## Rating Computation

Ratings are computed on-demand via raw QueryBuilder — no stored columns.

**Single product** (`ReviewsService.getRatingInfo`):

```sql
SELECT ROUND(AVG(rating)::numeric, 2) AS "averageRating",
       COUNT(id)::int                  AS "reviewsCount"
FROM   product_reviews
WHERE  product_id = $1
```

**Batch for list endpoint** (`ReviewsService.getRatingInfoBatch`):

```sql
SELECT product_id,
       ROUND(AVG(rating)::numeric, 2) AS "averageRating",
       COUNT(id)::int                  AS "reviewsCount"
FROM   product_reviews
WHERE  product_id IN ($1, $2, ...)
GROUP BY product_id
```

Returns a `Map<productId, { averageRating, reviewsCount }>`. Products with no reviews are absent from the map — callers default to `{ averageRating: null, reviewsCount: 0 }`.

`ProductsService.findAll` calls `getRatingInfoBatch` after fetching the product page. `ProductsService.findById` calls `getRatingInfo` in a `Promise.all` alongside image resolution.

---

## Services

### `ProductsService` — `apps/shop/src/products/products.service.ts`

| Method            | Description                                                         |
| ----------------- | ------------------------------------------------------------------- |
| `getCategories()` | Returns `{ data: PRODUCT_CATEGORIES }` — static, no DB call         |
| `create(dto)`     | Validate title uniqueness (catches 23505), save, return DTO         |
| `findAll(query)`  | Delegates to `ProductsRepository.findWithFilters`, enriches ratings |
| `findById(id)`    | Loads product + images + rating in parallel                         |
| `update(id, dto)` | Partial update via `Object.assign`, re-fetches for response         |
| `remove(id)`      | `softDelete()` — sets `deletedAt`                                   |
| `addImage`        | Sets `FileRecord.entityId = productId` (validates READY + unowned)  |
| `removeImage`     | Nulls `FileRecord.entityId`; clears `mainImageId` if was main       |
| `listImages`      | Returns all READY files where `entityId = productId`                |
| `setMainImage`    | Sets `Product.mainImageId`; validates file is associated            |

Injects: `Repository<Product>` (TypeORM), `ProductsRepository` (custom), `Repository<FileRecord>`, `ReviewsService`, `S3Service`.

### `ReviewsService` — `apps/shop/src/products/reviews.service.ts`

| Method               | Description                                                      |
| -------------------- | ---------------------------------------------------------------- |
| `createReview`       | Checks duplicate → saves → re-fetches with `user` relation       |
| `getReviews`         | Cursor pagination by `createdAt DESC, id DESC`; joins `user`     |
| `updateReview`       | `findOne({ where: { productId, userId }, relations: ['user'] })` |
| `deleteReview`       | `findOne` + `repository.remove()`                                |
| `getRatingInfo`      | Single-product AVG/COUNT via raw QueryBuilder                    |
| `getRatingInfoBatch` | Multi-product AVG/COUNT grouped by `productId`                   |

Does **not** depend on `ProductsService` — injects `Repository<Product>` directly to avoid circular dependency.

### `ProductsRepository` — `apps/shop/src/products/product.repository.ts`

Custom repository (injectable class, not TypeORM `@EntityRepository`).

| Method              | Description                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `findWithFilters`   | Full-featured QueryBuilder: sort, cursor, search (ILIKE), price range, brand, country, category |
| `findByIds`         | Batch load by IDs — used by order creation                                                      |
| `findByIdsWithLock` | Pessimistic write lock — used during stock deduction in order creation                          |
| `saveProducts`      | Batch save                                                                                      |
