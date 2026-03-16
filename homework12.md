## Overview

This document covers the RabbitMQ integration for asynchronous order processing in the RD Shop backend. After a successful order creation, a message is published to a processing queue. A dedicated worker consumes messages, updates the order status to `PROCESSED`, then triggers **payment authorization via gRPC to the `apps/payments` microservice** (updating the order to `PAID`), and handles failures with retry logic and dead-letter routing.

---

## 1. Startup Instructions

### 1.1 Development

```bash
# From apps/shop/ — starts shop + postgres + rabbitmq + minio
npm run docker:start:dev

# Also start the payments microservice (required for gRPC payment authorization)
# From apps/payments/:
npm run docker:start:dev

# Or manually (from apps/shop/):
docker compose -p rd_shop_backend_shop_dev -f compose.yml -f compose.dev.yml up
# And payments (from apps/payments/):
docker compose -p rd_shop_backend_payments_dev -f compose.yml -f compose.dev.yml up
```

**Available Management Interfaces:**

| Service             | URL                              | Credentials       |
| ------------------- | -------------------------------- | ----------------- |
| REST API            | `http://localhost:8080/api/v1`   | —                 |
| Swagger UI          | `http://localhost:8080/api-docs` | —                 |
| GraphQL Playground  | `http://localhost:8080/graphql`  | —                 |
| RabbitMQ Management | `http://localhost:15672`         | `guest` / `guest` |

Note: On Mac the RabbitMQ Management console can be accessed on http://127.0.0.1:15672/ by default

### 1.2 Environment Variables

Key RabbitMQ configuration from [`.env.development`](.env.development):

```bash
RABBITMQ_HOST=rabbitmq
RABBITMQ_PORT=5672
RABBITMQ_USER=guest
RABBITMQ_PASSWORD=guest
RABBITMQ_PREFETCH_COUNT=10
RABBITMQ_VHOST=/
RABBITMQ_MANAGEMENT_PORT=15672

# Simulation / testing
RABBITMQ_SIMULATE_DELAY=1000               # Artificial delay in ms per message
RABBITMQ_SIMULATE_FAILURE=false            # Set to "true" to force worker to throw
RABBITMQ_SIMULATE_DUPLICATE_MESSAGE_ID=    # Force a fixed messageId to test idempotency
```

### 1.3 Production

```bash
# From apps/shop/ — build and start
docker compose -p rd_shop_backend_shop_prod -f compose.yml up -d

# Also start the payments microservice (required for gRPC payment authorization)
# From apps/payments/:
docker compose -p rd_shop_backend_payments_prod -f compose.yml up -d

# View shop logs
docker compose -p rd_shop_backend_shop_prod -f compose.yml logs -f shop
```

---

## 2. RabbitMQ Topology

### 2.1 Overview

The project uses **classic queues** with **default direct exchange** (no custom exchanges declared). Messages are published and consumed directly by queue name.

```
┌──────────────────────────────────────────────────────────────────┐
│ Producer: OrdersService                                          │
│  publishOrderProcessingMessage()                                 │
└──────────────────────┬───────────────────────────────────────────┘
                       │ publish to routing key = "order.process"
                       ▼
            ┌──────────────────────┐
            │  Default Exchange    │
            │  (amq.direct / "")   │
            └──────────┬───────────┘
                       │ routes to queue with matching name
                       ▼
            ┌──────────────────────┐
            │  order.process       │  ← main processing queue
            │  durable: true       │
            └──────────┬───────────┘
                       │ consumed by
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ Consumer: OrderWorkerService                                     │
│  handleMessage() → ordersService.processOrderMessage()           │
│                                                                  │
│  On success  → mark PROCESSED → PaymentsGrpcService.authorize()   │
│               (gRPC → apps/payments) → mark PAID → ack            │
│  On failure  → retry (re-publish to order.process, attempt+1)    │
│  On max retry → publish to orders.dlq, ack original              │
└──────────────────────┬───────────────────────────────────────────┘
                       │ after MAX_RETRY_ATTEMPTS (3)
                       ▼
            ┌──────────────────────┐
            │  orders.dlq          │  ← dead-letter queue
            │  durable: true       │
            └──────────────────────┘
```

### 2.2 Exchanges

| Exchange       | Type   | Durable | Description                                                        |
| -------------- | ------ | ------- | ------------------------------------------------------------------ |
| `""` (default) | direct | yes     | Built-in AMQP default exchange. Routes by routing key = queue name |

> No custom exchanges are declared. The application uses the default AMQP exchange for simplicity.

### 2.3 Queues

| Queue           | Durable | Purpose                                      | Declared in                                                         |
| --------------- | ------- | -------------------------------------------- | ------------------------------------------------------------------- |
| `order.process` | `true`  | Main queue for new order processing messages | [`RabbitMQService.setupQueues()`](src/rabbitmq/rabbitmq.service.ts) |
| `orders.dlq`    | `true`  | Dead-letter queue for failed messages        | [`RabbitMQService.setupQueues()`](src/rabbitmq/rabbitmq.service.ts) |

Queue names are defined as constants in [`src/rabbitmq/constants/index.ts`](src/rabbitmq/constants/index.ts):

```typescript
export const ORDER_PROCESS_QUEUE = 'order.process';
export const ORDER_DLQ = 'orders.dlq';
```

### 2.4 Routing Keys

| Routing Key     | Target Queue    | Published by                             |
| --------------- | --------------- | ---------------------------------------- |
| `order.process` | `order.process` | `OrdersService` (after order creation)   |
| `orders.dlq`    | `orders.dlq`    | `OrderWorkerService` (after max retries) |

### 2.5 Message Schema

Messages on `order.process` follow [`OrderProcessMessageDto`](src/orders/dto/order-process-message.dto.ts):

```typescript
{
  messageId: string;       // UUID — used for idempotency deduplication
  orderId: string;         // UUID of the created Order
  correlationId: string;   // UUID — maps to idempotencyKey from order creation
  producer: string;        // "orders-service"
  eventName: string;       // "order.process"
  createdAt: string;       // ISO timestamp
  attempt: number;         // 1 on first publish, incremented on retry
  raw?: unknown;           // Set on DLQ for unparseable messages
}
```

### 2.6 Checking via RabbitMQ Management UI

1. Open `http://localhost:15672` (credentials: `guest` / `guest`)
2. Navigate to **Queues** tab → verify `order.process` and `orders.dlq` are listed as **durable**
3. To inspect a message without consuming it: click queue name → **Get messages** → Ack mode: `Nack message requeue true`
4. To monitor throughput: **Overview** tab → Message rates graph
5. To check consumer count: click `order.process` → **Consumers** section

---

## 3. Retry Policy

### 3.1 Configuration

Retry constants are defined in [`src/rabbitmq/constants/index.ts`](src/rabbitmq/constants/index.ts):

```typescript
export const MAX_RETRY_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 2000; // 2 seconds between retries
```

### 3.2 Flow

```
Attempt 1 → fails
  wait 2s → re-publish to order.process (attempt: 2)

Attempt 2 → fails
  wait 2s → re-publish to order.process (attempt: 3)

Attempt 3 → fails
  publish to orders.dlq (attempt: 3)
  ack original message
  log: "[result: dlq] max retries reached"
```

### 3.3 Implementation

Retry logic lives in [`OrderWorkerService`](src/orders-worker/orders-worker.service.ts):

```
handleMessage()
  ├── parse message (if fails → DLQ immediately, no retry)
  ├── call ordersService.processOrderMessage()
  │     ├── success → channel.ack()
  │     └── error ──→ if attempt < MAX_RETRY_ATTEMPTS
  │                       retryMessage()  ← delay + re-publish with attempt+1
  │                   else
  │                       publishToDlq() ← send to orders.dlq
  │                       channel.ack()  ← remove from order.process
```

**Key behaviors:**

- The original message is always **acked** after processing (success, retry scheduled, or DLQ) — no message is ever nacked/requeued via AMQP
- Retry delay (`RETRY_DELAY_MS = 2000ms`) is applied in-process before re-publishing
- DLQ messages retain the full payload including `attempt`, `messageId`, and `orderId` for debugging
- Unparseable messages (JSON parse error) skip retry and go directly to DLQ with `raw` (base64-encoded body)

### 3.4 Simulating Failures

Set in [`.env.development`](.env.development):

```bash
RABBITMQ_SIMULATE_FAILURE=true   # worker throws on every message → triggers retry loop
RABBITMQ_SIMULATE_DELAY=1000     # adds 1s artificial delay per message
```

---

## 4. Idempotency

### 4.1 Problem

RabbitMQ provides **at-least-once delivery**. Under network partitions or worker crashes after processing but before acking, the same message may be delivered more than once. Without a deduplication guard, an order could be processed multiple times.

### 4.2 Solution: ProcessedMessage Table

The worker uses a database-level idempotency guard via the [`ProcessedMessage`](src/rabbitmq/processed-message.entity.ts) entity:

```
processed_messages
├── id              UUID PK
├── message_id      VARCHAR(200)  UNIQUE INDEX  ← primary deduplication key
├── idempotency_key VARCHAR(255)  UNIQUE INDEX (partial, WHERE NOT NULL)
├── order_id        VARCHAR(255)  nullable
├── scope           VARCHAR(100)  ("order-worker")
├── created_at      TIMESTAMPTZ
└── processed_at    TIMESTAMPTZ
```

### 4.3 Processing Flow

All steps execute inside a **single database transaction** in [`OrdersService.processOrderMessage()`](src/orders/orders.service.ts):

```
BEGIN TRANSACTION

1. SELECT from processed_messages WHERE message_id = $messageId
   → if found: log "already processed", RETURN (skip, no re-processing)

2. INSERT INTO processed_messages (message_id, idempotency_key, order_id, ...)
   → if UNIQUE VIOLATION (code 23505): another concurrent worker already inserted
     → log "duplicate", RETURN (safe to skip)

3. Fetch Order by orderId
   → if not found: throw NotFoundException (worker will retry / DLQ)

4. Check order.status === PROCESSED → skip if already done
   Check order.status !== PENDING → skip if unexpected state

5. Simulate failure / delay if configured (RABBITMQ_SIMULATE_FAILURE / _DELAY)

6. UPDATE order SET status = PROCESSED

COMMIT

7. After transaction: if order.paymentId is null
   → call PaymentsGrpcService.authorize() via gRPC → apps/payments microservice
   → on success: UPDATE order SET status = PAID, paymentId = $paymentId
   → on failure: throws (worker should nack / retry)
```

### 4.4 Two Deduplication Layers

| Layer            | Column                      | Handles                                                |
| ---------------- | --------------------------- | ------------------------------------------------------ |
| Pre-insert check | `message_id` (SELECT)       | Fast path — avoids unnecessary INSERT                  |
| DB constraint    | `message_id` (UNIQUE INDEX) | Race condition — two workers processing simultaneously |

### 4.5 Relation to Order Creation Idempotency

Order **creation** has its own separate idempotency mechanism via `orders.idempotency_key`. Order **processing** (worker) uses `processed_messages.message_id`. The `correlationId` in the message maps back to the original `idempotencyKey`, providing an end-to-end correlation chain:

```
POST /v1/orders { idempotencyKey: "client-uuid" }
  → Order created with idempotencyKey = "client-uuid"
  → Message published: { messageId: "uuid-A", correlationId: "client-uuid" }
  → ProcessedMessage inserted: { message_id: "uuid-A", idempotency_key: "client-uuid" }
```

### 4.6 Testing Idempotency

Set a fixed `messageId` to force duplication across restarts:

```bash
# .env.development
RABBITMQ_SIMULATE_DUPLICATE_MESSAGE_ID=test-duplicate-message-id-001
```

All orders created while this is set will publish messages with the same `messageId`. Only the first delivery will be processed; subsequent deliveries will be silently skipped.

---

## 5. Evidence

### Prerequisites

All evidence scenarios require an authenticated user. Sign up and sign in before running any requests.

**Sign Up**

```
POST http://localhost:8080/api/v1/auth/signup
```

Request:

```json
{
  "email": "test@test.com",
  "password": "test1234"
}
```

Response:

```json
{
  "email": "test@test.com",
  "id": "d96038d4-3ec0-439c-97ab-01a07dbcaa09",
  "message": "User successfully registered. Please sign in to continue."
}
```

**Sign In**

```
POST http://localhost:8080/api/v1/auth/signin
```

Request:

```json
{
  "email": "test@test.com",
  "password": "test1234"
}
```

Response:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InRlc3RAdGVzdC5jb20iLCJyb2xlcyI6W10sInNjb3BlcyI6W10sInN1YiI6ImQ5NjAzOGQ0LTNlYzAtNDM5Yy05N2FiLTAxYTA3ZGJjYWEwOSIsImlhdCI6MTc3MjYzOTUxOSwiZXhwIjoxNzcyNjQwMTE5fQ.3Y2lOc8N-eZvxURNsujf7ZNte51YZMKebuFIC0FMtxM",
  "user": {
    "email": "test@test.com",
    "id": "d96038d4-3ec0-439c-97ab-01a07dbcaa09"
  }
}
```

Use the `accessToken` value as a Bearer token in the `Authorization` header for all subsequent requests:

```
Authorization: Bearer <accessToken>
```

### 5.1 Happy Path

**Scenario:** Create an order → worker picks it up → order status transitions to `PROCESSED`

**Steps:**

1. `POST /api/v1/orders` with valid payload
2. Order created with status `PENDING`
3. Message published to `order.process`
4. Worker consumes message, updates order to `PROCESSED`
5. `ProcessedMessage` record inserted

**Logs:**

```bash
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:31 PM     LOG [OrdersService] Order created successfully: 6778f5c9-c65d-449a-821a-2b5160da93f8
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:31 PM   DEBUG [RabbitMQService] Message published to queue "order.process": {"attempt":1,"correlationId":"client-generated-uuid-15","createdAt":"2026-03-04T15:52:31.017Z","eventName":"order.process","messageId":"1473f8e2-8058-46ae-90f3-5a95de89454e","orderId":"6778f5c9-c65d-449a-821a-2b5160da93f8","producer":"orders-service"}
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:31 PM     LOG [OrdersService] Order processing message published for order: 6778f5c9-c65d-449a-821a-2b5160da93f8
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:31 PM   DEBUG [TypeORM] Query: COMMIT
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:31 PM     LOG [OrderWorkerService] Received order.process message [messageId: 1473f8e2-8058-46ae-90f3-5a95de89454e, orderId: 6778f5c9-c65d-449a-821a-2b5160da93f8, attempt: 1]
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:31 PM   DEBUG [TypeORM] Query: START TRANSACTION
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:31 PM   DEBUG [TypeORM] Query: SELECT "ProcessedMessage"."created_at" AS "ProcessedMessage_created_at", "ProcessedMessage"."id" AS "ProcessedMessage_id", "ProcessedMessage"."idempotency_key" AS "ProcessedMessage_idempotency_key", "ProcessedMessage"."message_id" AS "ProcessedMessage_message_id", "ProcessedMessage"."order_id" AS "ProcessedMessage_order_id", "ProcessedMessage"."processed_at" AS "ProcessedMessage_processed_at", "ProcessedMessage"."scope" AS "ProcessedMessage_scope" FROM "processed_messages" "ProcessedMessage" WHERE (("ProcessedMessage"."message_id" = $1)) LIMIT 1 -- Parameters: ["1473f8e2-8058-46ae-90f3-5a95de89454e"]
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:31 PM   DEBUG [TypeORM] Query: INSERT INTO "processed_messages"("created_at", "id", "idempotency_key", "message_id", "order_id", "processed_at", "scope") VALUES (DEFAULT, DEFAULT, $1, $2, $3, $4, $5) RETURNING "created_at", "id" -- Parameters: ["client-generated-uuid-15","1473f8e2-8058-46ae-90f3-5a95de89454e","6778f5c9-c65d-449a-821a-2b5160da93f8","2026-03-04T15:52:31.022Z","order-worker"]
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:31 PM   DEBUG [TypeORM] Query: SELECT "Order"."created_at" AS "Order_created_at", "Order"."id" AS "Order_id", "Order"."idempotency_key" AS "Order_idempotency_key", "Order"."status" AS "Order_status", "Order"."updated_at" AS "Order_updated_at", "Order"."user_id" AS "Order_user_id" FROM "orders" "Order" WHERE (("Order"."id" = $1)) LIMIT 1 -- Parameters: ["6778f5c9-c65d-449a-821a-2b5160da93f8"]
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:31 PM    WARN [OrdersService] Simulating processing delay of 1000ms for messageId: 1473f8e2-8058-46ae-90f3-5a95de89454e
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:32 PM   DEBUG [TypeORM] Query: SELECT "Order"."created_at" AS "Order_created_at", "Order"."id" AS "Order_id", "Order"."idempotency_key" AS "Order_idempotency_key", "Order"."status" AS "Order_status", "Order"."updated_at" AS "Order_updated_at", "Order"."user_id" AS "Order_user_id" FROM "orders" "Order" WHERE "Order"."id" IN ($1) -- Parameters: ["6778f5c9-c65d-449a-821a-2b5160da93f8"]
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:32 PM   DEBUG [TypeORM] Query: UPDATE "orders" SET "status" = $1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" IN ($2) RETURNING "updated_at" -- Parameters: ["PROCESSED","6778f5c9-c65d-449a-821a-2b5160da93f8"]
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:32 PM     LOG [OrdersService] Order "6778f5c9-c65d-449a-821a-2b5160da93f8" marked as PROCESSED
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:32 PM   DEBUG [TypeORM] Query: COMMIT
# payment authorization gRPC call to apps/payments happens here → order updated to PAID
rd_shop_backend_shop_dev-app | [Nest] 50  - 03/04/2026, 3:52:32 PM     LOG [OrderWorkerService] [result: success] Acked message [messageId: 1473f8e2-8058-46ae-90f3-5a95de89454e, orderId: 6778f5c9-c65d-449a-821a-2b5160da93f8, attempt: 1] processed successfully
```

---

### 5.2 Retry

**Scenario:** Worker fails on first attempt(s) → retried up to `MAX_RETRY_ATTEMPTS` (3)

**Setup:**

```bash
RABBITMQ_SIMULATE_FAILURE=true
```

**Steps:**

1. Create an order
2. Worker receives message, throws simulated error
3. Observe retry attempts logged (attempt 1 → 2 → 3)
4. After attempt 3, message routed to `orders.dlq`

**Logs:**

```bash
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:26 PM     LOG [OrdersService] Order created successfully: 7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:26 PM   DEBUG [RabbitMQService] Message published to queue "order.process": {"attempt":1,"correlationId":"client-generated-uuid-16","createdAt":"2026-03-04T15:54:26.619Z","eventName":"order.process","messageId":"6985970e-0fc5-4837-9109-551b8714a7b9","orderId":"7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c","producer":"orders-service"}
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:26 PM     LOG [OrdersService] Order processing message published for order: 7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:26 PM   DEBUG [TypeORM] Query: COMMIT
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:26 PM     LOG [OrderWorkerService] Received order.process message [messageId: 6985970e-0fc5-4837-9109-551b8714a7b9, orderId: 7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c, attempt: 1]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:26 PM   DEBUG [TypeORM] Query: START TRANSACTION
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:26 PM   DEBUG [TypeORM] Query: SELECT "ProcessedMessage"."created_at" AS "ProcessedMessage_created_at", "ProcessedMessage"."id" AS "ProcessedMessage_id", "ProcessedMessage"."idempotency_key" AS "ProcessedMessage_idempotency_key", "ProcessedMessage"."message_id" AS "ProcessedMessage_message_id", "ProcessedMessage"."order_id" AS "ProcessedMessage_order_id", "ProcessedMessage"."processed_at" AS "ProcessedMessage_processed_at", "ProcessedMessage"."scope" AS "ProcessedMessage_scope" FROM "processed_messages" "ProcessedMessage" WHERE (("ProcessedMessage"."message_id" = $1)) LIMIT 1 -- Parameters: ["6985970e-0fc5-4837-9109-551b8714a7b9"]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:26 PM   DEBUG [TypeORM] Query: INSERT INTO "processed_messages"("created_at", "id", "idempotency_key", "message_id", "order_id", "processed_at", "scope") VALUES (DEFAULT, DEFAULT, $1, $2, $3, $4, $5) RETURNING "created_at", "id" -- Parameters: ["client-generated-uuid-16","6985970e-0fc5-4837-9109-551b8714a7b9","7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c","2026-03-04T15:54:26.625Z","order-worker"]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:26 PM   DEBUG [TypeORM] Query: SELECT "Order"."created_at" AS "Order_created_at", "Order"."id" AS "Order_id", "Order"."idempotency_key" AS "Order_idempotency_key", "Order"."status" AS "Order_status", "Order"."updated_at" AS "Order_updated_at", "Order"."user_id" AS "Order_user_id" FROM "orders" "Order" WHERE (("Order"."id" = $1)) LIMIT 1 -- Parameters: ["7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c"]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:26 PM    WARN [OrdersService] Simulating processing failure for messageId: 6985970e-0fc5-4837-9109-551b8714a7b9
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:26 PM   DEBUG [TypeORM] Query: ROLLBACK
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:26 PM   ERROR [OrderWorkerService] [result: error] Failed to process message [messageId: 6985970e-0fc5-4837-9109-551b8714a7b9, orderId: 7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c, attempt: 1] reason: Simulated processing failure
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:26 PM   ERROR [OrderWorkerService] Error: Simulated processing failure
rd_shop_backend_shop_dev-app |     at <anonymous> (/app/apps/shop/src/orders/orders.service.ts:246:15)
rd_shop_backend_shop_dev-app |     at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
rd_shop_backend_shop_dev-app |     at async EntityManager.transaction (/app/node_modules/typeorm/entity-manager/src/entity-manager/EntityManager.ts:156:28)
rd_shop_backend_shop_dev-app |     at async OrdersService.processOrderMessage (/app/apps/shop/src/orders/orders.service.ts:202:5)
rd_shop_backend_shop_dev-app |     at async OrderWorkerService.handleMessage (/app/apps/shop/src/orders-worker/orders-worker.service.ts:52:7)
rd_shop_backend_shop_dev-app |     at async <anonymous> (/app/apps/shop/src/orders-worker/orders-worker.service.ts:104:9)
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:28 PM   DEBUG [RabbitMQService] Message published to queue "order.process": {"attempt":2,"correlationId":"client-generated-uuid-16","createdAt":"2026-03-04T15:54:26.619Z","eventName":"order.process","messageId":"6985970e-0fc5-4837-9109-551b8714a7b9","orderId":"7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c","producer":"orders-service"}
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:28 PM    WARN [OrderWorkerService] [result: retry] Scheduled retry [messageId: 6985970e-0fc5-4837-9109-551b8714a7b9, orderId: 7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c, attempt: 1, nextAttempt: 2]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:28 PM     LOG [OrderWorkerService] Received order.process message [messageId: 6985970e-0fc5-4837-9109-551b8714a7b9, orderId: 7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c, attempt: 2]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:28 PM   DEBUG [TypeORM] Query: START TRANSACTION
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:28 PM   DEBUG [TypeORM] Query: SELECT "ProcessedMessage"."created_at" AS "ProcessedMessage_created_at", "ProcessedMessage"."id" AS "ProcessedMessage_id", "ProcessedMessage"."idempotency_key" AS "ProcessedMessage_idempotency_key", "ProcessedMessage"."message_id" AS "ProcessedMessage_message_id", "ProcessedMessage"."order_id" AS "ProcessedMessage_order_id", "ProcessedMessage"."processed_at" AS "ProcessedMessage_processed_at", "ProcessedMessage"."scope" AS "ProcessedMessage_scope" FROM "processed_messages" "ProcessedMessage" WHERE (("ProcessedMessage"."message_id" = $1)) LIMIT 1 -- Parameters: ["6985970e-0fc5-4837-9109-551b8714a7b9"]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:28 PM   DEBUG [TypeORM] Query: INSERT INTO "processed_messages"("created_at", "id", "idempotency_key", "message_id", "order_id", "processed_at", "scope") VALUES (DEFAULT, DEFAULT, $1, $2, $3, $4, $5) RETURNING "created_at", "id" -- Parameters: ["client-generated-uuid-16","6985970e-0fc5-4837-9109-551b8714a7b9","7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c","2026-03-04T15:54:28.647Z","order-worker"]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:28 PM   DEBUG [TypeORM] Query: SELECT "Order"."created_at" AS "Order_created_at", "Order"."id" AS "Order_id", "Order"."idempotency_key" AS "Order_idempotency_key", "Order"."status" AS "Order_status", "Order"."updated_at" AS "Order_updated_at", "Order"."user_id" AS "Order_user_id" FROM "orders" "Order" WHERE (("Order"."id" = $1)) LIMIT 1 -- Parameters: ["7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c"]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:28 PM    WARN [OrdersService] Simulating processing failure for messageId: 6985970e-0fc5-4837-9109-551b8714a7b9
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:28 PM   DEBUG [TypeORM] Query: ROLLBACK
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:28 PM   ERROR [OrderWorkerService] [result: error] Failed to process message [messageId: 6985970e-0fc5-4837-9109-551b8714a7b9, orderId: 7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c, attempt: 2] reason: Simulated processing failure
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:28 PM   ERROR [OrderWorkerService] Error: Simulated processing failure
rd_shop_backend_shop_dev-app |     at <anonymous> (/app/apps/shop/src/orders/orders.service.ts:246:15)
rd_shop_backend_shop_dev-app |     at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
rd_shop_backend_shop_dev-app |     at async EntityManager.transaction (/app/node_modules/typeorm/entity-manager/src/entity-manager/EntityManager.ts:156:28)
rd_shop_backend_shop_dev-app |     at async OrdersService.processOrderMessage (/app/apps/shop/src/orders/orders.service.ts:202:5)
rd_shop_backend_shop_dev-app |     at async OrderWorkerService.handleMessage (/app/apps/shop/src/orders-worker/orders-worker.service.ts:52:7)
rd_shop_backend_shop_dev-app |     at async <anonymous> (/app/apps/shop/src/orders-worker/orders-worker.service.ts:104:9)
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:30 PM   DEBUG [RabbitMQService] Message published to queue "order.process": {"attempt":3,"correlationId":"client-generated-uuid-16","createdAt":"2026-03-04T15:54:26.619Z","eventName":"order.process","messageId":"6985970e-0fc5-4837-9109-551b8714a7b9","orderId":"7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c","producer":"orders-service"}
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:30 PM    WARN [OrderWorkerService] [result: retry] Scheduled retry [messageId: 6985970e-0fc5-4837-9109-551b8714a7b9, orderId: 7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c, attempt: 2, nextAttempt: 3]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:30 PM     LOG [OrderWorkerService] Received order.process message [messageId: 6985970e-0fc5-4837-9109-551b8714a7b9, orderId: 7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c, attempt: 3]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:30 PM   DEBUG [TypeORM] Query: START TRANSACTION
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:30 PM   DEBUG [TypeORM] Query: SELECT "ProcessedMessage"."created_at" AS "ProcessedMessage_created_at", "ProcessedMessage"."id" AS "ProcessedMessage_id", "ProcessedMessage"."idempotency_key" AS "ProcessedMessage_idempotency_key", "ProcessedMessage"."message_id" AS "ProcessedMessage_message_id", "ProcessedMessage"."order_id" AS "ProcessedMessage_order_id", "ProcessedMessage"."processed_at" AS "ProcessedMessage_processed_at", "ProcessedMessage"."scope" AS "ProcessedMessage_scope" FROM "processed_messages" "ProcessedMessage" WHERE (("ProcessedMessage"."message_id" = $1)) LIMIT 1 -- Parameters: ["6985970e-0fc5-4837-9109-551b8714a7b9"]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:30 PM   DEBUG [TypeORM] Query: INSERT INTO "processed_messages"("created_at", "id", "idempotency_key", "message_id", "order_id", "processed_at", "scope") VALUES (DEFAULT, DEFAULT, $1, $2, $3, $4, $5) RETURNING "created_at", "id" -- Parameters: ["client-generated-uuid-16","6985970e-0fc5-4837-9109-551b8714a7b9","7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c","2026-03-04T15:54:30.665Z","order-worker"]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:30 PM   DEBUG [TypeORM] Query: SELECT "Order"."created_at" AS "Order_created_at", "Order"."id" AS "Order_id", "Order"."idempotency_key" AS "Order_idempotency_key", "Order"."status" AS "Order_status", "Order"."updated_at" AS "Order_updated_at", "Order"."user_id" AS "Order_user_id" FROM "orders" "Order" WHERE (("Order"."id" = $1)) LIMIT 1 -- Parameters: ["7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c"]
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:30 PM    WARN [OrdersService] Simulating processing failure for messageId: 6985970e-0fc5-4837-9109-551b8714a7b9
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:30 PM   DEBUG [TypeORM] Query: ROLLBACK
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:30 PM   ERROR [OrderWorkerService] [result: error] Failed to process message [messageId: 6985970e-0fc5-4837-9109-551b8714a7b9, orderId: 7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c, attempt: 3] reason: Simulated processing failure
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:30 PM   ERROR [OrderWorkerService] Error: Simulated processing failure
rd_shop_backend_shop_dev-app |     at <anonymous> (/app/apps/shop/src/orders/orders.service.ts:246:15)
rd_shop_backend_shop_dev-app |     at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
rd_shop_backend_shop_dev-app |     at async EntityManager.transaction (/app/node_modules/typeorm/entity-manager/src/entity-manager/EntityManager.ts:156:28)
rd_shop_backend_shop_dev-app |     at async OrdersService.processOrderMessage (/app/apps/shop/src/orders/orders.service.ts:202:5)
rd_shop_backend_shop_dev-app |     at async OrderWorkerService.handleMessage (/app/apps/shop/src/orders-worker/orders-worker.service.ts:52:7)
rd_shop_backend_shop_dev-app |     at async <anonymous> (/app/apps/shop/src/orders-worker/orders-worker.service.ts:104:9)
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:30 PM   DEBUG [RabbitMQService] Message published to queue "orders.dlq": {"attempt":3,"correlationId":"client-generated-uuid-16","createdAt":"2026-03-04T15:54:26.619Z","eventName":"order.process","messageId":"6985970e-0fc5-4837-9109-551b8714a7b9","orderId":"7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c","producer":"orders-service"}
rd_shop_backend_shop_dev-app | [Nest] 37  - 03/04/2026, 3:54:30 PM   ERROR [OrderWorkerService] [result: dlq] [messageId: 6985970e-0fc5-4837-9109-551b8714a7b9, orderId: 7a43f1db-8a65-47d2-9047-4ac0c7ba8e2c, attempt: 3] reason: max retries (3) reached
```

---

### 5.3 DLQ

**Scenario:** After `MAX_RETRY_ATTEMPTS` exhausted → message appears in `orders.dlq`

**Setup:**

```bash
RABBITMQ_SIMULATE_FAILURE=true
```

**Steps:**

1. Create an order
2. Let worker exhaust all 3 retry attempts
3. Verify message in `orders.dlq` via Management UI or logs
4. Check `[result: dlq]` log entry

**Logs:**

## See the logs for the Retry scenario

### 5.4 Idempotency

**Scenario:** Same `messageId` delivered twice → second delivery skipped, no duplicate processing

**Setup:**

```bash
RABBITMQ_SIMULATE_FAILURE=false
RABBITMQ_SIMULATE_DUPLICATE_MESSAGE_ID=test-duplicate-message-id-002
```

**Steps:**

1. Create an order — message published with fixed `messageId`
2. Worker processes message → `ProcessedMessage` record inserted
3. Manually re-publish the same message (or restart with same ID)
4. Worker receives message again → detects `message_id` already in `processed_messages`
5. Logs `"already processed, skipping"` — order NOT updated twice

**Logs:**

- first order

```bash
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:53 PM     LOG [OrdersService] Order created successfully: 5093a428-d5b2-4222-9873-bbfd9f7d3f37
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:53 PM   DEBUG [RabbitMQService] Message published to queue "order.process": {"attempt":1,"correlationId":"client-generated-uuid-17","createdAt":"2026-03-04T15:59:53.041Z","eventName":"order.process","messageId":"test-duplicate-message-id-002","orderId":"5093a428-d5b2-4222-9873-bbfd9f7d3f37","producer":"orders-service"}
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:53 PM     LOG [OrdersService] Order processing message published for order: 5093a428-d5b2-4222-9873-bbfd9f7d3f37
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:53 PM   DEBUG [TypeORM] Query: COMMIT
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:53 PM     LOG [OrderWorkerService] Received order.process message [messageId: test-duplicate-message-id-002, orderId: 5093a428-d5b2-4222-9873-bbfd9f7d3f37, attempt: 1]
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:53 PM   DEBUG [TypeORM] Query: START TRANSACTION
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:53 PM   DEBUG [TypeORM] Query: SELECT "ProcessedMessage"."created_at" AS "ProcessedMessage_created_at", "ProcessedMessage"."id" AS "ProcessedMessage_id", "ProcessedMessage"."idempotency_key" AS "ProcessedMessage_idempotency_key", "ProcessedMessage"."message_id" AS "ProcessedMessage_message_id", "ProcessedMessage"."order_id" AS "ProcessedMessage_order_id", "ProcessedMessage"."processed_at" AS "ProcessedMessage_processed_at", "ProcessedMessage"."scope" AS "ProcessedMessage_scope" FROM "processed_messages" "ProcessedMessage" WHERE (("ProcessedMessage"."message_id" = $1)) LIMIT 1 -- Parameters: ["test-duplicate-message-id-002"]
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:53 PM   DEBUG [TypeORM] Query: INSERT INTO "processed_messages"("created_at", "id", "idempotency_key", "message_id", "order_id", "processed_at", "scope") VALUES (DEFAULT, DEFAULT, $1, $2, $3, $4, $5) RETURNING "created_at", "id" -- Parameters: ["client-generated-uuid-17","test-duplicate-message-id-002","5093a428-d5b2-4222-9873-bbfd9f7d3f37","2026-03-04T15:59:53.047Z","order-worker"]
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:53 PM   DEBUG [TypeORM] Query: SELECT "Order"."created_at" AS "Order_created_at", "Order"."id" AS "Order_id", "Order"."idempotency_key" AS "Order_idempotency_key", "Order"."status" AS "Order_status", "Order"."updated_at" AS "Order_updated_at", "Order"."user_id" AS "Order_user_id" FROM "orders" "Order" WHERE (("Order"."id" = $1)) LIMIT 1 -- Parameters: ["5093a428-d5b2-4222-9873-bbfd9f7d3f37"]
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:53 PM    WARN [OrdersService] Simulating processing delay of 1000ms for messageId: test-duplicate-message-id-002
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:54 PM   DEBUG [TypeORM] Query: SELECT "Order"."created_at" AS "Order_created_at", "Order"."id" AS "Order_id", "Order"."idempotency_key" AS "Order_idempotency_key", "Order"."status" AS "Order_status", "Order"."updated_at" AS "Order_updated_at", "Order"."user_id" AS "Order_user_id" FROM "orders" "Order" WHERE "Order"."id" IN ($1) -- Parameters: ["5093a428-d5b2-4222-9873-bbfd9f7d3f37"]
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:54 PM   DEBUG [TypeORM] Query: UPDATE "orders" SET "status" = $1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" IN ($2) RETURNING "updated_at" -- Parameters: ["PROCESSED","5093a428-d5b2-4222-9873-bbfd9f7d3f37"]
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:54 PM     LOG [OrdersService] Order "5093a428-d5b2-4222-9873-bbfd9f7d3f37" marked as PROCESSED
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:54 PM   DEBUG [TypeORM] Query: COMMIT
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 3:59:54 PM     LOG [OrderWorkerService] [result: success] Acked message [messageId: test-duplicate-message-id-002, orderId: 5093a428-d5b2-4222-9873-bbfd9f7d3f37, attempt: 1] processed successfully
```

- second order

```bash
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 4:04:26 PM     LOG [OrdersService] Order created successfully: cbf9b9f1-7f85-4f8a-ad98-9c17534a5a0a
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 4:04:26 PM   DEBUG [RabbitMQService] Message published to queue "order.process": {"attempt":1,"correlationId":"client-generated-uuid-18","createdAt":"2026-03-04T16:04:26.588Z","eventName":"order.process","messageId":"test-duplicate-message-id-002","orderId":"cbf9b9f1-7f85-4f8a-ad98-9c17534a5a0a","producer":"orders-service"}
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 4:04:26 PM     LOG [OrdersService] Order processing message published for order: cbf9b9f1-7f85-4f8a-ad98-9c17534a5a0a
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 4:04:26 PM   DEBUG [TypeORM] Query: COMMIT
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 4:04:26 PM     LOG [OrderWorkerService] Received order.process message [messageId: test-duplicate-message-id-002, orderId: cbf9b9f1-7f85-4f8a-ad98-9c17534a5a0a, attempt: 1]
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 4:04:26 PM   DEBUG [TypeORM] Query: START TRANSACTION
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 4:04:26 PM   DEBUG [TypeORM] Query: SELECT "ProcessedMessage"."created_at" AS "ProcessedMessage_created_at", "ProcessedMessage"."id" AS "ProcessedMessage_id", "ProcessedMessage"."idempotency_key" AS "ProcessedMessage_idempotency_key", "ProcessedMessage"."message_id" AS "ProcessedMessage_message_id", "ProcessedMessage"."order_id" AS "ProcessedMessage_order_id", "ProcessedMessage"."processed_at" AS "ProcessedMessage_processed_at", "ProcessedMessage"."scope" AS "ProcessedMessage_scope" FROM "processed_messages" "ProcessedMessage" WHERE (("ProcessedMessage"."message_id" = $1)) LIMIT 1 -- Parameters: ["test-duplicate-message-id-002"]
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 4:04:26 PM    WARN [OrdersService] Message [messageId: test-duplicate-message-id-002] already processed, skipping
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 4:04:26 PM   DEBUG [TypeORM] Query: COMMIT
rd_shop_dev-app         | [Nest] 37  - 03/04/2026, 4:04:26 PM     LOG [OrderWorkerService] [result: success] Acked message [messageId: test-duplicate-message-id-002, orderId: cbf9b9f1-7f85-4f8a-ad98-9c17534a5a0a, attempt: 1] processed successfully

```

---

## 6. Related Documentation

- **RabbitMQ Service**: [`src/rabbitmq/rabbitmq.service.ts`](src/rabbitmq/rabbitmq.service.ts)
- **Order Worker**: [`src/orders-worker/orders-worker.service.ts`](src/orders-worker/orders-worker.service.ts)
- **Orders Service**: [`src/orders/orders.service.ts`](src/orders/orders.service.ts)
- **ProcessedMessage Entity**: [`src/rabbitmq/processed-message.entity.ts`](src/rabbitmq/processed-message.entity.ts)
- **Migration**: [`src/db/migrations/1772559693984-AddProcessedMessage.ts`](src/db/migrations/1772559693984-AddProcessedMessage.ts)
