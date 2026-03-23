# Orders & Cart — Implementation Plan

## Current state

- Order creation with pessimistic locking, stock reservation, idempotency (unique `idempotencyKey`)
- Async processing: RabbitMQ `orders.process` → worker → gRPC payment authorization
- Order listing: cursor pagination with filters (status, date range, product name)
- Payment status query: `GET /orders/:id/payment` via gRPC
- GraphQL: `orders` query with cursor pagination + DataLoaders
- Worker: 3 retries with 2s delay, dead-letter queue (`orders.dlq`)
- `OrderStatus` enum: `PENDING`, `PROCESSED`, `PAID`, `CANCELLED`, `CREATED` (legacy)
- **No cart**, **no cancellation**, **no email notifications**

---

## Phase 1 — Order cancellation

### 1.1 Endpoint

```
PATCH /api/v1/orders/:orderId/cancel
```

Guards: `JwtAuthGuard`. Only the order owner can cancel.

### 1.2 Business rules

| Current status   | Can cancel? | Side effects                                                      |
| ---------------- | ----------- | ----------------------------------------------------------------- |
| PENDING          | Yes         | Restore stock quantities                                          |
| PROCESSED        | Yes         | Restore stock + void/refund payment if `paymentId` exists         |
| PAID             | Yes         | Restore stock + refund payment (needs Phase 2 from payments plan) |
| CANCELLED        | No          | 409 — already cancelled                                           |
| CREATED (legacy) | No          | 400 — invalid state                                               |

### 1.3 Stock restoration

Inside a transaction:

1. Lock order items' products with `FOR UPDATE`
2. Increment `product.stock` by each `item.quantity`
3. Set `order.status = CANCELLED`

### 1.4 Tasks

- [ ] Add `PATCH /orders/:orderId/cancel` in `OrdersController`
- [ ] Implement `cancelOrder()` in `OrdersService` — transaction with stock restoration
- [ ] Add ownership check (`assertOrderOwnership`)
- [ ] Handle payment void/refund if `paymentId` present (depends on payments plan)

---

## Phase 2 — Shopping cart (persistent, server-side)

### 2.1 Entities

**Cart** (1:1 with User):

```typescript
@Entity('carts')
class Cart {
  id: string; // UUID PK
  userId: string; // FK → User (unique, CASCADE)
  items: CartItem[];
  createdAt: Date;
  updatedAt: Date;
}
```

**CartItem**:

```typescript
@Entity('cart_items')
class CartItem {
  id: string; // UUID PK
  cartId: string; // FK → Cart (CASCADE)
  productId: string; // FK → Product (RESTRICT)
  quantity: number; // min 1
  addedAt: Date;
}
```

Unique constraint: `(cartId, productId)` — one row per product, update quantity instead of duplicating.

### 2.2 Endpoints

| Method   | Path                         | Description                                               |
| -------- | ---------------------------- | --------------------------------------------------------- |
| `GET`    | `/api/v1/cart`               | Get current user's cart with items + product details      |
| `POST`   | `/api/v1/cart/items`         | Add item (productId, quantity) — upserts if exists        |
| `PATCH`  | `/api/v1/cart/items/:itemId` | Update quantity                                           |
| `DELETE` | `/api/v1/cart/items/:itemId` | Remove item                                               |
| `DELETE` | `/api/v1/cart`               | Clear entire cart                                         |
| `POST`   | `/api/v1/cart/checkout`      | Convert cart → order (reuses `OrdersService.createOrder`) |

### 2.3 Cart → Order conversion

`POST /cart/checkout`:

1. Load cart with items
2. Validate cart is non-empty
3. Map `CartItem[]` → `CreateOrderItemDto[]`
4. Call `OrdersService.createOrder(userId, { items, idempotencyKey? })`
5. On success: clear cart
6. Return created order

This preserves all existing order creation logic (stock reservation, idempotency, RabbitMQ publish).

### 2.4 Stock validation at cart level

Cart itself does NOT reserve stock. Stock check happens only at checkout (order creation). However:

- `GET /cart` should show `product.stock` alongside each item so the UI can warn about low stock
- `POST /cart/items` should reject if product doesn't exist or `stock === 0`

### 2.5 DTOs

```
AddCartItemDto {
  productId: UUID,         // required
  quantity: number,        // required, min 1
}

UpdateCartItemDto {
  quantity: number,        // required, min 1
}
```

### 2.6 Tasks

- [ ] Create `Cart` and `CartItem` entities
- [ ] Migration: `carts` and `cart_items` tables
- [ ] `CartService` with CRUD + checkout
- [ ] `CartController` with 6 endpoints
- [ ] DTOs: `AddCartItemDto`, `UpdateCartItemDto` (see 2.5)
- [ ] Auto-create cart on first `GET /cart` (lazy initialization)
- [ ] Checkout: delegate to `OrdersService.createOrder`, clear cart on success

---

## Phase 3 — Email notifications

### 3.1 Infrastructure — shared MailService

Reuses the `MailModule` + `MailService` created in auth Phase 2 (see [auth-plan.md](auth-plan.md#23-mailservice-shared)). The same `MailService` wraps AWS SES and provides methods for both auth emails (verification, password reset) and order emails (confirmation, paid, cancelled).

No additional mail dependencies needed — just import `MailModule` and add order-specific email templates.

### 3.2 Event emitter + listeners

```
npm install @nestjs/event-emitter
```

Domain events emitted on status transitions:

- `order.created` — after successful creation → confirmation email
- `order.paid` — after payment authorized → payment receipt email
- `order.cancelled` — after cancellation → cancellation email

```typescript
@OnEvent('order.created')
async handleOrderCreated(event: OrderCreatedEvent) {
  await this.mailService.sendOrderConfirmation(event.userEmail, event.order);
}
```

### 3.3 Email templates

Simple HTML templates (inline or handlebars). Each template receives order data (items, total, status):

- `order-confirmation` — "Your order #X has been placed"
- `order-paid` — "Payment confirmed for order #X"
- `order-cancelled` — "Order #X has been cancelled"

### 3.4 Tasks

- [ ] Install `@nestjs/event-emitter` (MailModule already exists from auth Phase 2)
- [ ] Add order email methods to shared `MailService` (if not already present)
- [ ] Define event classes: `OrderCreatedEvent`, `OrderPaidEvent`, `OrderCancelledEvent`
- [ ] Emit events in `OrdersService` at each transition
- [ ] Create `OrderEmailListener` — sends emails via `MailService`
- [ ] Create order email templates (order-confirmation, order-paid, order-cancelled)
- [ ] SES env vars already configured from auth Phase 2

---

## Phase 4 — Advanced order features (deferred)

### 4.1 Order receipts / invoices

Server-side PDF generation — triggered on `PAID` status:

1. `order.paid` event fires (from Phase 4)
2. Enqueue a receipt generation job (RabbitMQ or AWS Lambda)
3. Worker generates PDF (e.g., `pdfmake` or Puppeteer/Chromium)
4. Upload to S3 (reuse existing `S3Service`)
5. Store `receiptFileId` on `Order` entity (FK → `FileRecord`)

Endpoint: `GET /api/v1/orders/:orderId/receipt` — returns presigned S3 download URL.

Frontend simply opens the link — no client-side PDF generation.

**AWS Lambda option:** If receipt generation is infrequent, a dedicated Lambda is cheaper than keeping a worker running. The Lambda receives the order payload, generates PDF, uploads to S3, and writes the FileRecord. Invoked via SQS or direct Lambda invoke from the NestJS service.

### 4.2 Re-order

- `POST /api/v1/orders/:orderId/reorder` — creates a new order with the same items
- Validates current stock availability
- Generates new idempotency key

---

## Implementation order

```
Phase 1 (Cancellation)       ← Most requested missing feature, builds on existing code
  ↓
Phase 2 (Shopping cart)       ← Independent new domain, reuses order creation
  ↓
Phase 3 (Email notifications) ← AWS SES emails on order status transitions
  ↓
Phase 4 (Advanced)            ← Deferred, evaluate per feature
```

---

## Testing

Deferred to dedicated testing plan. Key areas to cover:

- Order cancellation from each status + stock restoration math
- Ownership checks (only owner can cancel)
- Payment void/refund on cancellation
- Cart CRUD + quantity upsert
- Cart checkout → order creation integration
- Stock validation at cart level (reject zero-stock products)
- Email sending on status transitions (mock SES in tests)

---

## GraphQL

Deferred. Key areas to cover when prioritized:

- `cancelOrder(orderId: ID!)` mutation
- `cart` query + `addToCart`, `removeFromCart`, `clearCart`, `checkout` mutations
