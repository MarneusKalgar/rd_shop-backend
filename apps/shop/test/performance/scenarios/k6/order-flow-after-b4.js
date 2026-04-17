/**
 * k6 load test — Complete Order Flow AFTER B4 (conditional relation loading on cancel)
 *
 * B4 splits cancelOrder() into two phases:
 *   Phase 1: status-check SELECT only (no JOIN) — used for early rejection
 *   Phase 2: SELECT with JOIN to items+products — only when cancel proceeds
 *
 * For orders that reach cancellation in PENDING state, phase 2 still runs, but
 * rejected cancels (already CANCELLED / wrong state) now skip the JOIN entirely.
 * Under load this reduces DB read volume and lock contention on the cancel path.
 *
 * Cumulative after both A3 + B4:
 *   order_create p(95) < 3000 ms  (A3 removed re-fetch inside transaction)
 *   order_cancel p(95) <  500 ms  (B4 removed unnecessary JOIN on most cancel paths)
 *
 * Pre-requisites (via compose.perf.yml seed-perf):
 *   - 20 products seeded
 *   - 100 users seeded: perf-user-1@test.local … perf-user-100@test.local / Perf@12345
 *
 * Environment variables:
 *   BASE_URL          — default http://localhost:8090
 *   PERF_K6_VUS       — default 20
 *   PERF_K6_DURATION  — default "30s"
 *
 * Run:
 *   npm run perf:after:orders:b4   (from apps/shop/) — standard order flow, shop-perf (authorize skipped)
 *
 * B3 circuit-breaker runs (reuses this script, different app profile):
 *   npm run perf:grpc-breaker:before — before-state: pre-opossum build, shop-perf-grpc-breaker (stub active, authorize ON)
 *                                      NOTE: cannot be reproduced from the current codebase — opossum is now
 *                                      installed. The before-state data was captured before the circuit breaker
 *                                      was implemented and is preserved in .temp/performance-before.md.
 *   npm run perf:grpc-breaker:after  — after-state: shop-perf-grpc-breaker (stub active, breaker installed, authorize ON)
 *                                      Requires: npm run perf:app:grpc-breaker (uses .env.perf + .env.perf.grpc-breaker overrides)
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
// Thresholds — cumulative A3 + B4 gates
// ---------------------------------------------------------------------------
export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // After A3: one fewer SELECT inside transaction → p(95) tightened from 8000
    'http_req_duration{name:order_create}': ['p(95)<3000', 'p(99)<5000'],
    // After B4: status-check only SELECT on rejected cancel → no JOIN overhead
    // Baseline: p(95)<5000 — After B4: p(95)<500
    'http_req_duration{name:order_cancel}': ['p(95)<500', 'p(99)<2000'],
    custom_error_rate: ['rate<0.01'],
  },
  tags: { test_type: 'order_flow_after_b4' },
};

// ---------------------------------------------------------------------------
// Per-VU state
// ---------------------------------------------------------------------------
let accessToken = null;

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
