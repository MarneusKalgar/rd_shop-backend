# rd_shop — Orders Querying

## REST endpoints — all scoped to the authenticated user

| Endpoint                                    | Guard                      | Scope          | Returns                      |
| ------------------------------------------- | -------------------------- | -------------- | ---------------------------- |
| `GET /api/v1/orders`                        | JwtAuthGuard + ScopesGuard | `orders:read`  | Paginated list, with filters |
| `GET /api/v1/orders/:orderId`               | JwtAuthGuard + ScopesGuard | `orders:read`  | Single order + relations     |
| `GET /api/v1/orders/:orderId/payment`       | JwtAuthGuard + ScopesGuard | `orders:read`  | Payment status via gRPC      |
| `POST /api/v1/orders/:orderId/cancellation` | JwtAuthGuard + ScopesGuard | `orders:write` | Cancelled order              |

**Ownership:** All service methods call `assertOrderOwnership(order, userId)` — 404 if `order.userId ≠ req.user.sub`.

## GET /api/v1/orders — filters & pagination

**DTO:** `FindOrdersFilterDto`

| Field         | Type               | SQL operation                                                  | Default |
| ------------- | ------------------ | -------------------------------------------------------------- | ------- |
| `cursor`      | UUID               | Keyset: `(createdAt, id) <` cursor position                    | none    |
| `limit`       | Int, 1–50          | `LIMIT` on subquery                                            | 10      |
| `status`      | `OrderStatus` enum | `=`                                                            | none    |
| `startDate`   | ISO Date           | `createdAt >=`                                                 | none    |
| `endDate`     | ISO Date           | `createdAt <=`                                                 | none    |
| `productName` | string             | `product.title ILIKE %value%` — requires INNER JOIN + GROUP BY | none    |

**Cursor encoding:** plain UUID string of the last order's `id` (not base64).  
**Sort:** `DESC createdAt`, `DESC id` (tiebreaker).

## Two-query split (query optimization)

To avoid `LIMIT` applying to cross-joined rows, the query builder uses two stages:

```
Subquery:  SELECT DISTINCT order.id, order.createdAt
             FROM orders
             [INNER JOIN order_items → products]  ← only if productName filter
             WHERE userId = ? [+ filters + cursor]
             ORDER BY createdAt DESC, id DESC
             LIMIT :limit + 1

Main query: SELECT order.*, items.*, products.*
              FROM orders
              LEFT JOIN order_items ON ...
              LEFT JOIN products ON ...
              WHERE order.id IN (subquery IDs)
              ORDER BY createdAt DESC, id DESC
```

**User JOIN optimization:** REST endpoints pass `{ withUser: false }` to `buildMainQuery`, skipping the `LEFT JOIN users`. The `user` relation is only loaded for GraphQL (where `UserLoader` resolves it).

`limit + 1` trick: fetch one extra row to determine `hasNextPage`; strip it from response.

## GET /api/v1/orders/:orderId

Loads order via `findByIdWithItemRelations` — joins `items` and `items.product` only (no user).  
Returns `GetOrderByIdResponseDto { data: Order }`.

## GET /api/v1/orders/:orderId/payment

1. Load order, assert ownership
2. `BadRequestException` if `order.paymentId` is null (never authorized)
3. `PaymentsGrpcService.getPaymentStatus(order.paymentId)` — gRPC call
4. Returns `{ data: { paymentId, status } }`

gRPC timeout: `PAYMENTS_GRPC_TIMEOUT_MS` (default 5s).  
Error mapping: NOT_FOUND→404, INVALID_ARGUMENT→400, ALREADY_EXISTS→409, UNAVAILABLE→503, DEADLINE_EXCEEDED→504.

## GraphQL — `orders` query

**Module:** `apps/shop/src/graphql/`  
**Guard:** `GqlJwtAuthGuard` on resolver.

```graphql
query {
  orders(
    filter: { status: PAID, startDate: "...", endDate: "..." }
    pagination: { limit: 10, cursor: "<uuid>" }
  ) {
    nodes {
      id
      status
      createdAt
      items {
        productId
        quantity
        priceAtPurchase
        product {
          title
          price
        }
      }
      user {
        email
      }
    }
    pageInfo {
      hasNextPage
      nextCursor
    }
  }
}
```

Calls the same `OrdersService.findOrdersWithFilters()` as REST — identical filtering logic.

GraphQL does **not** expose a separate payment status query; only `paymentId` on the order itself.

## DataLoaders used by GraphQL orders

| Loader                      | Batches                       | Scope                            |
| --------------------------- | ----------------------------- | -------------------------------- |
| `OrderItemLoader.byOrderId` | `orderId[]` → `OrderItem[][]` | REQUEST                          |
| `UserLoader.byId`           | `userId[]` → `User[]`         | REQUEST                          |
| `ProductLoader`             | `productId[]` → `Product[]`   | REQUEST (via OrderItem resolver) |

## Input types (GraphQL)

```typescript
OrdersFilterInput     { status?, startDate?, endDate? }
OrdersPaginationInput { cursor?: UUID, limit?: Int (default 10, min 1, max 50) }
```

## Response types (GraphQL)

```typescript
OrderType       { id, userId, status, idempotencyKey?, items, user, createdAt, updatedAt }
OrdersConnection { nodes: OrderType[], pageInfo: PageInfo, totalCount?: Int }  // totalCount: TODO
PageInfo         { hasNextPage: Boolean, nextCursor?: String }
OrderItemType   { id, orderId, productId, quantity, priceAtPurchase, product, order }
```
