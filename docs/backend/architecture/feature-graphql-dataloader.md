# rd_shop — GraphQL & DataLoader

## Setup

- Code-first Apollo Server v5 (`@nestjs/graphql` + `@nestjs/apollo`)
- Auto schema generation (`autoSchemaFile: true`)
- Path: `/graphql`; introspection + GraphiQL disabled in production
- Auth: `GqlJwtAuthGuard` on resolvers; user from Bearer token

## Resolvers

`apps/shop/src/graphql/resolvers/`

| Resolver            | Key queries/mutations                                  |
| ------------------- | ------------------------------------------------------ |
| `UsersResolver`     | user queries                                           |
| `OrdersResolver`    | `orders(pagination)` — cursor-paginated, JWT-protected |
| `OrderItemResolver` | nested type resolver for OrderItem under Order         |

## Cursor pagination (orders)

- Input: `OrdersPaginationInput { limit, cursor? }`
- Output: `{ nodes: Order[], pageInfo: { hasNextPage, nextCursor } }`
- Implementation: Postgres-specific SQL (`date_trunc`, composite ORDER BY, ILIKE, enums)
- Cursor is opaque base64 token encoding `(createdAt, id)`

## DataLoaders

`apps/shop/src/graphql/loaders/` — all `Scope.REQUEST` (per-request instances)

| Loader            | Batches                       |
| ----------------- | ----------------------------- |
| `ProductLoader`   | `productId[]` → `Product[]`   |
| `UserLoader`      | `userId[]` → `User[]`         |
| `OrderLoader`     | `orderId[]` → `Order[]`       |
| `OrderItemLoader` | `orderId[]` → `OrderItem[][]` |

Pattern: collect IDs within a tick → single `findByIds` query → map back to original order.  
Result: 90% query reduction on nested GraphQL queries (N+1 eliminated).

## Schemas

`apps/shop/src/graphql/schemas/` — ObjectType classes for User, Order, OrderItem, Product

## Files ↔ Products

`Product.mainImage` field resolved via its own presigned URL; `FileRecord.status` must be `READY`.
