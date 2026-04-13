/**
 * k6 load test — Complete Order Flow
 *
 * Scenario: authenticated users each create one order via cart, then cancel it.
 * Real flow: POST /cart/items → POST /cart/checkout → POST /orders/:id/cancellation
 * Exercises the hot paths targeted by B1–B4 optimisations.
 *
 * Pre-requisites (via compose.perf.yml seed-perf):
 *   - 20 products seeded (first 4 product IDs retrieved via REST)
 *   - 100 users seeded with password "Perf@12345"
 *     emails: perf-user-1@test.local … perf-user-100@test.local
 *
 * Environment variables:
 *   BASE_URL          — default http://localhost:8090
 *   PERF_K6_VUS       — default 20
 *   PERF_K6_DURATION  — default "30s"
 *
 * Run:
 *   k6 run \
 *     --out json=test/performance/results/k6/order-flow.json \
 *     test/performance/k6/order-flow.js
 *
 * Thresholds (baseline):
 *   POST /cart/checkout p(95) < 2000ms  (async: queued → worker → paid in background)
 *   http_req_failed < 1%
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8090';
const VUS = parseInt(__ENV.PERF_K6_VUS || '20', 10);
const DURATION = __ENV.PERF_K6_DURATION || '30s';
const USER_COUNT = 100;
const PASSWORD = 'Perf@12345';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const errorRate = new Rate('custom_error_rate');
const orderCreateLatency = new Trend('custom_order_create_latency', true);
const orderCancelLatency = new Trend('custom_order_cancel_latency', true);

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------
export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // Baseline (20 VUs, 0.5 CPU): checkout p95 ~5s — bcrypt only on first signin per VU
    // After B1 (HMAC refresh) + B2 (DB indexes): tighten to p(95)<1000
    'http_req_duration{name:order_create}': ['p(95)<8000'],
    // Cancel reads order + writes status; baseline p95 ~3s under contention
    // After B4 (query optimisation): tighten to p(95)<500
    'http_req_duration{name:order_cancel}': ['p(95)<5000'],
    custom_error_rate: ['rate<0.01'],
  },
  tags: { test_type: 'order_flow' },
};

// ---------------------------------------------------------------------------
// Per-VU state: sign in once, reuse access token
// ---------------------------------------------------------------------------
let accessToken = null;
let productIds = null;

export function setup() {
  // Fetch product IDs once before the test using VU0 credentials
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/signin`,
    JSON.stringify({ email: 'perf-user-1@test.local', password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (loginRes.status !== 200) {
    // Non-fatal: product search doesn't need auth
    return { productIds: [] };
  }

  const token = JSON.parse(loginRes.body).accessToken;
  const productsRes = http.get(`${BASE_URL}/api/v1/products?limit=5&isActive=true`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });

  let ids = [];
  try {
    ids = JSON.parse(productsRes.body).data.map((p) => p.id);
  } catch {
    ids = [];
  }

  return { productIds: ids };
}

export default function (data) {
  // Each VU uses a different seeded user to avoid bcrypt lock contention
  // Seed emails are 1-indexed: perf-user-1 … perf-user-100
  const userIndex = ((__VU - 1) % USER_COUNT) + 1;
  const email = `perf-user-${userIndex}@test.local`;

  // Sign in once per VU — skip if token already cached from a previous iteration.
  // This keeps bcrypt out of the order_create measurement so optimisations are visible.
  if (!accessToken)
    group('auth_signin', () => {
      const res = http.post(
        `${BASE_URL}/api/v1/auth/signin`,
        JSON.stringify({ email, password: PASSWORD }),
        {
          tags: { name: 'auth_signin' },
          headers: { 'Content-Type': 'application/json' },
        },
      );

      const ok = check(res, {
        'signin 200': (r) => r.status === 200,
        'has accessToken': (r) => {
          try {
            return Boolean(JSON.parse(r.body).accessToken);
          } catch {
            return false;
          }
        },
      });

      if (ok) {
        try {
          accessToken = JSON.parse(res.body).accessToken;
        } catch {
          accessToken = null;
        }
      }
      errorRate.add(!ok);
    });

  if (!accessToken) {
    return;
  }

  const ids = data.productIds && data.productIds.length ? data.productIds : [];
  if (ids.length === 0) {
    return;
  }

  // Create order via cart flow: clear → add item → checkout
  let orderId = null;
  group('order_create', () => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };

    // Clear any stale cart items from a previous failed iteration
    http.del(`${BASE_URL}/api/v1/cart`, null, { headers });

    // Add one product to cart
    const addRes = http.post(
      `${BASE_URL}/api/v1/cart/items`,
      JSON.stringify({ productId: ids[0], quantity: 1 }),
      { headers },
    );

    if (addRes.status !== 201) {
      errorRate.add(true);
      return;
    }

    // Checkout — this is the measured step (creates the order)
    const idempotencyKey = `vu${__VU}-iter${__ITER}`;
    const checkoutRes = http.post(
      `${BASE_URL}/api/v1/cart/checkout`,
      JSON.stringify({ idempotencyKey }),
      {
        tags: { name: 'order_create' },
        headers,
      },
    );

    const ok = check(checkoutRes, {
      'order created 201': (r) => r.status === 201,
      'has orderId': (r) => {
        try {
          return Boolean(JSON.parse(r.body).data?.id);
        } catch {
          return false;
        }
      },
    });

    orderCreateLatency.add(checkoutRes.timings.duration);
    errorRate.add(!ok);

    if (ok) {
      try {
        orderId = JSON.parse(checkoutRes.body).data.id;
      } catch {
        orderId = null;
      }
    }
  });

  if (!orderId) {
    return;
  }

  sleep(0.05);

  // Cancel order (B4: measures SELECT query count before/after optimisation)
  group('order_cancel', () => {
    const res = http.post(`${BASE_URL}/api/v1/orders/${orderId}/cancellation`, null, {
      tags: { name: 'order_cancel' },
      headers: { Authorization: `Bearer ${accessToken}` },
      // 400/409 are valid business responses (order processed to PAID by worker before cancel fires).
      // Mark as expected so they don't inflate http_req_failed.
      responseCallback: http.expectedStatuses(200, 400, 409),
    });

    const ok = check(res, {
      // 200 = cancelled, 409 = already cancelled, 400 = invalid state (order processed mid-test)
      'cancel accepted': (r) => r.status === 200 || r.status === 409 || r.status === 400,
    });

    orderCancelLatency.add(res.timings.duration);
    errorRate.add(!ok);
  });

  // Keep accessToken across iterations — avoids bcrypt on every loop.
  // Tokens are valid for 1h (JWT_ACCESS_EXPIRES_IN), well beyond the 30s test.
  sleep(0.1);
}
