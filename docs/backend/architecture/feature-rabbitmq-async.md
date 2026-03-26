# rd_shop — RabbitMQ / Async Order Processing

## Queue topology

| Queue            | Type                 | Purpose                                |
| ---------------- | -------------------- | -------------------------------------- |
| `orders.process` | durable              | Main processing queue                  |
| `orders.dlq`     | durable, dead-letter | Terminal queue after retries exhausted |

Constants: `apps/shop/src/rabbitmq/constants/index.ts`  
`MAX_RETRY_ATTEMPTS = 3`, `RETRY_DELAY_MS = 2000` (fixed delay, no exponential backoff)

## Order creation flow

```
POST /api/v1/orders
  → DB transaction: reserve stock (FOR UPDATE lock), create Order (PENDING)
  → publish to orders.process
  → return 201 immediately (non-blocking)
```

## Worker flow (OrderWorkerService)

`apps/shop/src/orders-worker/orders-worker.service.ts`

```
consume orders.process
  → parse OrderProcessMessageDto
  → check ProcessedMessage(messageId) — skip if exists (idempotency)
  → processOrderMessage() in DB transaction
      → update stock, create OrderItems
      → mark order PROCESSED
      → PaymentsGrpcService.authorize() → mark PAID, set paymentId
  → channel.ack(msg) after commit
  → on error: retry (nack + republish) up to 3×
  → on exhaustion: publish to orders.dlq then ack original
```

- `onModuleInit` → subscribe
- `onModuleDestroy` → `cancelConsumer(consumerTag)`

## RabbitMQService

`apps/shop/src/rabbitmq/rabbitmq.service.ts`

- `onModuleInit` — connects AMQP, sets prefetch (`RABBITMQ_PREFETCH_COUNT`), asserts queues
- `onModuleDestroy` — closes channel + connection
- `publish(queue, message, { persistent: true })` — durable messages survive broker restart
- `consume(queue, handler, { noAck: false })` — manual ack always enforced

## Idempotency

`ProcessedMessage` table: unique index on `messageId`.  
Before processing, check if `messageId` exists → skip if so.  
Prevents duplicate processing on redelivery or network replays.

## Integration test mock shape

```typescript
.overrideProvider(RabbitMQService).useValue({
  cancelConsumer: jest.fn().mockResolvedValue(undefined),
  channel: null,
  connection: null,
  consume: jest.fn().mockResolvedValue({ consumerTag: 'test-consumer' }),
  publish: jest.fn(),
})
```
