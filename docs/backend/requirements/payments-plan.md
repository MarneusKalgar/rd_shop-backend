# Payments — Implementation Plan

## Current state

- **Authorize**: fully implemented — creates `Payment` entity with `status = AUTHORIZED`, idempotent per `orderId`
- **GetPaymentStatus**: fully implemented — fetches by `paymentId`
- **Capture**: proto defined, controller stub (`{ message: 'Capture stub', ok: true }`)
- **Refund**: proto defined, controller stub (`{ message: 'Refund stub', ok: true }`)
- **Ping**: health check via DB ping
- **Void**: not in proto
- Payment entity: `id`, `paymentId`, `orderId` (unique), `amount` (decimal 12,2), `currency`, `status` (smallint enum), timestamps
- `PaymentStatus` enum: `PENDING(5)`, `AUTHORIZED(1)`, `CAPTURED(2)`, `REFUNDED(3)`, `FAILED(4)`
- Shop-side `PaymentsGrpcService`: gRPC client with timeout + error code mapping
- One payment per order (unique constraint on `orderId`)

---

## Phase 1 — Capture implementation

### 1.1 Concept

Capture converts an authorized hold into an actual charge. Two-phase payment flow:

1. **Authorize** — Reserve funds (already done during order processing)
2. **Capture** — Collect the reserved funds (typically after fulfillment/shipping)

### 1.2 Status transition validation

Inline guard clause — not a separate phase. Each method validates the current status before changing it.

```typescript
private validateTransition(current: PaymentStatus, target: PaymentStatus): void {
  const allowed: Record<PaymentStatus, PaymentStatus[]> = {
    [PaymentStatus.PENDING]: [PaymentStatus.AUTHORIZED, PaymentStatus.FAILED],
    [PaymentStatus.AUTHORIZED]: [PaymentStatus.CAPTURED, PaymentStatus.REFUNDED],
    [PaymentStatus.CAPTURED]: [PaymentStatus.REFUNDED],
    [PaymentStatus.REFUNDED]: [],
    [PaymentStatus.FAILED]: [],
  };
  if (!allowed[current]?.includes(target)) {
    throw FAILED_PRECONDITION;
  }
}
```

Called from `authorize()`, `capture()`, and `refund()` — all status changes go through this guard.

### 1.3 Server side (apps/payments)

**`PaymentsService.capture(paymentId: string): Promise<Payment>`**:

1. Find payment by `paymentId` — 404 if not found
2. Validate `status === AUTHORIZED` — error if already captured/refunded/failed
3. Update `status = CAPTURED`
4. Return updated payment

**`PaymentsController.capture(data: CaptureRequest): CaptureResponse`**:

- Calls service, returns `{ paymentId, status }`

### 1.4 Client side (apps/shop)

**`PaymentsGrpcService.capture(paymentId: string): Promise<CaptureResponse>`**:

- Same timeout + error mapping pattern as `authorize()` and `getPaymentStatus()`

### 1.5 REST endpoint

```
POST /api/v1/orders/:orderId/payment/capture
```

Guards: `JwtAuthGuard` + `RolesGuard` (admin only — customers shouldn't capture manually).

Flow: load order → assert `paymentId` exists → call `PaymentsGrpcService.capture(paymentId)` → return response.

### 1.6 Auto-capture option

After authorize succeeds, optionally auto-capture immediately (configurable via env var `PAYMENTS_AUTO_CAPTURE=true`). When enabled, the worker flow becomes: `PENDING → PROCESSED → PAID (authorized + captured)`.

### 1.7 Tasks

- [ ] Implement `validateTransition()` — enforced on all status changes
- [ ] Implement `capture()` in `PaymentsService` with status validation
- [ ] Replace controller stub with real implementation
- [ ] Add `capture()` to `PaymentsGrpcService` (shop-side client)
- [ ] `POST /orders/:orderId/payment/capture` endpoint (admin-only)
- [ ] Optional: auto-capture flag in order worker flow

---

## Phase 2 — Refund implementation (full refund only)

### 2.1 Concept

Full refund only — no partial refund tracking. The existing `amount` field in `RefundRequest` proto is used to pass the full payment amount. No new columns needed on the `Payment` entity.

### 2.2 Server side (apps/payments)

**`PaymentsService.refund(paymentId: string): Promise<Payment>`**:

1. Find payment by `paymentId` — 404 if not found
2. Validate status via `validateTransition(current, REFUNDED)` — only `CAPTURED` or `AUTHORIZED` allowed
3. Update `status = REFUNDED`
4. Return updated payment

### 2.3 Client side (apps/shop)

**REST endpoint:**

```
POST /api/v1/orders/:orderId/payment/refund
```

Guards: `JwtAuthGuard` + `RolesGuard` (admin only).

Tied to order cancellation (Phase 1 of orders-cart plan): when an order with `PAID` status is cancelled, automatically trigger full refund.

### 2.4 Tasks

- [ ] Implement `refund()` in `PaymentsService` with status validation
- [ ] Replace controller stub with real implementation
- [ ] Add `refund()` to `PaymentsGrpcService`
- [ ] `POST /orders/:orderId/payment/refund` endpoint (admin-only)
- [ ] Wire into order cancellation flow (auto-refund on cancel)

---

## Phase 3 — Async payment updates (deferred)

### 3.1 Problem

Current flow is synchronous gRPC. When a real payment provider is integrated, the payment process becomes async:

- Authorization may take time (3D Secure, bank confirmation)
- Capture may be delayed
- Refunds process over days

### 3.2 Approach

**Payment status update queue:**

1. Payments service receives status update from provider (callback/webhook)
2. Publishes to `payments.status-updated` RabbitMQ queue
3. Shop worker consumes message, updates order status accordingly

**Callback endpoint (payments service):**

```
POST /payments/callback
```

- Validate callback authenticity (provider-specific signature/token)
- Map external status → internal `PaymentStatus`
- Publish to queue

### 3.3 Tasks

- [ ] Design callback ingestion endpoint (provider-agnostic interface)
- [ ] RabbitMQ queue for payment status updates
- [ ] Shop-side consumer for payment status changes
- [ ] Order status sync based on payment events
- [ ] Callback authenticity validation

---

## Implementation order

```
Phase 1 (Capture)              ← Replace stub, inline transition validation
  ↓
Phase 2 (Refund)               ← Full refund only, enables order cancellation
  ↓
Phase 3 (Async payments)       ← Deferred — needed when real provider is integrated
```

---

## Testing

Deferred to dedicated testing plan. Key areas to cover:

- Capture from each status (valid + invalid transitions)
- Refund from each status (valid + invalid transitions)
- Transition validation rejects invalid state changes
- Auto-capture flag behavior
- Order cancellation triggers auto-refund
- Authorize → capture → refund full lifecycle
