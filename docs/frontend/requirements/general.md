# Frontend — General Requirements

Web client for the **rd_shop** e-commerce API. Two independently deployed SPAs — **public shop** and **admin panel** — sharing common code via a monorepo.

---

## 1. Monorepo Strategy

### Why Monorepo

Both apps share significant overlap:

| Shared Layer       | Examples                                                            |
| ------------------ | ------------------------------------------------------------------- |
| API types / DTOs   | `Product`, `Order`, `User`, `OrderStatus`, `ProductCategory` enums  |
| API client config  | Base URL, auth header injection, token refresh logic                |
| Validation schemas | Zod schemas for forms (login, signup, product, review)              |
| UI primitives      | MUI theme overrides, common layout components (Header, Sidebar)     |
| Utilities          | Currency formatter (`Intl.NumberFormat`), date helpers (`date-fns`) |

Without a monorepo you duplicate all of the above and keep two copies in sync manually.

### Pros

- Single `node_modules` — shared deps installed once, consistent versions
- Atomic cross-app changes — update a shared type and both apps compile-check immediately
- Unified linting / formatting / CI config
- Easier code review — one PR touches shared + app code together

### Cons

- Initial setup overhead (workspace config, build scripts)
- CI complexity — need to scope test/build to affected packages
- Potential for tight coupling if shared boundaries aren't enforced

### Recommended Tool — **pnpm workspaces**

| Tool               | Verdict                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **npm workspaces** | Works, but slower installs, no strict dependency isolation, weaker hoisting control                                                                                          |
| **yarn (berry)**   | PnP mode adds friction (IDE integration, patching), classic mode is fine but no strong advantage over pnpm                                                                   |
| **pnpm**           | Fastest installs, strict by default (packages can only import declared deps), content-addressable store saves disk, mature workspace support, `--filter` for scoped commands |

**Decision: pnpm workspaces** — strictness prevents phantom dependencies, performance is best-in-class, filter commands simplify CI.

### Proposed Workspace Layout

```
apps/
  shop/               → Public shop SPA (Vite)
  admin/              → Admin panel SPA (Vite)
packages/
  shared-types/       → TS types, enums, DTOs mirroring BE contracts
  shared-ui/          → Common MUI theme, reusable components
  shared-utils/       → Formatters, date helpers, constants
  api-client/         → Typed API client (shared base config, interceptors)
  validation/         → Zod schemas reused by both apps
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

---

## 2. Technology Stack

### Public Shop (`apps/shop`)

| Concern           | Library                                        | Notes                                                        |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Build             | **Vite** + `@vitejs/plugin-react`              | SPA-only, no SSR                                             |
| Language          | **TypeScript** (strict mode)                   |                                                              |
| UI framework      | **React 19**                                   |                                                              |
| Component library | **MUI v6** (`@mui/material`)                   | + `@emotion/react`, `@emotion/styled`, `@mui/icons-material` |
| State management  | **RTK** (`@reduxjs/toolkit`, `react-redux`)    | Global client state: auth, cart, UI                          |
| Data fetching     | **RTK Query** (built into RTK)                 | Server state: products, orders, user profile                 |
| Routing           | **TanStack Router** (`@tanstack/react-router`) | Type-safe, SPA-first, file-based route gen                   |
| Forms             | **React Hook Form** + `@hookform/resolvers`    | Uncontrolled inputs, minimal re-renders                      |
| Validation        | **Zod**                                        | Shared schemas between FE validation and BE contract         |
| Notifications     | **notistack**                                  | MUI-compatible snackbar toasts                               |
| Persistence       | **redux-persist**                              | Cart + auth token survive page refresh                       |
| Date formatting   | **date-fns**                                   | Tree-shakeable                                               |

### Admin Panel (`apps/admin`)

| Concern          | Library                                      | Difference from shop                                 |
| ---------------- | -------------------------------------------- | ---------------------------------------------------- |
| State management | **Zustand**                                  | Lighter — admin has less client-side state (no cart) |
| Data fetching    | **TanStack Query** (`@tanstack/react-query`) | More ergonomic for CRUD-heavy admin screens          |
| Everything else  | Same as shop                                 | MUI, TanStack Router, RHF, Zod, Vite, TS             |

### Dev Dependencies (both apps)

```
vite, @vitejs/plugin-react, typescript, @types/react, @types/react-dom
@tanstack/router-devtools
eslint, prettier
vitest (unit testing)
@testing-library/react, @testing-library/jest-dom (component testing)
playwright or cypress (e2e, optional)
```

---

## 3. Public Shop — Pages & Features

### 3.1 Main Page (`/`)

**Layout**: Header + Sidebar + Main content area

**Header**:

- App logo / home link
- Search bar — text input, filters products by title (`search` query param → `GET /api/v1/products?search=...`)
- Shopping cart icon with badge (item count from RTK store)
- User menu (avatar or login link)

**Sidebar**:

- **Categories list** — renders `ProductCategory` enum values (`laptops`, `smartphones`, `tablets`, etc.) as clickable filter links. Selecting a category applies `?category=<value>` filter to the products query
- **Auth section** (when not logged in): Sign Up / Log In links
- **User section** (when logged in): username/email, links to My Orders (`/orders`), Profile (`/profile`), Logout button

**Main Content**:

- **Products grid/list** — fetched via `GET /api/v1/products` with cursor pagination
- Each product card shows: main image (from `product.mainImage.publicUrl`), title, price (formatted via `Intl.NumberFormat`), average rating (stars), "Add to Cart" button
- **Infinite scroll or "Load More" button** — uses `pageInfo.nextCursor` for next page
- Active filters shown as chips (category, price range, search term) with clear buttons
- Sorting controls: by price (ASC/DESC), by title, by newest (maps to `sortBy` + `sortOrder` query params)

**BE Endpoints Consumed**:

- `GET /api/v1/products` — with filters: `category`, `search`, `minPrice`, `maxPrice`, `sortBy`, `sortOrder`, `cursor`, `limit`

---

### 3.2 Product Page (`/products/$productId`)

**Tab: About** (default):

- Product title
- Image gallery — main image + additional images (from `GET /api/v1/products/:id/images`)
- Description text
- Brand, country of origin
- Average rating (stars) + reviews count
- Price (formatted)
- Stock indicator ("In Stock" / "Out of Stock" based on `stock > 0`)
- **"Add to Cart" button** — disabled if out of stock; adds item to RTK cart slice with `quantity: 1`

**Tab: Reviews**:

- Reviews list — fetched via `GET /api/v1/products/:id/reviews` (cursor-paginated)
- Each review: user name/email, rating (stars), review text, date
- **Post Review form** (visible only when authenticated):
  - Rating: 1-5 star selector (required)
  - Text: textarea, max 1000 chars (required)
  - Submit → `POST /api/v1/products/:id/reviews`
  - Constraint: one review per user per product — if user already reviewed, show "Edit Review" form instead → `PATCH /api/v1/products/:id/reviews`

**BE Endpoints Consumed**:

- `GET /api/v1/products/:id` — product details
- `GET /api/v1/products/:id/images` — image gallery
- `GET /api/v1/products/:id/reviews` — paginated reviews
- `POST /api/v1/products/:id/reviews` — create review
- `PATCH /api/v1/products/:id/reviews` — update own review

---

### 3.3 Orders Page (`/orders`)

**Auth**: Required (redirect to `/login` if unauthenticated)

- **Orders list** — fetched via `GET /api/v1/orders` with cursor pagination
- Filters: status dropdown (`PENDING`, `PROCESSED`, `PAID`, `CANCELLED`), date range picker (`startDate`, `endDate`), product name search (`productName`)
- Each order row:
  - Order ID (truncated UUID)
  - Status badge (color-coded: PENDING=yellow, PROCESSED=blue, PAID=green, CANCELLED=red)
  - Item count + total price (sum of `item.priceAtPurchase * item.quantity`)
  - Created date
  - Expand/click → shows order items list (product title, quantity, price at purchase)
- **Payment status** — fetched on demand via `GET /api/v1/orders/:orderId/payment` (shows AUTHORIZED, CAPTURED, etc.)
- **Cancel button** — visible for `PENDING` and `PROCESSED` orders → `PATCH /api/v1/orders/:orderId/cancel`

**BE Endpoints Consumed**:

- `GET /api/v1/orders` — list with filters + cursor pagination
- `GET /api/v1/orders/:orderId` — single order details
- `GET /api/v1/orders/:orderId/payment` — payment status
- `PATCH /api/v1/orders/:orderId/cancel` — cancel order

---

### 3.4 Cart Page (`/cart`)

**State**: Cart lives in **RTK slice** (persisted via `redux-persist` to `localStorage`).

Two approaches considered:

| Approach                           | Pros                                                   | Cons                                                            |
| ---------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| **Client-side only** (RTK slice)   | Works immediately, no auth required to add items, fast | Lost on device switch, no server-side validation until checkout |
| **Server-side cart** (BE Cart API) | Persists across devices, server validates stock        | Requires auth to add items, more API calls                      |

**Recommended**: Start with **client-side cart** (RTK slice). When the BE Cart API (`/api/v1/cart`) is implemented, sync the client cart to the server on login (merge strategy: keep higher quantity).

**Cart Page UI**:

- List of cart items, each showing:
  - Product image (thumbnail)
  - Product title (link to product page)
  - Unit price
  - Quantity controls: **−** / **+** buttons (min 1, max 1000 per BE validation)
  - Line total (price × quantity)
  - Remove item button (trash icon)
- **Cart summary**: subtotal, item count
- **"Checkout" button** → creates order via `POST /api/v1/orders` with `items[]` from cart, then:
  1. On success: clear cart, redirect to `/orders`, show success toast
  2. On error (out of stock, inactive product): show error toast with specific product info, keep cart

**Idempotency**: Generate a `crypto.randomUUID()` as `idempotencyKey` before POST; store it in the request to prevent duplicate orders on network retry.

**BE Endpoints Consumed**:

- `POST /api/v1/orders` — checkout (create order from cart items)
- Future: `GET/POST/PATCH/DELETE /api/v1/cart/*` — server-side cart sync

---

### 3.5 Auth Pages (`/login`, `/signup`)

#### Login (`/login`)

- **Form fields**: email (required, email format), password (required, min 8 chars)
- **Validation**: Zod schema, RHF resolver
- **Submit** → `POST /api/v1/auth/signin`
- **On success**: store `accessToken` in RTK auth slice (persisted), redirect to previous page or `/`
- **On error**: show inline error message (invalid credentials)
- Link to Sign Up page

#### Sign Up (`/signup`)

- **Form fields**: email (required, email format), password (required, min 8 chars), confirm password (must match)
- **Submit** → `POST /api/v1/auth/signup`
- **On success**: show success message, redirect to `/login`
- **On error**: show inline errors (email already exists, validation errors)
- Link to Login page

#### Token Management

- Store `accessToken` in Redux store (persisted via `redux-persist`)
- Inject token via RTK Query `baseQuery` (`Authorization: Bearer <token>` header)
- On 401 response: clear auth state, redirect to `/login`
- Future (when BE implements refresh tokens): add `POST /api/v1/auth/refresh` call, store refresh token in HttpOnly cookie (handled by browser automatically)

---

### 3.6 Profile Page (`/profile`)

**Auth**: Required

**Profile Form**:

- Fields: first name, last name, phone, city, country (dropdown, ISO codes), postcode
- Pre-populated from `GET /api/v1/users/me`
- Submit → `PATCH /api/v1/users/me`
- Validation: Zod schema matching `UpdateProfileDto` constraints

**Avatar Upload**:

- Current avatar displayed (from user's `avatarId` → FileRecord → presigned download URL)
- Upload flow (3-step presigned upload):
  1. User selects image file (accept: `.jpeg`, `.jpg`, `.png`, `.webp`, max 10 MB)
  2. FE calls `POST /api/v1/files/presigned-upload` with `{ contentType, size }`
  3. FE uploads binary to the returned `uploadUrl` (direct PUT to S3)
  4. FE calls `POST /api/v1/files/complete-upload` with `{ fileId, entityType: 'user' }`
  5. FE calls `PUT /api/v1/users/me/avatar` with `{ fileId }`
  6. Refresh profile data
- Show upload progress indicator

**Change Password Section**:

- Fields: current password, new password, confirm new password
- Submit → `PATCH /api/v1/users/me/password`
- Validation: Zod schema matching `ChangePasswordDto`

**BE Endpoints Consumed**:

- `GET /api/v1/users/me` — load profile
- `PATCH /api/v1/users/me` — update profile fields
- `PATCH /api/v1/users/me/password` — change password
- `PUT /api/v1/users/me/avatar` — set avatar
- `DELETE /api/v1/users/me/avatar` — remove avatar
- `POST /api/v1/files/presigned-upload` — get upload URL
- `POST /api/v1/files/complete-upload` — finalize upload

---

## 4. Admin Panel — Pages & Features

**Auth**: All admin routes require `admin` role. On login, if `roles` array from token does not include `admin`, redirect to shop or show "Access Denied".

### 4.1 Users Management (`/admin/users`)

- **Users list** — paginated table (MUI DataGrid or custom table)
  - Columns: email, name, roles, email verified status, created date
  - Search by email
- **User detail** (`/admin/users/$userId`) — read-only view of user profile
- **Role management**: assign/remove roles via `PATCH /api/v1/admin/users/:userId/roles`
  - Available roles: `admin`, `support`, `user`
  - Scope assignment: checkboxes for each `UserScope` value
- **Delete user** — with confirmation dialog; blocked if user has orders (show error from BE)

**BE Endpoints Consumed**:

- `GET /api/v1/users` — admin list
- `GET /api/v1/users/:id` — user detail
- `PATCH /api/v1/admin/users/:userId/roles` — assign roles/scopes
- `DELETE /api/v1/users/:id` — delete user

### 4.2 Products Management (`/admin/products`)

- **Products table** — paginated, filterable (category, active/inactive, brand, search)
  - Columns: image (thumbnail), title, category, brand, price, stock, active status, rating
- **Create product** (`/admin/products/new`) — form with:
  - Title (required, unique), description, brand, country, category (dropdown from `ProductCategory` enum), price (required), stock (required), isActive toggle
  - Main image upload (3-step presigned flow)
  - Submit → `POST /api/v1/products`
- **Edit product** (`/admin/products/$productId/edit`) — same form, pre-populated
  - Submit → `PATCH /api/v1/products/:id`
- **Image management** (`/admin/products/$productId/images`):
  - View all images for the product
  - Upload additional images (presigned flow)
  - Set main image → `PATCH /api/v1/products/:id/images/:fileId/main`
  - Delete image → `DELETE /api/v1/products/:id/images/:fileId`
- **Soft delete product** — confirmation dialog → `DELETE /api/v1/products/:id`

**BE Endpoints Consumed**:

- `GET /api/v1/products` — list with admin filters
- `GET /api/v1/products/:id` — product detail
- `POST /api/v1/products` — create
- `PATCH /api/v1/products/:id` — update
- `DELETE /api/v1/products/:id` — soft delete
- `GET /api/v1/products/:id/images` — image list
- `DELETE /api/v1/products/:id/images/:fileId` — remove image
- `PATCH /api/v1/products/:id/images/:fileId/main` — set main image
- `POST /api/v1/files/presigned-upload` — upload step 1
- `POST /api/v1/files/complete-upload` — upload step 3

### 4.3 Orders Management (`/admin/orders`)

- **Orders table** — paginated, filterable (status, date range, product name, customer email)
  - Columns: order ID, customer email, status, item count, total, payment status, created date
- **Order detail** (`/admin/orders/$orderId`):
  - Order items list with product details
  - Payment section:
    - Current payment status (via `GET /api/v1/orders/:orderId/payment`)
    - **Capture button** (visible when status = `AUTHORIZED`) → `POST /api/v1/orders/:orderId/payment/capture`
    - **Refund button** (visible when status = `CAPTURED`) → `POST /api/v1/orders/:orderId/payment/refund`
  - **Cancel order button** (for `PENDING`/`PROCESSED` orders) → `PATCH /api/v1/orders/:orderId/cancel`

**BE Endpoints Consumed**:

- `GET /api/v1/orders` — admin order listing (all users)
- `GET /api/v1/admin/orders/:orderId` — admin order detail
- `GET /api/v1/orders/:orderId/payment` — payment status
- `POST /api/v1/orders/:orderId/payment/capture` — capture payment
- `POST /api/v1/orders/:orderId/payment/refund` — refund payment
- `PATCH /api/v1/orders/:orderId/cancel` — cancel order

---

## 5. Cross-Cutting Concerns

### 5.1 Authentication Flow

```
Login → POST /auth/signin → { accessToken } → store in Redux
Every API call → Authorization: Bearer <token> header (RTK Query baseQuery / TanStack Query default headers)
401 response → clear auth state → redirect to /login
Future: refresh token rotation via POST /auth/refresh (HttpOnly cookie)
```

### 5.2 Error Handling

- **RTK Query / TanStack Query** error callbacks → show notistack toast with error message
- **Form validation errors** — inline field errors via RHF + Zod
- **Network errors** — global error boundary + retry logic (RTK Query auto-retry on network failure)
- **404 pages** — catch-all route renders "Not Found" page
- **403 (Forbidden)** — show "Access Denied" page, don't expose admin routes in shop navigation

### 5.3 Loading States

- Skeleton loaders (MUI `Skeleton`) for product cards, tables, profile fields
- Button loading spinners during form submissions
- Full-page spinner for initial app load / auth check

### 5.4 Responsive Design

- MUI breakpoints: mobile-first approach
- Product grid: 1 col (xs) → 2 cols (sm) → 3 cols (md) → 4 cols (lg)
- Sidebar: collapsible drawer on mobile, fixed on desktop
- Admin panel: collapsible sidebar navigation

### 5.5 SEO & Performance

- SPA — no SSR, so SEO is limited to meta tags via `react-helmet-async` or TanStack Router head management
- Image optimization: lazy loading (`loading="lazy"`), appropriate sizing
- Code splitting: route-based lazy loading via TanStack Router's `lazy()` route option
- Bundle analysis: `rollup-plugin-visualizer` in Vite config

### 5.6 Environment Configuration

```env
VITE_API_BASE_URL=http://localhost:8080/api/v1
VITE_APP_NAME=RD Shop
```

Both apps read from `.env` files via Vite's `import.meta.env`.

---

## 6. Shared Packages Detail

### `packages/shared-types`

```typescript
// Enums mirroring BE
export enum OrderStatus { PENDING, PROCESSED, PAID, CANCELLED }
export enum ProductCategory { LAPTOPS, SMARTPHONES, TABLETS, ... }
export enum PaymentStatus { PENDING, AUTHORIZED, CAPTURED, REFUNDED, FAILED }
export enum UserRole { ADMIN, SUPPORT, USER }

// Response types
export interface Product { id: string; title: string; price: number; ... }
export interface Order { id: string; status: OrderStatus; items: OrderItem[]; ... }
export interface User { id: string; email: string; roles: UserRole[]; ... }
export interface PageInfo { hasNextPage: boolean; nextCursor?: string }
export interface PaginatedResponse<T> { data: T[]; pageInfo: PageInfo }
```

### `packages/validation`

```typescript
// Zod schemas shared between shop forms and admin forms
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const signupSchema = loginSchema
  .extend({
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'] });

export const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().min(1).max(1000),
});

export const updateProfileSchema = z.object({
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  phone: z.string().max(20).optional(),
  city: z.string().max(100).optional(),
  country: z.string().length(2).optional(),
  postcode: z.string().max(20).optional(),
});
```

### `packages/shared-ui`

- MUI theme configuration (palette, typography, component overrides)
- `AppHeader`, `AppSidebar` layout shells
- `StarRating` component (display + input)
- `StatusBadge` component (order/payment status → color mapping)
- `ConfirmDialog` component
- `FileUploader` component (wraps the 3-step presigned upload flow)
- `CurrencyText` component (formats price via `Intl.NumberFormat`)

---

## 7. Route Map Summary

### Shop Routes

| Route                  | Auth                    | Description                                       |
| ---------------------- | ----------------------- | ------------------------------------------------- |
| `/`                    | No                      | Main page — product listing with category sidebar |
| `/products/$productId` | No                      | Product detail with About/Reviews tabs            |
| `/cart`                | No                      | Shopping cart (client-side state)                 |
| `/orders`              | Yes                     | User's order list                                 |
| `/login`               | No (redirect if authed) | Login form                                        |
| `/signup`              | No (redirect if authed) | Signup form                                       |
| `/profile`             | Yes                     | User profile + avatar + password change           |

### Admin Routes

| Route                               | Auth | Role  | Description                             |
| ----------------------------------- | ---- | ----- | --------------------------------------- |
| `/admin`                            | Yes  | admin | Dashboard (redirect to users or orders) |
| `/admin/users`                      | Yes  | admin | Users table                             |
| `/admin/users/$userId`              | Yes  | admin | User detail + role management           |
| `/admin/products`                   | Yes  | admin | Products table                          |
| `/admin/products/new`               | Yes  | admin | Create product form                     |
| `/admin/products/$productId/edit`   | Yes  | admin | Edit product form                       |
| `/admin/products/$productId/images` | Yes  | admin | Manage product images                   |
| `/admin/orders`                     | Yes  | admin | All orders table                        |
| `/admin/orders/$orderId`            | Yes  | admin | Order detail + payment actions          |

---

## 8. CI / CD

GitHub Actions → S3 → CloudFront. Mirrors the BE pipeline conventions (composite actions, sentinel job, environment-based secrets) adapted for static SPA hosting.

### Hosting Architecture

Both SPAs are static bundles deployed to **S3 + CloudFront**:

```
Browser → CloudFront (CDN) → S3 bucket (origin)
                │
                ├── shop.example.com   → s3://rd-shop-fe-{env}/shop/
                └── admin.example.com  → s3://rd-shop-fe-{env}/admin/
```

- Each app gets its own CloudFront distribution (separate domains, separate cache policies)
- S3 bucket per environment (`stage`, `production`) — apps live in path prefixes (`/shop/`, `/admin/`)
- SPA fallback: CloudFront custom error response → `200` + `/index.html` for 403/404 (handles client-side routing)
- Assets cached aggressively: Vite hashes filenames (`assets/index-abc123.js`), `Cache-Control: public, max-age=31536000, immutable`
- `index.html` never cached: `Cache-Control: no-cache, no-store, must-revalidate`

### Workflow Files

| File                            | Trigger                                 | Purpose                               |
| ------------------------------- | --------------------------------------- | ------------------------------------- |
| `fe-pr-checks.yml`              | PR → `development`, `main`, `release/*` | Quality gate                          |
| `fe-build-and-deploy-stage.yml` | Push → `development`                    | Build + deploy to stage S3/CloudFront |
| `fe-deploy-production.yml`      | Manual `workflow_dispatch`              | Production deploy with approval gate  |

### fe-pr-checks.yml — Job Graph

```
install ──► code-quality ──┬──► unit-tests     ──┐
                           └──► build-preview  ──┴──► all-checks-passed
```

- **install**: `pnpm install --frozen-lockfile`; cache `~/.pnpm-store` keyed on `hash(pnpm-lock.yaml)`
- **code-quality**: lint (`eslint`) + type-check (`tsc --noEmit`) for all workspace packages; uses `pnpm --filter` to scope per-package
- **unit-tests**: `pnpm --filter ./apps/shop test` + `pnpm --filter ./apps/admin test` (vitest)
- **build-preview**: `pnpm --filter ./apps/shop build` + `pnpm --filter ./apps/admin build` — verifies production build succeeds, outputs bundle size to step summary
- **all-checks-passed**: `if: always()` sentinel job; branch protection target; writes step summary table (mirrors BE pattern)

### Affected-Package Detection

pnpm workspaces enable scoped CI — only build/test what changed:

```yaml
- name: Detect changed packages
  run: |
    pnpm --filter '...[origin/development]' list --depth -1 --json > changed.json
```

Use `--filter '...[origin/development]'` to run commands only in packages affected by the PR diff. Falls back to full build if shared packages (`packages/*`) changed.

### fe-build-and-deploy-stage.yml

```
install ──► build ──► upload-to-s3 ──► invalidate-cloudfront ──► smoke-test
```

1. **install**: `pnpm install --frozen-lockfile` + cache
2. **build**: inject env vars, build both apps
   ```yaml
   - run: pnpm --filter ./apps/shop build
     env:
       VITE_API_BASE_URL: ${{ vars.STAGE_API_URL }}
   - run: pnpm --filter ./apps/admin build
     env:
       VITE_API_BASE_URL: ${{ vars.STAGE_API_URL }}
   ```
3. **upload-to-s3**: sync build output to S3 with correct cache headers

   ```yaml
   # Hashed assets — immutable cache
   - run: >
       aws s3 sync apps/shop/dist/ s3://${{ vars.S3_BUCKET }}/shop/
       --exclude "index.html"
       --cache-control "public, max-age=31536000, immutable"
       --delete

   # index.html — no cache
   - run: >
       aws s3 cp apps/shop/dist/index.html s3://${{ vars.S3_BUCKET }}/shop/index.html
       --cache-control "no-cache, no-store, must-revalidate"
   ```

   Repeat for `admin/`.

4. **invalidate-cloudfront**: invalidate `/*` on both distributions to force edge cache refresh
   ```yaml
   - run: >
       aws cloudfront create-invalidation
       --distribution-id ${{ vars.SHOP_CF_DISTRIBUTION_ID }}
       --paths "/*"
   ```
5. **smoke-test**: HTTP GET to CloudFront URL, verify 200 + HTML content-type

**Artifact**: `release-manifest-fe-<sha>.json` — records S3 paths, CloudFront distribution IDs, git SHA; 90-day retention. Used by production deploy for traceability.

### fe-deploy-production.yml

```
approval-gate ──► download-artifact ──► upload-to-s3 ──► invalidate-cloudfront ──► smoke-test
```

- Manual `workflow_dispatch` with inputs: `run_id` (reference to the stage build), `sha`
- `production` GitHub Environment — required reviewers approval gate (same pattern as BE)
- **Does NOT rebuild** — downloads the build artifact from the stage workflow run to guarantee identical assets
- Uploads to production S3 bucket, invalidates production CloudFront distributions
- Smoke test against production URLs

### Rollback Strategy

Since S3 stores only the latest version:

1. **Fast rollback**: re-run a previous successful `fe-deploy-production.yml` workflow — it re-uploads the artifact from that run
2. **S3 versioning** (optional): enable S3 bucket versioning for point-in-time recovery
3. **CloudFront invalidation** takes 1-2 minutes; during that window, edge caches still serve the previous version

### Composite Actions (FE-specific)

| Action                    | Purpose                                      |
| ------------------------- | -------------------------------------------- |
| `fe-install-dependencies` | `pnpm install --frozen-lockfile` + cache     |
| `fe-code-quality`         | lint + type-check + unit tests (pnpm filter) |
| `fe-build`                | Vite build both apps with env injection      |
| `fe-deploy-s3`            | S3 sync with cache header split              |
| `fe-invalidate-cdn`       | CloudFront invalidation + wait               |
| `fe-smoke-test`           | HTTP probe to CloudFront URL                 |
| `write-deploy-summary`    | Reuse from BE — GitHub step summary table    |

### Secrets & Variables

Separate GitHub Environments (`fe-stage`, `fe-production`), no cross-environment access:

| Secret / Variable                | Scope           | Purpose                          |
| -------------------------------- | --------------- | -------------------------------- |
| `AWS_ACCESS_KEY_ID`              | per environment | S3 + CloudFront API access       |
| `AWS_SECRET_ACCESS_KEY`          | per environment | S3 + CloudFront API access       |
| `AWS_REGION`                     | per environment | AWS region                       |
| `S3_BUCKET`                      | per environment | Target bucket name               |
| `SHOP_CF_DISTRIBUTION_ID`        | per environment | Shop CloudFront distribution     |
| `ADMIN_CF_DISTRIBUTION_ID`       | per environment | Admin CloudFront distribution    |
| `STAGE_API_URL` / `PROD_API_URL` | per environment | BE API base URL baked into build |

### Cache Strategy Summary

| Resource                     | Cache-Control                         | Reason                                                |
| ---------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `index.html`                 | `no-cache, no-store, must-revalidate` | Must always fetch latest to pick up new asset hashes  |
| `assets/*` (JS, CSS, images) | `public, max-age=31536000, immutable` | Vite content-hashes filenames — safe to cache forever |
| CloudFront TTL               | Default 24h, overridden by S3 headers | S3 `Cache-Control` headers take precedence            |

### Comparison with BE Pipeline

| Aspect          | BE                                                                                                   | FE                                |
| --------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------- |
| Artifact        | Docker image → GHCR                                                                                  | Static bundle → S3                |
| Deploy target   | VM (Docker Compose)                                                                                  | S3 + CloudFront (CDN)             |
| Package manager | npm                                                                                                  | pnpm                              |
| Cache key       | `hash(package-lock.json)`                                                                            | `hash(pnpm-lock.yaml)`            |
| Rollback        | Pull previous image tag                                                                              | Re-upload previous build artifact |
| Smoke test      | `/health` → `/ready` → `/status`                                                                     | HTTP 200 on CloudFront URL        |
| Shared patterns | Composite actions, sentinel job, env-based secrets, immutable tags, release manifest, step summaries |
