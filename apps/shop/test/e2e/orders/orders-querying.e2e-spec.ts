import {
  addToCartAndCheckout,
  e2eRequest,
  getScenarioUserEmail,
  getScenarioUserPassword,
  resolveE2EProductId,
  signupAndSignin,
  waitForReady,
} from '@test/e2e/helpers';
import { waitForStageValidationRequestInterval } from '@test/e2e/helpers/validation-config';

import { BASE_URL } from './constants';
import { OrderBody, OrdersListBody } from './interfaces';

const SCENARIO_USER_EMAIL = getScenarioUserEmail('orders-query', 'e2e-orders-query@example.com');
const SCENARIO_USER_PASSWORD = getScenarioUserPassword('E2eQueryPass1!');

describe('Order querying (e2e)', () => {
  let token: string;
  let productId: string;
  let orderId1: string;
  let orderId2: string;

  async function getOrdersList(path = '/api/v1/orders') {
    await waitForStageValidationRequestInterval();

    return e2eRequest('get', path).set('Authorization', `Bearer ${token}`).expect(200);
  }

  beforeAll(async () => {
    await waitForReady(`${BASE_URL}/health`);

    const ts = await signupAndSignin(SCENARIO_USER_EMAIL, SCENARIO_USER_PASSWORD);
    token = ts.accessToken;

    productId = await resolveE2EProductId(2);

    const checkout1 = await addToCartAndCheckout(token, productId);
    const checkout2 = await addToCartAndCheckout(token, productId);

    orderId1 = checkout1.orderId;
    orderId2 = checkout2.orderId;
  }, 130_000);

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/v1/orders — list with pagination
  // ──────────────────────────────────────────────────────────────────────────

  describe('GET /api/v1/orders', () => {
    it('includes both created orders', async () => {
      const res = await getOrdersList();

      const { data } = res.body as unknown as OrdersListBody;
      const ids = data.map((o) => o.id);
      expect(ids).toContain(orderId1);
      expect(ids).toContain(orderId2);
    });

    it('respects the limit query param and returns nextCursor when more records exist', async () => {
      const res = await getOrdersList('/api/v1/orders?limit=1');

      const body = res.body as unknown as OrdersListBody;
      expect(body.data).toHaveLength(1);
      expect(body.limit).toBe(1);
      // There are at least 2 orders so a cursor must be present
      expect(body.nextCursor).toBeTruthy();
    });

    it('cursor pagination: second page returns a different order', async () => {
      const firstPageRes = await getOrdersList('/api/v1/orders?limit=1');

      const { data: firstData, nextCursor } = firstPageRes.body as unknown as OrdersListBody;
      expect(nextCursor).toBeTruthy();

      const secondPageRes = await getOrdersList(`/api/v1/orders?limit=1&cursor=${nextCursor!}`);

      const { data: secondData } = secondPageRes.body as unknown as OrdersListBody;
      expect(secondData).toHaveLength(1);
      expect(secondData[0]?.id).not.toBe(firstData[0]?.id);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/v1/orders/:orderId — single order
  // ──────────────────────────────────────────────────────────────────────────

  describe('GET /api/v1/orders/:orderId', () => {
    it('returns the correct order with items', async () => {
      const res = await e2eRequest('get', `/api/v1/orders/${orderId1}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { data } = res.body as unknown as { data: OrderBody };
      expect(data.id).toBe(orderId1);
      expect(data.items.length).toBeGreaterThan(0);
    });

    it('returns 404 for a non-existent order ID', async () => {
      await e2eRequest('get', '/api/v1/orders/00000000-0000-4000-8000-000000000001')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 401 without an auth token', async () => {
      await e2eRequest('get', `/api/v1/orders/${orderId1}`).expect(401);
    });
  });

  afterAll(async () => {
    for (const id of [orderId1, orderId2]) {
      await e2eRequest('post', `/api/v1/orders/${id}/cancellation`)
        .set('Authorization', `Bearer ${token}`)
        .catch(() => undefined);
    }
  });
});
