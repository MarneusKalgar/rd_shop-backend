/**
 * k6 load test — Product Search
 *
 * Scenario: steady-state read load against GET /api/v1/products
 * Baseline target: p95 < 200 ms at 50 VUs with 10 K seeded products.
 *
 * Environment variables (pass with -e or via OS env):
 *   BASE_URL      — default http://localhost:8090
 *   PERF_K6_VUS   — number of virtual users (default 50)
 *   PERF_K6_DURATION — test duration string (default "30s")
 *
 * Run:
 *   k6 run \
 *     --out json=test/performance/results/k6/product-search.json \
 *     test/performance/scenarios/k6/product-search.js
 *
 * Baseline thresholds (pre-optimisation):
 *   http_req_duration{p(95)} < 500ms   (p95 before indexes; relaxed)
 *   http_req_failed             < 1%
 * Post-A1 thresholds:
 *   http_req_duration{p(95)} < 50ms    (with covering index)
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8090';
const VUS = parseInt(__ENV.PERF_K6_VUS || '50', 10);
const DURATION = __ENV.PERF_K6_DURATION || '30s';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const errorRate = new Rate('custom_error_rate');
const searchLatency = new Trend('custom_search_latency', true);

// ---------------------------------------------------------------------------
// Thresholds (baseline — relaxed for pre-optimisation measurement)
// ---------------------------------------------------------------------------
export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    // Keep overall HTTP error rate low; latency thresholds inform optimisations
    http_req_failed: ['rate<0.01'],
    // Baseline: relax to 500 ms p95 before any indexes
    // After A1 (covering index on products): tighten to 50 ms
    'http_req_duration{name:product_search}': ['p(95)<500', 'p(99)<1000'],
    custom_error_rate: ['rate<0.01'],
  },
  tags: { test_type: 'product_search' },
};

// ---------------------------------------------------------------------------
// Search terms drawn from the seed adjective pool
// ---------------------------------------------------------------------------
const SEARCH_TERMS = [
  'wireless',
  'premium',
  'ultra',
  'smart',
  'classic',
  'pro',
  'digital',
  'compact',
  'advanced',
  'eco',
];

export default function () {
  const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];

  group('product_search', () => {
    // First page
    const page1 = http.get(`${BASE_URL}/api/v1/products?search=${term}&limit=20&isActive=true`, {
      tags: { name: 'product_search' },
      headers: { Accept: 'application/json' },
    });

    const ok1 = check(page1, {
      'page1 status 200': (r) => r.status === 200,
      'page1 has items': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body.data);
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!ok1);
    searchLatency.add(page1.timings.duration);

    // Cursor pagination — page 2 (only when page 1 returned a nextCursor)
    if (ok1) {
      let cursor;
      try {
        cursor = JSON.parse(page1.body).nextCursor;
      } catch {
        cursor = null;
      }

      if (cursor) {
        const page2 = http.get(
          `${BASE_URL}/api/v1/products?search=${term}&limit=20&isActive=true&cursor=${cursor}`,
          {
            tags: { name: 'product_search' },
            headers: { Accept: 'application/json' },
          },
        );
        check(page2, { 'page2 status 200': (r) => r.status === 200 });
        searchLatency.add(page2.timings.duration);
      }
    }
  });

  sleep(0.1);
}
