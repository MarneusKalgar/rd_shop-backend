-- ============================================
-- BEFORE OPTIMIZATION TEST
-- Run this BEFORE applying optimized indexes
-- ============================================

-- Clear cache to ensure fair test
SELECT pg_sleep(1);

-- Test Query 1: Filter by status and date 
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, TIMING)
SELECT 
  "order"."id" AS "order_id",
  "order"."created_at" AS "order_created_at",
  "order"."status" AS "order_status",
  "user"."email" AS "user_email",
  "orderItem"."quantity" AS "orderItem_quantity",
  "orderItem"."price_at_purchase" AS "orderItem_price",
  "product"."title" AS "product_title",
  "product"."price" AS "product_price"
FROM "orders" "order"
LEFT JOIN "users" "user" ON "user"."id" = "order"."user_id"
LEFT JOIN "order_items" "orderItem" ON "orderItem"."order_id" = "order"."id"
LEFT JOIN "products" "product" ON "product"."id" = "orderItem"."product_id"
WHERE 
  "order"."status" = 'PAID'
  AND "order"."created_at" >= NOW() - INTERVAL '30 days'
ORDER BY "order"."created_at" DESC
LIMIT 20;

-- Test Query 2: User orders by email + date range (exact match)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, TIMING)
SELECT 
  "order"."id",
  "order"."status",
  "order"."created_at",
  "user"."email",
  COUNT("orderItem"."id") as item_count,
  SUM("orderItem"."quantity") as total_items
FROM "orders" "order"
INNER JOIN "users" "user" ON "user"."id" = "order"."user_id"
LEFT JOIN "order_items" "orderItem" ON "orderItem"."order_id" = "order"."id"
WHERE 
  "user"."email" = 'user1@example.com'
  AND "order"."created_at" >= NOW() - INTERVAL '90 days'
GROUP BY "order"."id", "user"."email"
ORDER BY "order"."created_at" DESC
LIMIT 20;
