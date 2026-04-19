import supertest from 'supertest';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8092';

export interface CartCheckoutResult {
  orderId: string;
  status: string;
}

/**
 * Clears the cart for the given user, adds one item, then checks out.
 * Returns the orderId and the initial order status (normally PENDING).
 */
export async function addToCartAndCheckout(
  token: string,
  productId: string,
  quantity = 1,
  idempotencyKey?: string,
): Promise<CartCheckoutResult> {
  await supertest(BASE_URL)
    .delete('/api/v1/cart')
    .set('Authorization', `Bearer ${token}`)
    .expect(204);

  await supertest(BASE_URL)
    .post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${token}`)
    .send({ productId, quantity })
    .expect(201);

  const checkoutBody: Record<string, unknown> = {};
  if (idempotencyKey !== undefined) {
    checkoutBody.idempotencyKey = idempotencyKey;
  }

  const res = await supertest(BASE_URL)
    .post('/api/v1/cart/checkout')
    .set('Authorization', `Bearer ${token}`)
    .send(checkoutBody)
    .expect(201);

  const { id, status } = (res.body as unknown as { data: { id: string; status: string } }).data;
  return { orderId: id, status };
}
