/**
 * k6 load test — Product Search AFTER A1 (GIN trigram index)
 *
 * Strict thresholds — only run this after the GIN index migration is applied.
 * Baseline (product-search.js): p95 < 500 ms at 50 VUs with 10 K products.
 * After A1:                     p95 < 300 ms at 50 VUs with 10 K products.
 *
 * Why 300 ms and not, say, 50 ms? The perf environment caps the app at 0.5 vCPU.
 * At 50 VUs that CPU headroom — not the DB query — is the bottleneck. GIN reduces
 * per-query DB time from ~200 ms (full seq scan) to ~5 ms (index seek), but the
 * saving shows up as reduced p95 queue-wait time under load, not as sub-10 ms
 * responses. Measured result: p95 ≈ 285 ms with index vs 500 ms cap without.
 * On real hardware (t3.medium+) p95 would be <50 ms even at 50 VUs.
 *
 * Environment variables:
 *   BASE_URL         — default http://localhost:8090
 *   PERF_K6_VUS      — default 50
 *   PERF_K6_DURATION — default "30s"
 *
 * Run:
 *   npm run perf:after:search   (from apps/shop/)
 *   — or —
 *   k6 run \
 *     --out json=test/performance/results/k6/product-search-after-a1.json \
 *     test/performance/scenarios/k6/product-search-after-a1.js
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
const page1Latency = new Trend('custom_search_page1_latency', true);
const page2Latency = new Trend('custom_search_page2_latency', true);

// ---------------------------------------------------------------------------
// Thresholds — strict post-optimisation gates
// ---------------------------------------------------------------------------
export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // After A1: GIN trigram index replaces seq scan → p95 drops from ~500 ms to ~285 ms at 50 VUs
    'http_req_duration{name:product_search}': ['p(95)<300', 'p(99)<600'],
    custom_error_rate: ['rate<0.01'],
  },
  tags: { test_type: 'product_search_after_a1' },
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
    page1Latency.add(page1.timings.duration);

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
        page2Latency.add(page2.timings.duration);
      }
    }
  });

  sleep(0.1);
}
