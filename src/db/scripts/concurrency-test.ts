import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';

config({ path: `.env.${process.env.NODE_ENV}` });

const baseUrl = process.env.API_URL;
const productId = process.env.CONCURRENCY_TEST_PRODUCT_ID;
const userId = process.env.CONCURRENCY_TEST_USER_ID;

if (!baseUrl || !productId || !userId) {
  console.error(
    'API_URL, CONCURRENCY_TEST_PRODUCT_ID, and CONCURRENCY_TEST_USER_ID must be set in env',
  );
  process.exit(1);
}

const requests = Number(process.env.CONCURRENCY_TEST_REQUESTS ?? 30);

async function run() {
  const tasks = Array.from({ length: requests }, async () => {
    const body = {
      idempotencyKey: randomUUID(),
      items: [{ productId, quantity: 1 }],
      userId,
    };

    const res = await fetch(`${baseUrl}/api/v1/orders`, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    return {
      body: await res.text(),
      status: res.status,
    };
  });

  const results = await Promise.all(tasks);
  const ok = results.filter((r) => r.status === 201 || r.status === 200).length;
  const conflicts = results.filter((r) => r.status === 409).length;
  const errors = results.filter((r) => r.status >= 400 && r.status !== 409).length;

  console.log({ conflicts, errors, ok, requests });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
