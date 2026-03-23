# Products — Implementation Plan

## Current state

- Entity: `Product` — id, title (unique), price decimal(12,2), stock int, isActive bool, mainImageId FK→FileRecord
- No REST controller — no `v1/` directory exists under `products/`
- `ProductsService` has only `associateMainImage()`; stock managed via repository locks during order creation
- GraphQL `ProductType` exists but no dedicated resolver; no `mainImage` field exposed
- 12 seed products exist (all electronics)
- No description, no brand, no country, no categories, no search, no sorting, no multiple images, no soft delete

---

## Phase 1 — Product entity extension + REST API (CRUD)

### 1.1 New columns on Product entity

```
+ description:  text nullable
+ brand:        varchar(100) nullable
+ country:      varchar(2) nullable      ISO 3166-1 alpha-2 (e.g., "US", "CN", "JP")
+ category:     varchar(50) NOT NULL DEFAULT 'other'    ProductCategory enum
+ deletedAt:    timestamptz nullable     @DeleteDateColumn (soft delete)
```

### 1.2 Updated Product entity

```typescript
@Entity('products')
class Product {
  id: string; // UUID PK (existing)
  title: string; // varchar(200), unique (existing)
  description: string | null; // NEW
  brand: string | null; // NEW
  country: string | null; // NEW — ISO 3166-1 alpha-2
  category: ProductCategory; // NEW — enum column, default 'other'
  price: string; // numeric(12,2) (existing)
  stock: number; // int, default 0 (existing)
  isActive: boolean; // default true (existing)
  mainImageId: string | null; // FK → file_records (existing)
  mainImage: FileRecord | null; // ManyToOne (existing)
  orderItems: OrderItem[]; // OneToMany (existing)
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null; // NEW — @DeleteDateColumn
}
```

### 1.3 ProductCategory enum

```typescript
// apps/shop/src/products/constants/category.ts
export enum ProductCategory {
  LAPTOPS = 'laptops',
  SMARTPHONES = 'smartphones',
  TABLETS = 'tablets',
  AUDIO = 'audio',
  WEARABLES = 'wearables',
  ACCESSORIES = 'accessories',
  MONITORS = 'monitors',
  STORAGE = 'storage',
  PERIPHERALS = 'peripherals',
  CAMERAS = 'cameras',
  OTHER = 'other',
}
```

Single `category` column per product. If multiple categories are needed later, the column can be changed to `text[]` (array) without a separate entity.

### 1.4 Migration

```bash
cd apps/shop && npm run db:generate -- src/db/migrations/ExtendProductEntity
```

### 1.5 Create `ProductsController` — `apps/shop/src/products/v1/products.controller.ts`

| Endpoint                      | Method      | Guards                 | Scopes         | DTO                                               |
| ----------------------------- | ----------- | ---------------------- | -------------- | ------------------------------------------------- |
| `GET /api/v1/products`        | list        | none (public)          | —              | `FindProductsQueryDto` → `GetProductsResponseDto` |
| `GET /api/v1/products/:id`    | get one     | none (public)          | —              | — → `GetProductResponseDto`                       |
| `POST /api/v1/products`       | create      | JwtAuth + Roles(admin) | products:write | `CreateProductDto` → `GetProductResponseDto`      |
| `PATCH /api/v1/products/:id`  | update      | JwtAuth + Roles(admin) | products:write | `UpdateProductDto` → `GetProductResponseDto`      |
| `DELETE /api/v1/products/:id` | soft delete | JwtAuth + Roles(admin) | products:write | — → 204                                           |

`DELETE` uses TypeORM `softDelete()` — sets `deletedAt`, doesn't remove the row. All queries use `@DeleteDateColumn` auto-filtering.

### 1.6 DTOs — `apps/shop/src/products/dto/`

```
CreateProductDto {
  title: string,
  price: string,
  stock: number,
  description?: string,
  brand?: string,
  country?: string,          // ISO 3166-1 alpha-2
  category?: ProductCategory, // default 'other'
  isActive?: boolean
}

UpdateProductDto {
  title?: string,
  price?: string,
  stock?: number,
  description?: string,
  brand?: string,
  country?: string,
  category?: ProductCategory,
  isActive?: boolean
}

FindProductsQueryDto {
  cursor?: UUID,
  limit?: number (1-50, default 10),
  isActive?: boolean,
  category?: ProductCategory,
  brand?: string,
  country?: string
}
```

### 1.7 Service methods to add

- `create(dto)` — validate title uniqueness (23505 catch), return product
- `findAll(filters)` — keyset cursor pagination (same pattern as orders)
- `findById(id)` — with mainImage relation
- `update(id, dto)` — partial update, 404 if not found
- `remove(id)` — soft delete via `softDelete()`; FK from order_items keeps historical data intact

### 1.8 Seed data expansion

Expand from 12 to ~48 products. Add `description`, `brand`, `country`, `category` to each seed product. Distribute across all `ProductCategory` values.

### 1.9 Tasks

- [ ] Add `description`, `brand`, `country`, `category`, `deletedAt` columns to `Product` entity
- [ ] Create `ProductCategory` enum
- [ ] Generate migration: `npm run db:generate -- src/db/migrations/ExtendProductEntity`
- [ ] Create `apps/shop/src/products/v1/products.controller.ts`
- [ ] Create DTOs: `create-product.dto.ts`, `update-product.dto.ts`, `find-products.dto.ts`, `product-response.dto.ts`
- [ ] Add service methods: `create`, `findAll`, `findById`, `update`, `remove` (soft delete)
- [ ] Add repository methods: `findWithFilters` (cursor pagination + category/brand/country filters)
- [ ] Register controller in `ProductsModule`
- [ ] Add Swagger decorators
- [ ] Expand seed data to ~48 products with new fields

---

## Phase 2 — Sorting & Filtering

### 2.1 Product listing sort options

| Sort field  | Column       | Notes                    |
| ----------- | ------------ | ------------------------ |
| `createdAt` | `created_at` | Default, existing index  |
| `price`     | `price`      | Needs index              |
| `title`     | `title`      | Already indexed (unique) |

### 2.2 Migration

```bash
cd apps/shop && npm run db:generate -- src/db/migrations/AddProductPriceIndex
```

Note: if the index can't be auto-generated (no entity change), add it manually in the generated migration file.

### 2.3 Extended query filters

Add to `FindProductsQueryDto`:

```
sortBy?: 'price' | 'title' | 'createdAt' (default 'createdAt')
sortOrder?: 'ASC' | 'DESC' (default 'DESC')
minPrice?: string
maxPrice?: string
search?: string    // ILIKE on title
```

### 2.4 Tasks

- [ ] Add `sortBy` + `sortOrder` to query builder
- [ ] Add `minPrice` / `maxPrice` to `FindProductsQueryDto`
- [ ] Add `search` filter (ILIKE on title)
- [ ] Add price index (migration or manual SQL)

---

## Phase 3 — Reviews (rating + comment)

### 3.1 ProductReview entity

```
id:         UUID PK
userId:     UUID FK → users (CASCADE)
productId:  UUID FK → products (CASCADE)
rating:     smallint NOT NULL          CHECK (rating BETWEEN 1 AND 5)
text:       varchar(1000) NOT NULL
createdAt:  timestamptz
updatedAt:  timestamptz
UNIQUE(userId, productId)              one review per user per product
```

Relation: **Product (1) → ProductReview (many)**, **User (1) → ProductReview (many)**.

One review per user per product. Users can update their review via PATCH.

**DB-level constraint:** `@Check('"rating" BETWEEN 1 AND 5')` on the entity — TypeORM generates the CHECK constraint in the migration. This enforces valid values regardless of application-layer validation.

### 3.2 Endpoints

| Endpoint                             | Method     | Guards  | Description                                              |
| ------------------------------------ | ---------- | ------- | -------------------------------------------------------- |
| `POST /api/v1/products/:id/reviews`  | create     | JwtAuth | Body: `{ rating: 1-5, text: string }` — both required    |
| `PATCH /api/v1/products/:id/reviews` | update own | JwtAuth | Body: `{ rating?: 1-5, text?: string }` — partial update |
| `GET /api/v1/products/:id/reviews`   | list       | public  | Paginated (cursor), includes user info                   |

No dedicated ratings endpoint — rating data is included in product responses (see 3.3).

### 3.3 Product responses enrichment

**`GET /api/v1/products`** — each product includes:

```typescript
{
  ...productFields,
  averageRating: number | null,   // AVG(rating), null if no reviews
  reviewsCount: number,           // COUNT(*)
}
```

**`GET /api/v1/products/:id`** — same fields plus authenticated user's own review (if exists).

**Service-level computation** (not `@VirtualColumn`): a private helper on `ProductsService` adds `LEFT JOIN` + `AVG` / `COUNT` to the QueryBuilder. Called only from `findAll()` and `findById()` — other callers (orders stock checks, image association, admin flows) skip the join and avoid the overhead.

```typescript
private applyRatingSelect(qb: SelectQueryBuilder<Product>): void {
  qb.leftJoin('product.reviews', 'review')
    .addSelect('ROUND(AVG(review.rating), 2)', 'averageRating')
    .addSelect('COUNT(review.id)::int', 'reviewsCount')
    .groupBy('product.id');
}
```

Fits naturally into the existing QueryBuilder-based cursor pagination. Can be replaced with cached columns later if needed.

### 3.4 Migration

```bash
cd apps/shop && npm run db:generate -- src/db/migrations/AddProductReviews
```

Review the generated migration and verify the `CHECK` constraint is included. If not, add manually:

```sql
ALTER TABLE "product_reviews" ADD CONSTRAINT "CHK_product_reviews_rating" CHECK ("rating" BETWEEN 1 AND 5);
```

### 3.5 Tasks

- [ ] Create `ProductReview` entity (ManyToOne → Product, ManyToOne → User, `@Check` for rating 1-5)
- [ ] Generate migration: `npm run db:generate -- src/db/migrations/AddProductReviews`
- [ ] Verify CHECK constraint in generated migration
- [ ] DTOs: `CreateReviewDto` (`{ rating, text }` — both required), `ReviewResponseDto`
- [ ] Service methods: `createReview`, `updateReview`, `getReviews` (paginated)
- [ ] Add `POST /products/:id/reviews`, `PATCH /products/:id/reviews`, and `GET /products/:id/reviews` endpoints
- [ ] Enrich `GET /products` response with `averageRating` + `reviewsCount`
- [ ] Enrich `GET /products/:id` response with `averageRating` + `reviewsCount` + user's own review

---

## Phase 4 — Multiple product images

### 4.1 Changes

Current: `Product.mainImageId` (1:1 FK to `FileRecord`)
New: Keep `mainImageId` + add `Product.images` (1:N via `FileRecord.entityId`)

FileRecord already has `entityId` column — just filter by `entityId = productId` + `status = READY`.

### 4.2 Endpoints

- `GET /api/v1/products/:id/images` — list all images for product
- `DELETE /api/v1/products/:id/images/:fileId` — remove image association
- `PATCH /api/v1/products/:id/images/:fileId/main` — set as main image

### 4.3 Tasks

- [ ] Add `images` field resolution (query `file_records WHERE entityId = productId AND status = READY`)
- [ ] REST endpoints for image management

---

## Phase 5 — Full-text search (deferred)

### 5.1 Options

| Approach                          | Complexity | Quality                                 |
| --------------------------------- | ---------- | --------------------------------------- |
| Postgres `tsvector` + `GIN` index | Low        | Good for title + description            |
| Elasticsearch / Meilisearch       | High       | Best for faceted search, typo tolerance |

### 5.2 Postgres approach (recommended starting point)

`description` column already exists (from Phase 1). Add `tsvector` generated column + GIN index.

Search endpoint: `GET /api/v1/products?q=<term>` using `plainto_tsquery`.

### 5.3 Tasks

- [ ] Migration: add tsvector generated column + GIN index
- [ ] Update query builder to support `q` parameter
- [ ] Update `FindProductsQueryDto`

---

## Implementation order

```
Phase 1 (Entity extension + CRUD)   ← Foundation: new fields, soft delete, controller, seed
  ↓
Phase 2 (Sorting & Filtering)       ← Enhances listing: sort, price range, search
  ↓
Phase 3 (Reviews)                   ← Single entity: rating + comment, 3 endpoints
  ↓
Phase 4 (Multiple images)           ← Builds on existing file upload pattern
  ↓
Phase 5 (Full-text search)          ← Deferred
```

---

## Testing

Deferred to dedicated testing plan. Key areas to cover:

- Products CRUD (public read vs admin write)
- Soft delete behavior (deleted products excluded from queries)
- Sorting + filtering combinations
- Rating upsert (create + overwrite) with CHECK constraint
- Reviews pagination
- Image management lifecycle
- Seed data integrity

---

## GraphQL

Deferred. Key areas to cover when prioritized:

- `ProductType` fields for new columns (description, brand, country, category)
- `mainImage` field on `ProductType`
- `images` field with DataLoader
- Category-based filtering in GraphQL queries
