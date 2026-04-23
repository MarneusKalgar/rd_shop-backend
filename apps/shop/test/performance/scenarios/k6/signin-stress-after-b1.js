/**
 * k6 load test — Signin / bcrypt Saturation Stress — AFTER B1
 *
 * Identical scenario to signin-stress.js (baseline).
 * B1 fix: switched from native `bcrypt` to `bcryptjs` — pure JS, non-blocking,
 * cooperative yielding prevents event loop saturation.
 *
 * Expected improvement: p95 signin latency drops from ~12 000 ms → <1 000 ms
 * at 10 VUs because bcryptjs yields to the event loop between rounds, allowing
 * other requests to be served concurrently instead of queuing behind a blocked
 * thread pool.
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
 *   npm run perf:after:signin     (from apps/shop/)
 *
 * Thresholds (after B1):
 *   p(95) < 1000ms  — bcryptjs non-blocking; event loop no longer saturated
 *   http_req_failed < 1%
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
    // After B1: bcryptjs is non-blocking. 10 VUs on 0.5 CPU → p95 well under 1s.
    // Baseline was p(95)<12000 with native bcrypt.
    'http_req_duration{name:auth_signin}': ['p(95)<1000', 'p(99)<7000'],
    custom_error_rate: ['rate<0.01'],
  },
  tags: { test_type: 'signin_stress_after_b1' },
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

  sleep(0.1);
}
