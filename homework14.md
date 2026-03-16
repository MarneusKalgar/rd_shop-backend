# Homework 14 — Orders → Payments gRPC Integration

## 1. Architecture Overview

The system is a NestJS monorepo with **two independently deployed services**:

```
┌─────────────────────────────────────────────────────────────────┐
│  shop-service  (HTTP :8080 + RabbitMQ consumer)                 │
│                                                                 │
│   POST /api/v1/orders                                           │
│        │                                                        │
│        ▼                                                        │
│   OrdersService.createOrder()                                   │
│        │  DB transaction: lock products, decrement stock,       │
│        │  create order (status=PENDING), commit                 │
│        │                                                        │
│        ▼                                                        │
│   RabbitMQService.publish('order.process')                      │
│        │                                                        │
│        ▼ (async)                                                │
│   OrderWorkerService  ◄── consumes 'order.process'              │
│        │  DB transaction: idempotency guard, mark PROCESSED     │
│        │                                                        │
│        ▼                                                        │
│   PaymentsGrpcService.authorize()  ──────────────────────────►  │
│                                    gRPC :5001                   │
└─────────────────────────────────────────────────────────────────┘
                                                │
                              ┌─────────────────▼─────────────────────┐
                              │  payments-service  (gRPC :5001)       │
                              │                                       │
                              │   PaymentsController                  │
                              │   @GrpcMethod Authorize               │
                              │   @GrpcMethod GetPaymentStatus        │
                              │   @GrpcMethod Capture  (stub)         │
                              │   @GrpcMethod Refund   (stub)         │
                              │        │                              │
                              │        ▼                              │
                              │   PaymentsService                     │
                              │   idempotency: findOne({orderId})     │
                              │   creates Payment row (status=1)      │
                              │   returns paymentId + status          │
                              │                                       │
                              │   PostgreSQL: rd_shop_payments_dev    │
                              └───────────────────────────────────────┘
```

### Service responsibilities

|                | shop-service                  | payments-service                    |
| -------------- | ----------------------------- | ----------------------------------- |
| **Transport**  | HTTP REST + RabbitMQ consumer | gRPC only                           |
| **Port**       | `PORT` (default 8080)         | `PAYMENTS_GRPC_PORT` (default 5001) |
| **Database**   | `rd_shop_dev`                 | `rd_shop_payments_dev`              |
| **Auth**       | JWT (Bearer)                  | none (internal)                     |
| **Entrypoint** | `apps/shop/src/main.ts`       | `apps/payments/src/main.ts`         |

### Proto contract

Location: `proto/payments.proto` (shared root, copied into each service at container startup).

```
payments.proto
  └─► payments.proto      (via Docker volume copy)
  └─► payments.proto  (via Docker volume copy)
```

Neither service imports code from the other. The shop-service only knows payments through the proto-derived TypeScript interfaces in `apps/shop/src/payments/interfaces/index.ts`.

---

## 2. Full Request Flow

```
Client
  │
  │  POST /api/v1/auth/signup          (one-time)
  │  POST /api/v1/auth/signin          → JWT token
  │
  │  POST /api/v1/orders  (Bearer: <token>)
  │    body: { userId, items: [{ productId, quantity }], idempotencyKey? }
  │
  ▼
OrdersService.createOrder()
  ├── validateUser()
  ├── validateOrderItems()
  ├── checkIdempotency()               ← returns existing order if duplicate key
  ├── validateProductsExist()
  └── executeOrderTransaction()        ← BEGIN TRANSACTION
        ├── SET LOCAL statement_timeout = 30000
        ├── SET LOCAL lock_timeout = 10000
        ├── SELECT ... FOR UPDATE      ← pessimistic lock on products
        ├── validateStockAndAvailability()
        ├── decrementProductStock()
        ├── INSERT INTO orders
        ├── INSERT INTO order_items
        └── COMMIT
  └── publish('order.process', { messageId, orderId, correlationId })
  └── return order (status=PENDING) → HTTP 201

                    ── async, RabbitMQ ──▶

OrderWorkerService.handleMessage()
  └── OrdersService.processOrderMessage()
        └── BEGIN TRANSACTION
              ├── SELECT FROM processed_messages WHERE message_id = $1
              │     → if found: skip (already processed)
              ├── INSERT INTO processed_messages  ← idempotency guard
              ├── SELECT FROM orders WHERE id = $orderId
              ├── order.status = PROCESSED
              ├── UPDATE orders SET status = PROCESSED
              └── COMMIT

        └── authorizePayment(order)             ← outside transaction
              └── PaymentsGrpcService.authorize({
                    orderId: order.id,
                    amount,
                    currency: 'USD'
                  })
                  .pipe(timeout(PAYMENTS_GRPC_TIMEOUT_MS))  ← from env

                          ── gRPC ──▶

              PaymentsController.authorize()
                └── PaymentsService.authorize()
                      ├── findOne({ orderId })   ← idempotency check
                      │     → if found: return existing
                      ├── create Payment { paymentId: uuid(), status: AUTHORIZED }
                      └── save → return { paymentId, status }

              ◄─── gRPC response ────────────────

        └── UPDATE orders SET payment_id = $paymentId, status = PAID

Client polls:
  GET /api/v1/orders/:orderId/payment  (Bearer: <token>)
    └── OrdersService.getOrderPayment()
          └── PaymentsGrpcService.getPaymentStatus(order.paymentId)
                └── gRPC: PaymentsService.getPaymentStatus()
                      └── findOne({ paymentId }) → { paymentId, status }
    → HTTP 200 { data: { paymentId, status: "AUTHORIZED" } }
```

### Key design decisions

- **No direct code import** between services — only proto-contract TypeScript interfaces.
- **Idempotency at two layers**: payments-service deduplicates by `orderId` (DB unique index); shop-service deduplicates RabbitMQ messages by `messageId` via `ProcessedMessage` table.
- **Timeout**: gRPC calls wrapped with RxJS `timeout(PAYMENTS_GRPC_TIMEOUT_MS)` — value from env, never hardcoded.
- **Payment status is async**: `POST /orders` returns `PENDING`; payment is authorized after the worker processes the message. Poll `GET /orders/:id/payment` to get the result.

---

## 3. Environment Variables

### shop-service (`apps/shop/.env.development`)

| Variable                   | Example            | Description                |
| -------------------------- | ------------------ | -------------------------- |
| `PORT`                     | `8080`             | HTTP listen port           |
| `DATABASE_URL`             | `postgresql://...` | shop Postgres connection   |
| `JWT_ACCESS_SECRET`        | `<hex>`            | JWT signing secret         |
| `JWT_ACCESS_EXPIRES_IN`    | `1h`               | JWT token TTL              |
| `RABBITMQ_HOST`            | `rabbitmq`         | RabbitMQ hostname          |
| `RABBITMQ_PORT`            | `5672`             | RabbitMQ AMQP port         |
| `PAYMENTS_GRPC_HOST`       | `payments`         | payments-service hostname  |
| `PAYMENTS_GRPC_PORT`       | `5001`             | payments-service gRPC port |
| `PAYMENTS_GRPC_TIMEOUT_MS` | `5000`             | gRPC call timeout in ms    |

### payments-service (`apps/payments/.env.development`)

| Variable             | Example            | Description                  |
| -------------------- | ------------------ | ---------------------------- |
| `PAYMENTS_GRPC_HOST` | `0.0.0.0`          | gRPC bind address            |
| `PAYMENTS_GRPC_PORT` | `5001`             | gRPC listen port             |
| `DATABASE_URL`       | `postgresql://...` | payments Postgres connection |

---

## 4. Setup & Running Locally

**IMPORTANT NOTE:** This flow only works with development compose stack. Prod to be delivered later.

Services run in Docker Compose and communicate over a shared Docker bridge network `rd_shop_backend_dev_shared`.

### Step 1 — Create the shared network

```bash
docker network create rd_shop_backend_dev_shared
```

This only needs to be done once.

### Step 2 — Start payments-service

```bash
# via npm script (from project root)
cd apps/payments && npm run docker:start:dev

# or raw docker compose (from project root)
docker compose -p rd_shop_backend_payments_dev \
  -f apps/payments/compose.yml \
  -f apps/payments/compose.dev.yml \
  up
```

This starts:

- `payments` container — gRPC server on port `5001`
- `postgres` container — `rd_shop_payments_dev` database
- `migrate` container — runs TypeORM migrations on startup

Wait for the log:

```
payments-service gRPC started on 0.0.0.0:5001
```

### Step 3 — Start shop-service

```bash
# via npm script (from project root)
cd apps/shop && npm run docker:start:dev

# or raw docker compose (from project root)
docker compose -p rd_shop_backend_shop_dev \
  -f apps/shop/compose.yml \
  -f apps/shop/compose.dev.yml \
  up
```

This starts:

- `shop` container — HTTP server on port `8080`
- `postgres` container — `rd_shop_dev` database
- `rabbitmq` container — AMQP broker
- `minio` container — S3-compatible storage

Wait for the log:

```
Application is running on port: 8080
```

### Step 4 — Run migrations (if not auto-applied)

```bash
# shop-service — via npm script (from project root)
cd apps/shop && npm run db:migrate:dev

# shop-service — via docker exec
docker exec -it rd_shop_backend_shop_dev-app sh -c "cd apps/shop && npm run db:migrate:dev"

# payments-service — via npm script (from project root)
cd apps/payments && npm run db:migrate:dev

# payments-service — via docker exec
docker exec -it rd_shop_backend_payments_dev-payments sh -c "cd apps/payments && npm run db:migrate:dev"
```

### Teardown

```bash
# via npm scripts (from project root)
cd apps/shop && npm run docker:down:dev
cd apps/payments && npm run docker:down:dev

# or raw docker compose (from project root)
docker compose -p rd_shop_backend_shop_dev \
  -f apps/shop/compose.yml \
  -f apps/shop/compose.dev.yml \
  down
docker compose -p rd_shop_backend_payments_dev \
  -f apps/payments/compose.yml \
  -f apps/payments/compose.dev.yml \
  down

docker network rm rd_shop_backend_dev_shared
```

---

## 5. Happy Path — Step by Step

All requests require a JWT token. Obtain one first.

### 5.1 Register and sign in

**Register**

| Field       | Value                                                                            |
| ----------- | -------------------------------------------------------------------------------- |
| Method      | `POST`                                                                           |
| URL         | `http://localhost:8080/api/v1/auth/signup`                                       |
| Body (JSON) | `{ "email": "test@example.com", "password": "Password1!", "name": "Test User" }` |

**Sign in**

| Field       | Value                                                       |
| ----------- | ----------------------------------------------------------- |
| Method      | `POST`                                                      |
| URL         | `http://localhost:8080/api/v1/auth/signin`                  |
| Body (JSON) | `{ "email": "test@example.com", "password": "Password1!" }` |

Copy the `accessToken` from the response — you will need it for all subsequent requests.

**curl**

```bash
# Register
curl -s -X POST http://localhost:8080/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Password1!","name":"Test User"}'

# Sign in
curl -s -X POST http://localhost:8080/api/v1/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Password1!"}'
```

### 5.2 Product ID

Use this known product ID from seed data:

```
650e8400-e29b-41d4-a716-446655440001  # Wireless Bluetooth Headphones
```

### 5.3 Create an order

The user ID is taken from the JWT token — no `userId` field is needed in the request body.

| Field       | Value                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Method      | `POST`                                                                                                                         |
| URL         | `http://localhost:8080/api/v1/orders`                                                                                          |
| Auth        | Bearer Token → paste `accessToken` from step 5.1                                                                               |
| Body (JSON) | `{ "items": [{ "productId": "650e8400-e29b-41d4-a716-446655440001", "quantity": 1 }], "idempotencyKey": "<any unique UUID>" }` |

Copy the `id` from the response — you will need it in step 5.5.

**curl**

```bash
curl -s -X POST http://localhost:8080/api/v1/orders \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{ "productId": "650e8400-e29b-41d4-a716-446655440001", "quantity": 1 }],
    "idempotencyKey": "<any unique UUID>"
  }'
```

Expected response (HTTP 201):

```json
{
  "data": {
    "id": "<order-uuid>",
    "status": "PENDING",
    "userId": "<user-uuid>",
    "paymentId": null,
    "idempotencyKey": "<your-idempotency-key>",
    "createdAt": "2026-03-12T10:00:00.000Z",
    "updatedAt": "2026-03-12T10:00:00.000Z",
    "items": [
      {
        "id": "<item-uuid>",
        "productId": "650e8400-e29b-41d4-a716-446655440001",
        "quantity": 1,
        "priceAtPurchase": "99.99"
      }
    ]
  }
}
```

Copy the `id` value — you will need it in step 5.5.

The order is created synchronously with status `PENDING`; payment authorization happens asynchronously via the RabbitMQ worker.

### 5.4 Wait for payment authorization (~1–2 seconds)

The worker consumes the message, calls `Payments.Authorize` over gRPC, and updates the order to `PAID`.

### 5.5 Retrieve payment result

| Field  | Value                                                    |
| ------ | -------------------------------------------------------- |
| Method | `GET`                                                    |
| URL    | `http://localhost:8080/api/v1/orders/<ORDER_ID>/payment` |
| Auth   | Bearer Token → paste `accessToken` from step 5.1         |

Replace `<ORDER_ID>` with the order `id` from step 5.3.

**curl**

```bash
curl -s http://localhost:8080/api/v1/orders/<ORDER_ID>/payment \
  -H "Authorization: Bearer <accessToken>"
```

Expected response:

```json
{
  "data": {
    "paymentId": "b35292be-16b6-4806-a686-00b960f73b1a",
    "status": "AUTHORIZED"
  }
}
```

### 5.6 End-to-end summary

| Step                                      | What happens                                            |
| ----------------------------------------- | ------------------------------------------------------- |
| `POST /auth/signup` + `POST /auth/signin` | Get JWT                                                 |
| `POST /orders`                            | Order created (PENDING), message published to RabbitMQ  |
| Worker processes message                  | Order → PROCESSED, gRPC `Authorize` called              |
| payments-service                          | Creates Payment row, returns `paymentId` + `AUTHORIZED` |
| Order updated                             | status=PAID, `paymentId` stored on order                |
| `GET /orders/:id/payment`                 | gRPC `GetPaymentStatus` called, returns result          |

---

## 6. Proto Location and Connection

```
proto/payments.proto          ← single source of truth
```

Each service receives the proto file at container startup via a shell copy in the Docker command:

```bash
# payments-service (apps/payments/compose.dev.yml)
mkdir -p /app/apps/payments/src/proto && \
  cp /app/proto/payments.proto /app/apps/payments/src/proto/payments.proto

# shop-service (apps/shop/compose.dev.yml)
mkdir -p /app/apps/shop/src/proto && \
  cp /app/proto/payments.proto /app/apps/shop/src/proto/payments.proto
```

**payments-service** connects proto as gRPC server:

```typescript
// apps/payments/src/main.ts
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.GRPC,
  options: {
    package: 'payments',
    protoPath: join(__dirname, 'proto/payments.proto'),
    url: `${host}:${port}`,
  },
});
```

**shop-service** connects proto as gRPC client:

```typescript
// apps/shop/src/payments/payments-grpc.module.ts
ClientProxyFactory.create({
  transport: Transport.GRPC,
  options: {
    package: 'payments',
    protoPath: join(__dirname, '../proto/payments.proto'),
    url: `${PAYMENTS_GRPC_HOST}:${PAYMENTS_GRPC_PORT}`,
    loader: { enums: String },
  },
});
```

The shop-service has **no import of any payments-service module or entity**. The only coupling is the local interface mirror in index.ts, which matches the proto message shapes.
