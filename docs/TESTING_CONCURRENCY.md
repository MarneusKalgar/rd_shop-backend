## Testing Concurrency

### Automated Concurrent Testing (Recommended)

The project includes a dedicated concurrency test script that simulates real concurrent order placement.

#### Setup

1. **Configure environment variables** in [`.env.development`](.env.development):

```bash
# Test Configuration
CONCURRENCY_TEST_PRODUCT_ID=650e8400-e29b-41d4-a716-446655440003  # Gaming Laptop
CONCURRENCY_TEST_USER_ID=550e8400-e29b-41d4-a716-446655440001      # John Doe
CONCURRENCY_TEST_REQUESTS=30                                        # Number of concurrent requests
API_URL=http://localhost:3000                                       # Your API endpoint
```

2. **Ensure the application is running:**

```bash
npm run start:dev
```

````
Example: Gaming Laptop starts with stock of 25.

#### Running the Test

**Basic Test:**

```bash
npm run concurrency:test
````

**Custom Parameters:**

```bash
# Test with 50 concurrent requests
CONCURRENCY_TEST_REQUESTS=50 npm run concurrency:test

# Test different product
CONCURRENCY_TEST_PRODUCT_ID=your-product-uuid npm run concurrency:test
```

#### Understanding Results

The script outputs a summary:

```bash
{
  ok: 15,         # Successful orders (201 Created or 200 OK)
  conflicts: 10,  # Stock exhausted (409 Conflict)
  errors: 0,      # Unexpected errors (500, etc.)
  requests: 25    # Total requests sent
}
```

**Expected Behavior:**

✅ **SUCCESS** - If stock = 25:

- `ok` ≤ 25 (only available stock is sold)
- `conflicts` = requests - ok (remaining requests fail gracefully)
- `errors` = 0 (no crashes or timeouts)
- Final product stock = initial stock - ok

❌ **FAILURE** - If you see:

- `ok` > initial stock (oversell!)
- `errors` > 0 (deadlocks, timeouts, crashes)
- Negative stock in database

#### Verification

**1. Check final stock:**

```sql
SELECT id, title, stock
FROM products
WHERE id = '650e8400-e29b-41d4-a716-446655440003';
```

**2. Count created orders:**

```sql
SELECT COUNT(*)
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE oi.product_id = '650e8400-e29b-41d4-a716-446655440003';
```

**3. Verify consistency:**

```
initial_stock - final_stock = orders_created
```
