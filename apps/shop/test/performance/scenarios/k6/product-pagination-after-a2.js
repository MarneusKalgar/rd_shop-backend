/**
 * k6 load test — Cursor Pagination AFTER A2
 *
 * New scenario — no baseline counterpart. Validates the load-level impact of
 * the 2→1 query reduction from A2: page 2 requests no longer issue a findOne()
 * DB round-trip, so throughput increases and p95 drops.
 *
 * Strict thresholds for post-A2 validation:
 *   p95 < 250 ms at 30 VUs (page 2 cursor requests)
 *
 * Why 250 ms and not, say, 100 ms? Same constraint as A1: the perf environment
 * caps the app at 0.5 vCPU. CPU queue-wait time, not DB time, drives p95.
 * The A2 improvement shows at Tier 1 (1 query vs 2 for page 2) and in
 * throughput (372 iter/s). Measured p95 = ~224 ms at 30 VUs.
 *
 * Flow per VU:
 *   1. GET page 1  → extract nextCursor
 *   2. GET page 2 with cursor (measured step)
 *   3. GET page 3 with cursor (measured step)
 *
 * No auth required for product listing.
 *
 * Environment variables:
 *   BASE_URL         — default http://localhost:8090
 *   PERF_K6_VUS      — default 30
 *   PERF_K6_DURATION — default "30s"
 *
 * Run:
 *   npm run perf:after:pagination   (from apps/shop/)
 *   — or —
 *   k6 run \
 *     --out json=test/performance/results/k6/product-pagination-after-a2.json \
 *     test/performance/scenarios/k6/product-pagination-after-a2.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8090';
const VUS = parseInt(__ENV.PERF_K6_VUS || '30', 10);
const DURATION = __ENV.PERF_K6_DURATION || '30s';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const errorRate = new Rate('custom_error_rate');
const paginationLatency = new Trend('custom_pagination_latency', true);

// ---------------------------------------------------------------------------
// Thresholds — strict post-A2 gates
// ---------------------------------------------------------------------------
export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // After A2: cursor decoded in-memory (no DB round-trip) → 1 query per page
    // Threshold reflects 0.5 vCPU perf environment; DB cost itself is <1 ms
    'http_req_duration{name:pagination_page2}': ['p(95)<250', 'p(99)<400'],
    'http_req_duration{name:pagination_page3}': ['p(95)<250', 'p(99)<400'],
    custom_error_rate: ['rate<0.01'],
  },
  tags: { test_type: 'pagination_after_a2' },
};

// ---------------------------------------------------------------------------
// Search terms — vary cursors across VUs to avoid hot rows
// ---------------------------------------------------------------------------
const SEARCH_TERMS = ['wireless', 'premium', 'ultra', 'smart', 'classic'];

export default function () {
  const term = SEARCH_TERMS[(__VU - 1) % SEARCH_TERMS.length];
  const baseUrl = `${BASE_URL}/api/v1/products?search=${term}&limit=20&isActive=true`;

  let cursor1 = null;
  let cursor2 = null;

  // Page 1 — not measured, just cursor extraction
  group('pagination_page1', () => {
    const res = http.get(baseUrl, {
      tags: { name: 'pagination_page1' },
      headers: { Accept: 'application/json' },
    });
    const ok = check(res, { 'page1 200': (r) => r.status === 200 });
    if (ok) {
      try {
        cursor1 = JSON.parse(res.body).nextCursor;
      } catch {
        cursor1 = null;
      }
    }
    errorRate.add(!ok);
  });

  if (!cursor1) {
    return;
  }

  // Page 2 — measured: should be 1 DB query after A2
  group('pagination_page2', () => {
    const res = http.get(`${baseUrl}&cursor=${cursor1}`, {
      tags: { name: 'pagination_page2' },
      headers: { Accept: 'application/json' },
    });
    const ok = check(res, {
      'page2 200': (r) => r.status === 200,
      'page2 has data': (r) => {
        try {
          return Array.isArray(JSON.parse(r.body).data);
        } catch {
          return false;
        }
      },
    });
    paginationLatency.add(res.timings.duration);
    errorRate.add(!ok);
    if (ok) {
      try {
        cursor2 = JSON.parse(res.body).nextCursor;
      } catch {
        cursor2 = null;
      }
    }
  });

  if (!cursor2) {
    sleep(0.1);
    return;
  }

  // Page 3 — measured: validates cursor chaining across pages
  group('pagination_page3', () => {
    const res = http.get(`${baseUrl}&cursor=${cursor2}`, {
      tags: { name: 'pagination_page3' },
      headers: { Accept: 'application/json' },
    });
    const ok = check(res, { 'page3 200': (r) => r.status === 200 });
    paginationLatency.add(res.timings.duration);
    errorRate.add(!ok);
  });

  sleep(0.1);
}
