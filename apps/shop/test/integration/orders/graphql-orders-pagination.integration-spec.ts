/**
 * Integration test: GraphQL orders pagination contract
 *
 * Uses @testcontainers/postgresql to spin up a real Postgres instance so that
 * the cursor-pagination SQL (date_trunc, composite ORDER BY, ILIKE, enums) is
 * exercised against the same dialect as production.
 *
 * Infrastructure mocked out (not under test here):
 *   - RabbitMQService  — overridden with a no-op; AMQP not needed for reads
 */
import { JwtService } from '@nestjs/jwt';
import {
  bootstrapIntegrationTest,
  IntegrationTestContext,
  teardownIntegrationTest,
} from '@test/integration/helpers/bootstrap';
import request from 'supertest';

import { ordersMockData } from './__mock__';

const ORDERS_PAGINATION_QUERY = /* GraphQL */ `
  query Orders($pagination: OrdersPaginationInput) {
    orders(pagination: $pagination) {
      nodes {
        id
      }
      pageInfo {
        hasNextPage
        nextCursor
      }
    }
  }
`;

interface GraphQLOrdersResponse {
  data: { orders: OrdersPage };
  errors?: unknown[];
}

interface OrdersPage {
  nodes: { id: string }[];
  pageInfo: { hasNextPage: boolean; nextCursor: null | string };
}

function gqlRequest(variables: Record<string, unknown>) {
  return request(ctx.httpServer)
    .post('/graphql')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ query: ORDERS_PAGINATION_QUERY, variables });
}

let ctx: IntegrationTestContext;
let accessToken: string;

describe('GraphQL orders pagination', () => {
  beforeAll(async () => {
    ctx = await bootstrapIntegrationTest();

    // Seed test-specific rows (isolated by TEST.* UUIDs).
    await ctx.dataSource.query(
      `INSERT INTO users (id, email, roles, scopes)
       VALUES ($1, $2, $3::text[], $4::text[])
       ON CONFLICT (id) DO NOTHING`,
      [ordersMockData.userId, 'gql-pagination@test.local', '{user}', '{orders:read}'],
    );

    await ctx.dataSource.query(
      `INSERT INTO products (id, title, price, stock, is_active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [ordersMockData.productId, 'Pagination Test Product', '9.99', 999, true],
    );

    for (let i = 0; i < ordersMockData.orderIds.length; i++) {
      await ctx.dataSource.query(
        `INSERT INTO orders (id, user_id, status)
         VALUES ($1, $2, 'PENDING')
         ON CONFLICT (id) DO NOTHING`,
        [ordersMockData.orderIds[i], ordersMockData.userId],
      );

      await ctx.dataSource.query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase)
         VALUES ($1, $2, $3, 1, '9.99')
         ON CONFLICT (id) DO NOTHING`,
        [ordersMockData.itemIds[i], ordersMockData.orderIds[i], ordersMockData.productId],
      );
    }

    // Sign a token via the same JwtService instance the app uses.
    const jwtService = ctx.app.get(JwtService);
    accessToken = await jwtService.signAsync({
      email: 'gql-pagination@test.local',
      roles: ['user'],
      scopes: ['orders:read'],
      sub: ordersMockData.userId,
    });
  }, 90_000 /* allow 90 s — first Docker pull can take longer on a slow connection */);

  afterAll(async () => {
    try {
      if (ctx?.dataSource) {
        // Remove test rows in FK-safe order.
        await ctx.dataSource.query(`DELETE FROM order_items WHERE id = ANY($1::uuid[])`, [
          ordersMockData.itemIds,
        ]);
        await ctx.dataSource.query(`DELETE FROM orders     WHERE id = ANY($1::uuid[])`, [
          ordersMockData.orderIds,
        ]);
        await ctx.dataSource.query(`DELETE FROM products   WHERE id = $1::uuid`, [
          ordersMockData.productId,
        ]);
        await ctx.dataSource.query(`DELETE FROM users      WHERE id = $1::uuid`, [
          ordersMockData.userId,
        ]);
      }
    } finally {
      await teardownIntegrationTest(ctx);
    }
  });

  describe('first page', () => {
    it('returns non-empty nodes, hasNextPage=true, and a nextCursor when more results exist', async () => {
      // ARRANGE: 6 orders seeded in beforeAll, limit smaller than total

      // ACT
      const response = await gqlRequest({ pagination: { limit: 2 } }).expect(200);

      // ASSERT
      const body = response.body as GraphQLOrdersResponse;
      expect(body.errors).toBeUndefined();
      const { nodes, pageInfo } = body.data.orders;
      expect(nodes).not.toHaveLength(0);
      expect(pageInfo.hasNextPage).toBe(true);
      expect(pageInfo.nextCursor).toBeTruthy();
    });
  });

  describe('cursor navigation', () => {
    // ARRANGE: obtain a cursor from the first page (data-setup step, not the ACT under test)
    let nextCursor: null | string;

    beforeAll(async () => {
      const setupResponse = await gqlRequest({ pagination: { limit: 2 } });
      const setupBody = setupResponse.body as GraphQLOrdersResponse;
      nextCursor = setupBody.data.orders.pageInfo.nextCursor;
      if (!nextCursor) throw new Error('Setup failure: page 1 must have a nextCursor');
    });

    it('returns non-empty nodes when querying with the nextCursor from a page with hasNextPage=true', async () => {
      // ACT
      const response = await gqlRequest({ pagination: { cursor: nextCursor, limit: 2 } }).expect(
        200,
      );

      // ASSERT
      const body = response.body as GraphQLOrdersResponse;
      expect(body.errors).toBeUndefined();
      expect(body.data.orders.nodes).not.toHaveLength(0);
    });
  });

  describe('last page', () => {
    it('returns nextCursor=null and hasNextPage=false when all results fit on a single page', async () => {
      // ARRANGE: limit exceeds the total number of seeded orders — the response must be the last (and only) page

      // ACT
      const response = await gqlRequest({
        pagination: { limit: ordersMockData.orderIds.length + 1 },
      }).expect(200);

      // ASSERT
      const body = response.body as GraphQLOrdersResponse;
      expect(body.errors).toBeUndefined();
      const { pageInfo } = body.data.orders;
      expect(pageInfo.hasNextPage).toBe(false);
      expect(pageInfo.nextCursor).toBeNull();
    });

    describe('even division: 6 items with limit 2 produces exactly 3 pages', () => {
      // ARRANGE: walk pages 1→2 in beforeAll to obtain the cursor that points at the 3rd (last) page.
      //          Intermediate cursor fetches are setup infrastructure, not the behaviour under test.
      let lastPageCursor: string;

      beforeAll(async () => {
        const page1Response = await gqlRequest({ pagination: { limit: 2 } });
        const page1 = page1Response.body as GraphQLOrdersResponse;
        const cursor1 = page1.data.orders.pageInfo.nextCursor;
        if (!cursor1) throw new Error('Setup failure: page 1 must have a nextCursor');

        const page2Response = await gqlRequest({ pagination: { cursor: cursor1, limit: 2 } });
        const page2 = page2Response.body as GraphQLOrdersResponse;
        const cursor2 = page2.data.orders.pageInfo.nextCursor;
        if (!cursor2) throw new Error('Setup failure: page 2 must have a nextCursor');

        lastPageCursor = cursor2;
      });

      it('returns hasNextPage=false and nextCursor=null on the final page', async () => {
        // ACT
        const response = await gqlRequest({
          pagination: { cursor: lastPageCursor, limit: 2 },
        }).expect(200);

        // ASSERT
        const body = response.body as GraphQLOrdersResponse;
        expect(body.errors).toBeUndefined();
        const { nodes, pageInfo } = body.data.orders;
        expect(nodes).not.toHaveLength(0);
        expect(pageInfo.hasNextPage).toBe(false);
        expect(pageInfo.nextCursor).toBeNull();
      });
    });
  });
});
