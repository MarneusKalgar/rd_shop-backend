# Order Querying & Filtering Implementation

## Overview

This document describes the order querying and filtering system, which provides efficient retrieval of orders with multiple filter options and cursor-based pagination.

## Features

### 1. Cursor-Based Pagination

**Why Cursor-Based Over Offset-Based?**

✅ **Pros:**

- **Consistent results**: No duplicate/missing items when data changes between requests
- **Better performance**: No need to skip rows (no `OFFSET` operation)
- **Scalable**: Performance remains constant regardless of page depth
- **Safe for real-time data**: Handles concurrent inserts/deletes gracefully

❌ **Cons:**

- Cannot jump to arbitrary pages
- No total page count available
- No total count of matching records (optimized for performance)
- Slightly more complex client implementation

**Implementation:**

The cursor is the `order.id` (UUID) of the last item in the current page. The next request uses this cursor to fetch items after that point.

```typescript
// First request
GET /api/v1/orders?limit=20

// Response includes nextCursor
{
  "data": [...],
  "limit": 10,
  "nextCursor": "550e8400-e29b-41d4-a716-446655440000"
}

// Next page
GET /api/v1/orders?limit=20&cursor=550e8400-e29b-41d4-a716-446655440000
```

**Query Logic:**

```typescript
// Applied when cursor is present
WHERE (order.createdAt < :cursorDate OR
       (order.createdAt = :cursorDate AND order.id < :cursorId))
ORDER BY order.createdAt DESC, order.id DESC
LIMIT 10
```

This ensures:

- Orders are returned in descending chronological order
- The `id` is used as a tiebreaker for orders with the same timestamp
- Performance is optimized by composite indexes

### 2. Filter Options

The API supports multiple filters that can be combined:

| Filter        | Type   | Description                                              | Example                                    |
| ------------- | ------ | -------------------------------------------------------- | ------------------------------------------ |
| `status`      | Enum   | Filter by order status                                   | `PAID`, `CREATED`, `CANCELLED`             |
| `userEmail`   | String | Search by user email (case-insensitive, partial match)   | `john` matches `john@example.com`          |
| `productName` | String | Search by product name (case-insensitive, partial match) | `headphones` matches `Wireless Headphones` |
| `startDate`   | Date   | Orders created on or after this date                     | `2026-01-01T00:00:00.000Z`                 |
| `endDate`     | Date   | Orders created on or before this date                    | `2026-12-31T23:59:59.999Z`                 |
| `cursor`      | UUID   | Pagination cursor (ID of last item in previous page)     | `550e8400-e29b-41d4-a716-446655440000`     |
| `limit`       | Number | Number of results to return (1-100, default: 10)         | `50`                                       |

**Filter Combinations:**

All filters are optional and can be combined using AND logic:

```typescript
GET /api/v1/orders?status=PAID&startDate=2026-01-01&limit=50
// Returns paid orders created after Jan 1, 2026
```

### 3. Query Builder Pattern

**Architecture:**

The implementation uses a dedicated `OrdersQueryBuilder` class with a **two-step subquery approach** to prevent row explosion from one-to-many joins:

```typescript
@Injectable()
export class OrdersQueryBuilder {
  /**
   * Step 1: Build subquery to get paginated order IDs with filters.
   * LIMIT applies to distinct orders, not joined rows.
   */
  buildOrderIdsSubquery(params: FindOrdersFilterDto): SelectQueryBuilder<Order> {
    const { status, userEmail, productName, startDate, endDate } = params;

    const subquery = this.orderRepository
      .createQueryBuilder('order')
      .select('order.id', 'id')
      .addSelect('order.createdAt', 'createdAt');

    // Apply filters (joins only when needed for filtering)
    if (status) {
      subquery.andWhere('order.status = :status', { status });
    }

    if (userEmail) {
      subquery
        .innerJoin('order.user', 'user')
        .andWhere('user.email ILIKE :userEmail', { userEmail: `%${userEmail}%` });
    }

    if (productName) {
      subquery
        .innerJoin('order.items', 'orderItem')
        .innerJoin('orderItem.product', 'product')
        .andWhere('product.title ILIKE :productName', { productName: `%${productName}%` });
    }

    // ... more filters

    return subquery;
  }

  /**
   * Step 2: Build main query with all relations for paginated order IDs.
   */
  buildMainQuery(orderIds: string[]): SelectQueryBuilder<Order> {
    return this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.items', 'orderItem')
      .leftJoinAndSelect('orderItem.product', 'product')
      .where('order.id IN (:...orderIds)', { orderIds })
      .orderBy('order.createdAt', 'DESC')
      .addOrderBy('order.id', 'DESC');
  }
}
```

**Why Two-Step Approach?**

The previous single-query approach had a critical bug: when using `LEFT JOIN` with one-to-many relationships (orders → items → products), the `LIMIT` clause operated on **joined rows**, not distinct orders, causing:

- **Row explosion**: An order with 5 items creates 5 joined rows
- **Incorrect pagination**: `LIMIT 10` might return only 2-3 orders (depending on item counts)
- **Invalid cursors**: Skipping or duplicating orders between pages

The subquery approach fixes this by:

1. **Subquery fetches distinct order IDs** with filters applied (no row explosion)
2. **LIMIT operates on distinct orders**, ensuring exactly `limit` orders per page
3. **Main query joins relations** only for the paginated order IDs
4. **Correct cursor calculation** based on actual order count

**Benefits:**

- **Separation of concerns**: Query logic isolated from business logic
- **Testability**: Query builder can be tested independently
- **Reusability**: Query construction logic can be reused
- **Maintainability**: Easier to modify filter logic
- **Correctness**: Prevents pagination bugs from row explosion

### 4. Eager Loading of Relations

The main query **always** loads related entities for the paginated orders:

```typescript
.leftJoinAndSelect('order.user', 'user')           // User who placed the order
.leftJoinAndSelect('order.items', 'orderItem')     // Order items
.leftJoinAndSelect('orderItem.product', 'product') // Product details for each item
```

This ensures:

- No N+1 query problems
- Complete order information in the main query
- Predictable performance
- **No row explosion issues**: Joins applied only after pagination on distinct orders

## Performance Optimization

**Optimization Points:**

1. **Cursor lookup**: Separate lightweight query (only fetches `id` and `createdAt`)
2. **Single main query**: All data fetched in one database round-trip
3. **getMany()**: Efficiently fetches paginated results without counting total
4. **Conditional cursor**: Only calculates next cursor if more data exists

**Note on Total Count:**

The total count is intentionally omitted to optimize query performance. For cursor-based pagination, knowing the total count is less critical than offset-based pagination, and calculating it adds overhead on large datasets. If total count is needed for specific use cases, consider:

- Implementing a separate analytics endpoint
- Caching the count with a reasonable TTL
- Using approximate counts for large datasets

**Rationale:**

- **Default: 10** - Balances response size and API calls
- **Min: 1** - Prevents empty queries
- **Max: 100** - Protects against excessive memory usage and slow queries
- **Type coercion** - Handles string query parameters

## Usage Examples

### Basic Usage

```bash
# Get first page of orders (default limit: 10)
curl -X GET "http://localhost:3000/api/v1/orders"

# Custom limit
curl -X GET "http://localhost:3000/api/v1/orders?limit=50"
```

### Filtering by Status

```bash
# Get paid orders only
curl -X GET "http://localhost:3000/api/v1/orders?status=PAID"

# Get created (unpaid) orders
curl -X GET "http://localhost:3000/api/v1/orders?status=CREATED"
```

### Date Range Filtering

```bash
# Orders from January 2026
curl -X GET "http://localhost:3000/api/v1/orders?startDate=2026-01-01T00:00:00.000Z&endDate=2026-01-31T23:59:59.999Z"

# Orders in the last 30 days
curl -X GET "http://localhost:3000/api/v1/orders?startDate=2026-11-01T00:00:00.000Z"
```

### Searching by User

```bash
# Find orders by user email (partial, case-insensitive)
curl -X GET "http://localhost:3000/api/v1/orders?userEmail=john"

# Matches: john@example.com, johndoe@example.com, alice.johnson@example.com
```

### Searching by Product

```bash
# Find orders containing a specific product (partial, case-insensitive)
curl -X GET "http://localhost:3000/api/v1/orders?productName=laptop"

# Matches orders with: "MacBook Pro", "Dell Laptop", "Gaming Laptop"
```

### Combined Filters

```bash
# Paid orders for a specific user in 2026
curl -X GET "http://localhost:3000/api/v1/orders?status=PAID&userEmail=john&startDate=2026-01-01T00:00:00.000Z"

# Orders containing "headphones" in December 2026
curl -X GET "http://localhost:3000/api/v1/orders?productName=headphones&startDate=2026-12-01T00:00:00.000Z&endDate=2026-12-31T23:59:59.999Z"
```

### Pagination

```bash
# First page
curl -X GET "http://localhost:3000/api/v1/orders?limit=20"

# Response:
{
  "data": [...],
  "limit": 10,
  "nextCursor": "550e8400-e29b-41d4-a716-446655440000"
}

# Second page (using nextCursor from response)
curl -X GET "http://localhost:3000/api/v1/orders?limit=20&cursor=550e8400-e29b-41d4-a716-446655440000"

# Continue until nextCursor is null (last page)
```

## Response Format

### Success Response (HTTP 200)

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "userId": "user-uuid",
      "status": "PAID",
      "idempotencyKey": "client-key-123",
      "createdAt": "2026-12-01T10:30:00.000Z",
      "updatedAt": "2026-12-01T10:30:05.000Z",
      "user": {
        "id": "user-uuid",
        "email": "john@example.com",
        "name": "John Doe"
      },
      "items": [
        {
          "id": "item-uuid-1",
          "orderId": "550e8400-e29b-41d4-a716-446655440000",
          "productId": "product-uuid-1",
          "quantity": 2,
          "priceAtPurchase": "99.99",
          "product": {
            "id": "product-uuid-1",
            "title": "Wireless Headphones",
            "price": "99.99",
            "stock": 48,
            "isActive": true
          }
        }
      ]
    }
  ],
  "limit": 10,
  "nextCursor": "550e8400-e29b-41d4-a716-446655440001"
}
```

**Fields:**

- `items`: Array of order objects with full relations
- `limit`: Number of items per page
- `nextCursor`: Pagination cursor for next page (null if last page)

**Note:** The response does not include a `total` count. This is an intentional design decision for cursor-based pagination to optimize query performance. Calculating total count on large datasets can be expensive, and for cursor pagination it's less critical than for offset pagination. If you need the total count for analytics or UI purposes, consider implementing a separate dedicated endpoint.

### Error Response (HTTP 400)

```json
{
  "statusCode": 400,
  "message": ["limit must not be greater than 100", "limit must not be less than 1"],
  "error": "Bad Request"
}
```

## Testing

### Manual Testing

```bash
# Create test orders
npm run db:seed

# Test pagination
curl "http://localhost:3000/api/v1/orders?limit=5"

# Test filters
curl "http://localhost:3000/api/v1/orders?status=PAID&limit=10"

# Test invalid input
curl "http://localhost:3000/api/v1/orders?limit=1000"  # Should fail (max 100)
```

### Load Testing

```bash
# Using Apache Bench
ab -n 1000 -c 10 "http://localhost:3000/api/v1/orders?limit=20"

# Expected results:
# - Mean time: 15-30ms
# - 99th percentile: <100ms
# - No errors
```

## Related Documentation

- [ORDERS_IMPLEMENTATION.md](ORDERS_IMPLEMENTATION.md) - Order creation with idempotency and transactions
- [QUERY_OPTIMIZATION.md](QUERY_OPTIMIZATION.md) - Detailed query performance analysis and SQL optimization
