# rd_shop — gRPC / Payments

## Services

- **payments-service** (`apps/payments/`) — standalone gRPC server, port 5001, gRPC only
- **shop-service** (`apps/shop/src/payments/`) — gRPC client connecting to payments-service

## Proto contract

**Source of truth:** `proto/payments.proto` (repo root)  
**Build copy:** `nest-cli.json` assets → copied to `dist/apps/*/proto/` on `nest build`  
**Runtime path (shop client):** `join(__dirname, '../proto/payments.proto')` (relative to dist)  
**Runtime path (payments server):** `join(__dirname, 'proto/payments.proto')`  
**On CI:** `apps/shop/src/proto/` is gitignored (build artifact) — must mock all consumers

## Proto methods

| RPC                                                                    | Status                        |
| ---------------------------------------------------------------------- | ----------------------------- |
| `Authorize(AuthorizeRequest) → AuthorizeResponse`                      | Implemented                   |
| `GetPaymentStatus(GetPaymentStatusRequest) → GetPaymentStatusResponse` | Implemented                   |
| `Ping(PingRequest) → PingResponse`                                     | Implemented (DB health check) |
| `Capture` / `Refund`                                                   | Stubs only                    |

## Shop-side: PaymentsGrpcModule

`apps/shop/src/payments/payments-grpc.module.ts`

- Provides `PAYMENTS_GRPC_CLIENT` token via `ClientProxyFactory.create({ transport: Transport.GRPC, ... })`
- Provides `PaymentsGrpcService`
- Exports both

## Shop-side: PaymentsGrpcService

`apps/shop/src/payments/payments-grpc.service.ts`

- `onModuleInit` → `client.getService<PaymentsProtoService>('Payments')`
- `authorize(request)` / `getPaymentStatus(paymentId)` — wrap Observable in `firstValueFrom` + RxJS `timeout(PAYMENTS_GRPC_TIMEOUT_MS)`
- On `TimeoutError` → `GatewayTimeoutException`
- `mapGrpcError()`: NOT_FOUND→404, INVALID_ARGUMENT→400, ALREADY_EXISTS→409, UNAVAILABLE→503

## Payments entity

`apps/payments/src/payment.entity.ts`

- `paymentId` varchar unique (returned to shop)
- `orderId` uuid unique (prevents duplicate authorizations)
- `status` smallint enum: AUTHORIZED=1, CAPTURED=2, REFUNDED=3, FAILED=4, PENDING=5
- `amount` decimal(12,2), `currency` varchar(3)

## Health check involvement

`PaymentsHealthIndicator` (`apps/shop/src/health/indicators/payments.health.ts`):

- Injects `PAYMENTS_GRPC_CLIENT`
- `onModuleInit` → calls `client.getService()` (same as `PaymentsGrpcService`)
- `check()` calls gRPC `Ping` — used by `/status` endpoint as soft dependency
- **Must be overridden in integration tests** (same reason as `PaymentsGrpcService`)

## Constants

`PAYMENTS_GRPC_CLIENT` token — `apps/shop/src/payments/constants/index.ts`
