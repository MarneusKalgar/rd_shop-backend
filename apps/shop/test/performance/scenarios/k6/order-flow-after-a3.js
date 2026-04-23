/**
 * k6 load test — Complete Order Flow AFTER A3 (remove re-fetch after INSERT)
 *
 * A3 removes the SELECT that re-fetched the order inside the transaction after
 * INSERT. This tightens the row-level lock hold time, reducing contention under
 * concurrent load and lowering p95 checkout latency.
 *
 * Baseline (order-flow.js): order_create p(95) < 8000 ms at 20 VUs
 * After A3:                  order_create p(95) < 3000 ms at 20 VUs
 *
 * Same scenario as order-flow.js — only the thresholds differ.
 *
 * Environment variables:
 *   BASE_URL          — default http://localhost:8090
 *   PERF_K6_VUS       — default 20
 *   PERF_K6_DURATION  — default "30s"
 *
 * Run:
 *   npm run perf:after:orders   (from apps/shop/)
 *   — or —
 *   k6 run \
 *     --out json=test/performance/results/k6/order-flow-after-a3.json \
 *     test/performance/scenarios/k6/order-flow-after-a3.js
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
// Thresholds — tightened post-A3 gates
// ---------------------------------------------------------------------------
export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // After A3: one fewer SELECT inside transaction → shorter lock hold time
    // → less contention under concurrent load → lower p95
    'http_req_duration{name:order_create}': ['p(95)<3000', 'p(99)<5000'],
    // Cancel not affected by A3 — keep same as baseline
    'http_req_duration{name:order_cancel}': ['p(95)<5000', 'p(99)<8000'],
    custom_error_rate: ['rate<0.01'],
  },
  tags: { test_type: 'order_flow_after_a3' },
};

// ---------------------------------------------------------------------------
// Per-VU state
// ---------------------------------------------------------------------------
let accessToken = null;
let productIds = null;

export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/signin`,
    JSON.stringify({ email: 'perf-user-1@test.local', password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (loginRes.status !== 200) {
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
  const userIndex = ((__VU - 1) % USER_COUNT) + 1;
  const email = `perf-user-${userIndex}@test.local`;

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

  let orderId = null;
  group('order_create', () => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };

    http.del(`${BASE_URL}/api/v1/cart`, null, { headers });

    const addRes = http.post(
      `${BASE_URL}/api/v1/cart/items`,
      JSON.stringify({ productId: ids[0], quantity: 1 }),
      { headers },
    );

    if (addRes.status !== 201) {
      errorRate.add(true);
      return;
    }

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

  group('order_cancel', () => {
    const res = http.post(`${BASE_URL}/api/v1/orders/${orderId}/cancellation`, null, {
      tags: { name: 'order_cancel' },
      headers: { Authorization: `Bearer ${accessToken}` },
      responseCallback: http.expectedStatuses(200, 400, 409),
    });

    const ok = check(res, {
      'cancel accepted': (r) => r.status === 200 || r.status === 409 || r.status === 400,
    });

    orderCancelLatency.add(res.timings.duration);
    errorRate.add(!ok);
  });

  sleep(0.1);
}
