# rd_shop — Full Order Flow

## Status lifecycle

```
PENDING → PROCESSED → PAID
               ↑
          (CANCELLED — defined, not yet implemented)
```

`CREATED` also exists in the enum but `PENDING` is the actual initial state set on creation.

## Phase 1 — HTTP: Order creation

**Endpoint:** `POST /api/v1/orders` — guard: `JwtAuthGuard` only  
**Input:** `CreateOrderDto { items: [{productId, quantity}], idempotencyKey?: string }`

```
Pre-validation (outside transaction):
  validateUser(userId from JWT)            → 404 if not found
  validateOrderItems(items)                → 400 if qty ≤0 or >1000
  checkIdempotency(idempotencyKey)         → 200 + existing order if key seen before
  validateProductsExist(productIds)        → 404 if any product missing

DB Transaction:
  SET LOCAL statement_timeout = 30s
  SET LOCAL lock_timeout = 10s
  SELECT ... FOR UPDATE (pessimistic write lock on all products in order)
  validateStockAndAvailability()           → 409 if !isActive or stock < qty
  decrementProductStock()                  → subtract quantities in-memory
  saveProducts()                           → persist stock changes
  createOrder(status: PENDING)
  createOrderItems(priceAtPurchase snapshot from product.price at this moment)
  COMMIT

Error handling:
  23505 + idempotencyKey                   → checkIdempotency() → return existing
  57014 (statement timeout)                → 500 "timed out due to high load"
  55P03 (lock timeout)                     → 409 "high concurrent activity"

Post-commit (non-blocking):
  publish to orders.process: OrderProcessMessageDto {
    messageId: UUID,
    orderId,
    attempt: 1,
    correlationId: idempotencyKey
  }

Response: HTTP 201 { data: Order with items + products }
```

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

**Method:** `OrdersService.processOrderMessage(payload)`

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
| HTTP creation         | `idempotencyKey` unique index on `orders`     | Duplicate POST /orders                  |
| Worker processing     | `processed_messages.messageId` unique index   | RabbitMQ redelivery                     |
| Payment authorization | `order.paymentId` null-check before gRPC call | Worker retry after gRPC partial failure |
| gRPC authorize        | `orderId` unique index on `payments`          | Duplicate gRPC calls                    |

## Key entities

**Order** — `apps/shop/src/orders/order.entity.ts`  
`id`, `userId FK`, `status`, `idempotencyKey (unique nullable)`, `paymentId (unique nullable)`, `items OneToMany`, `createdAt/updatedAt`  
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
