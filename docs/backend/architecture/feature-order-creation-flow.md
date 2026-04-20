# rd_shop — Full Order Flow

## Services hierarchy

```
OrdersService (facade — backward compat)
├── OrdersCommandService     write path: createOrder, cancelOrder
│   ├── OrderStockService    pessimistic locking, stock decrement/restore, product pre-check
│   ├── OrderPublisherService  publish OrderProcessMessageDto to RabbitMQ
│   └── PgErrorMapperService  PostgreSQL error code → NestJS exception mapping
└── OrdersQueryService       read path: findOrdersWithFilters, getOrderById, getOrderPayment

OrderProcessingService       worker pipeline: idempotent message consumption → gRPC payment
```

All transactions open with `applyTransactionTimeouts` (`utils/index.ts`):

- `SET LOCAL statement_timeout = 30000` — aborts slow queries (PG 57014)
- `SET LOCAL lock_timeout = 10000` — aborts stalled pessimistic locks (PG 55P03)

## Status lifecycle

```
PENDING → PROCESSED → PAID
   ↓         ↓         ↓
CANCELLED  CANCELLED  CANCELLED
```

`CREATED` also exists in the enum but `PENDING` is the actual initial state set on creation.

Cancellation is allowed from `PENDING`, `PROCESSED`, and `PAID`. Blocked from `CANCELLED` (409) and `CREATED` (400, legacy).

## Phase 1 — HTTP: Order creation via cart

The canonical creation flow is cart-based. `POST /api/v1/orders` exists for historical reasons but is not the primary path.

### Step A — Add item to cart

**Endpoint:** `POST /api/v1/cart/items` — guards: `JwtAuthGuard`, `ScopesGuard` (`orders:write`)  
**Input:** `AddCartItemDto { productId: UUID, quantity: number (≥1) }`

```
CartService.addItem(userId, dto):
  findById(productId)               → 404 if not found
  Guard: !product.isActive          → 409
  Guard: product.stock === 0        → 409
  getOrCreateCartEntity(userId)     → lazy create cart row if absent
  newQuantity = existing + dto.qty
  Guard: newQuantity > product.stock → 409
  cartItemRepository.upsert(cartId, productId, newQuantity)
    conflictPaths: [cartId, productId]  ← increments qty if item already present

Response: HTTP 201 { data: CartResponseDto (cart with items) }
```

Note: stock is checked optimistically at add-item time (no DB lock). The authoritative check happens inside the checkout transaction.

### Step B — Checkout

**Endpoint:** `POST /api/v1/cart/checkout` — guards: `JwtAuthGuard`, `ScopesGuard` (`orders:write`)  
**Input:** `CartCheckoutDto { idempotencyKey?: string, shipping?: ShippingAddressDto }`

```
CartService.checkout(userId, dto):
  findCartWithItems(userId)         → load cart + items
  Guard: cart empty                 → 400

  items = cart.items.map({ productId, quantity })
  createOrderDto = { idempotencyKey, items, shipping }

  OrdersService.createOrder(userId, createOrderDto, context):
    → OrdersCommandService.createOrder

    Pre-validation (outside transaction):
      validateUser(userId from JWT)          → 404 if not found
      validateOrderItems(items)              → 400 if qty ≤0 or >1000
      checkIdempotency(idempotencyKey)       → 201 + existing order if key seen before
      OrderStockService.validateExist(productIds) → 404 if any product missing

    executeOrderTransaction(dto, user, productIds):
      DB Transaction:
        applyTransactionTimeouts(manager)    → SET LOCAL statement/lock timeouts
        SELECT ... FOR UPDATE (pessimistic_write lock on all product rows in order)
        → ProductsRepository.findByIdsWithLock(manager, productIds)
        → TypeORM .setLock('pessimistic_write') → PostgreSQL SELECT ... FOR UPDATE
      validateStockAndAvailability()         → 409 if !isActive or stock < qty
      decrementProductStock()                → subtract quantities in-memory
      saveProducts()                         → persist stock changes
      createOrder(status: PENDING)           → shipping resolved: DTO field → user profile fallback
      createOrderItems(priceAtPurchase snapshot from product.price at this moment)
      COMMIT  ← releases all row locks

    Error handling:
      23505 + idempotencyKey                 → checkIdempotency() → return existing
      57014 (statement timeout)              → 500 "timed out due to high load"
      55P03 (lock timeout)                   → 409 "high concurrent activity"

    Post-commit (non-blocking):
      publish to orders.process: OrderProcessMessageDto {
        messageId: UUID,
        orderId,
        attempt: 1,
        correlationId: idempotencyKey
      }
      emit ORDER_CREATED_EVENT → OrderEmailListener → confirmation email

  clearCart(userId)   ← cart items deleted after successful order creation

Response: HTTP 201 { data: Order with items + products }
```

### Shipping address resolution

For each shipping field (`firstName`, `lastName`, `phone`, `city`, `country`, `postcode`):

1. If provided in `dto.shipping` → use it (explicit override)
2. Otherwise → copy from the `user` entity (already loaded via `validateUser`)

The user's profile acts as a **default** — clients can skip `shipping` entirely if the profile is filled in.

## Phase 1.5 — Order cancellation

**Endpoint:** `POST /api/v1/orders/:orderId/cancellation` — guard: `JwtAuthGuard`

```
OrdersService.cancelOrder → OrdersCommandService.cancelOrder

executeCancelTransaction(orderId, userId):
  DB Transaction:
    applyTransactionTimeouts(manager)    → SET LOCAL statement/lock timeouts
    Load order (shallow)
    assertOrderOwnership(order, userId)  → 404 if not owner
    Guard: CANCELLED → 409, CREATED → 400
    Load order with items + products (full)
    SELECT products FOR UPDATE (pessimistic lock)
    Restore stock: product.stock += item.quantity for each item
    SET order.status = CANCELLED
    Reload order with full relations
    COMMIT

Post-commit:
  emit ORDER_CANCELLED_EVENT → OrderEmailListener → cancellation email

Response: HTTP 200 { data: Order }
```

Payment void/refund when `paymentId` exists is deferred to the payments plan.

## Phase 2 — RabbitMQ: Worker processing

**Service:** `OrderWorkerService` — `apps/shop/src/orders-worker/orders-worker.service.ts`  
**Queue:** `orders.process` (durable)

```
handleMessage(msg, channel):
  Parse → OrderProcessMessageDto
  Invalid message → publishToDlq + ack

  Call OrdersService.processOrderMessage(payload)

  On success → channel.ack(msg)
  On error + attempt < 3 → retryMessage(payload, attempt+1)
                           sleep(RETRY_DELAY_MS = 2000ms)
                           re-publish to orders.process with attempt++
                           channel.ack(msg)   ← always ack, retry is a new message
  On error + attempt ≥ 3 → publishToDlq(payload) + channel.ack(msg)
```

## Phase 2.5 — DB transaction in worker

**Method:** `OrderProcessingService.processOrderMessage(payload)`

```
DB Transaction:
  INSERT processed_messages {messageId, orderId, correlationId, scope: 'order-worker'}
    → On 23505 unique violation: return (idempotent — message already processed)
    → On other error: throw "Failed to acquire idempotency lock"

  SELECT order WHERE id = orderId
    → 404 → throw (worker retries → DLQ)
    → status = PROCESSED → log warn + return (skip)
    → status = PAID → log warn + return (skip)

  UPDATE orders SET status = 'PROCESSED'
  COMMIT

Post-commit (outside transaction):
  If RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION=true → skip (dev/test flag)

  If order.paymentId already set → skip (idempotency guard)

  authorizePayment(order):
    Fetch order with items + products
    amount = Σ(priceAtPurchase × quantity) × 100   ← in cents, USD
    PaymentsGrpcService.authorize({orderId, amount, currency: 'USD'})
      → Timeout: PAYMENTS_GRPC_TIMEOUT_MS (default 5s) → GatewayTimeoutException
      → gRPC errors mapped: NOT_FOUND → 404, INVALID_ARGUMENT → 400,
                            ALREADY_EXISTS → 409, UNAVAILABLE → 503
    On success: UPDATE orders SET status = 'PAID', paymentId = response.paymentId
               emit ORDER_PAID_EVENT → OrderEmailListener → payment confirmation email
    On error: log + re-throw → worker retries message
```

## Phase 3 — gRPC: Payment authorization (payments-service)

**RPC:** `Payments.authorize(AuthorizeRequest) → AuthorizeResponse`  
**Service:** `apps/payments/`

```
Validate orderId uniqueness (prevents duplicate charges for same order)
Create Payment record: status=AUTHORIZED, paymentId (varchar), orderId, amount, currency
Return { paymentId, status }
```

## Idempotency layers

| Layer                 | Mechanism                                     | Protection against                      |
| --------------------- | --------------------------------------------- | --------------------------------------- |
| HTTP creation         | `idempotencyKey` unique index on `orders`     | Duplicate POST /cart/checkout           |
| Worker processing     | `processed_messages.messageId` unique index   | RabbitMQ redelivery                     |
| Payment authorization | `order.paymentId` null-check before gRPC call | Worker retry after gRPC partial failure |
| gRPC authorize        | `orderId` unique index on `payments`          | Duplicate gRPC calls                    |

---

## Tests

### Integration tests

File: `apps/shop/test/integration/` (none yet for order creation — covered by e2e).

The creation flow is not unit-tested at the controller layer because the critical path involves a DB transaction with pessimistic row locks; integration or e2e tests provide better signal.

### e2e tests

File: `apps/shop/test/e2e/orders/order-lifecycle.e2e-spec.ts`

Runs against the full `compose.e2e.yml` stack (real Postgres, RabbitMQ, payments gRPC service).

| Flow                            | What it tests                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **PENDING → PAID**              | `addToCartAndCheckout` → order PENDING; `poll()` until PAID (worker + gRPC round-trip); asserts `paymentId` set                  |
| **Cancel PAID + stock restore** | Create PAID order; capture product stock before; `POST /cancellation`; assert status CANCELLED + stock restored by item quantity |
| **Idempotency**                 | `POST /cart/checkout` twice with same `idempotencyKey`; assert same `orderId` returned, no duplicate order created               |

Helper used: `addToCartAndCheckout(token, productId, quantity?, idempotencyKey?)` from `@test/e2e/helpers` — clears cart first, adds item, calls `POST /cart/checkout`.

See `docs/backend/architecture/test-infrastructure.md` for stack setup and npm scripts.

## Key entities

**Order** — `apps/shop/src/orders/order.entity.ts`  
`id`, `userId FK`, `status`, `idempotencyKey (unique nullable)`, `paymentId (unique nullable)`, `items OneToMany`, `createdAt/updatedAt`  
Shipping snapshot: `shippingFirstName`, `shippingLastName`, `shippingPhone`, `shippingCity`, `shippingCountry`, `shippingPostcode` — all nullable varchar  
Indices: `user_id`, `created_at`, `user+created_at` (composite), `status+created_at` (composite)

**OrderItem** — `apps/shop/src/orders/order-item.entity.ts`  
`id`, `orderId FK CASCADE`, `productId FK RESTRICT`, `quantity`, `priceAtPurchase decimal(12,2)`  
Note: RESTRICT on productId prevents deleting a product that has been ordered.

## Dev flags

| Env var                                        | Effect                                      |
| ---------------------------------------------- | ------------------------------------------- |
| `RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION=true` | Skip gRPC call — orders stay PROCESSED      |
| `RABBITMQ_SIMULATE_FAILURE=true`               | Worker always throws — tests retry/DLQ path |
| `RABBITMQ_SIMULATE_DELAY=<ms>`                 | Sleep before processing — tests concurrency |

## Email notifications

Domain events emitted via `@nestjs/event-emitter` (`EventEmitter2`) on status transitions:

| Event             | Trigger point                           | Email sent           |
| ----------------- | --------------------------------------- | -------------------- |
| `order.created`   | After RabbitMQ publish in `createOrder` | Order confirmation   |
| `order.paid`      | After PAID update in `authorizePayment` | Payment confirmation |
| `order.cancelled` | After cancel transaction commits        | Cancellation notice  |

`OrderEmailListener` handles all 3 events. Each handler catches errors and logs — email failure never breaks the order flow.

`EventEmitterModule.forRoot()` is registered in `OrdersModule`. Events are synchronous (fire-and-forget within the same process). `MailService` uses AWS SES in production; in dev mode (`AWS_SES_REGION` not set), emails are logged to console.
