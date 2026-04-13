/**
 * k6 load test — Signin / bcrypt Saturation Stress
 *
 * Measures how many concurrent bcrypt operations the server can sustain
 * before p95 signin latency exceeds acceptable limits.
 *
 * Each VU signs in repeatedly (no token caching) — bcrypt runs every
 * iteration, maximising CPU pressure. This is the B1 baseline: how slow
 * is signin at N VUs with BCRYPT_SALT_ROUNDS=10 on 0.5 CPU?
 *
 * Pre-requisites:
 *   - 100 users seeded with password "Perf@12345"
 *     emails: perf-user-1@test.local … perf-user-100@test.local
 *
 * Environment variables:
 *   BASE_URL          — default http://localhost:8090
 *   PERF_K6_VUS       — default 10
 *   PERF_K6_DURATION  — default "30s"
 *
 * Run:
 *   k6 run \
 *     --out json=test/performance/results/k6/signin-stress-baseline.json \
 *     test/performance/k6/signin-stress.js
 *
 * Baseline thresholds (bcrypt@10, 0.5 CPU, 10 VUs):
 *   p(95) < 12000ms  — bcrypt serialises through thread pool; high but expected
 *   http_req_failed  < 1%
 *
 * After B1 (BCRYPT_SALT_ROUNDS reduced via env var):
 *   Tighten p(95) to 1000ms.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8090';
const VUS = parseInt(__ENV.PERF_K6_VUS || '10', 10);
const DURATION = __ENV.PERF_K6_DURATION || '30s';
const USER_COUNT = 100;
const PASSWORD = 'Perf@12345';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const errorRate = new Rate('custom_error_rate');
const signinLatency = new Trend('custom_signin_latency', true);

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------
export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // Baseline: bcrypt@10 on 0.5 CPU. 10 VUs = 2.5× thread pool depth.
    // After B1 optimisation tighten to 1000ms.
    'http_req_duration{name:auth_signin}': ['p(95)<12000'],
    custom_error_rate: ['rate<0.01'],
  },
  tags: { test_type: 'signin_stress' },
};

export default function () {
  // Distribute VUs across seeded users (1-indexed)
  const userIndex = ((__VU - 1) % USER_COUNT) + 1;
  const email = `perf-user-${userIndex}@test.local`;

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

  signinLatency.add(res.timings.duration);
  errorRate.add(!ok);

  // Small sleep to avoid hammering the endpoint beyond what's realistic
  sleep(0.1);
}
