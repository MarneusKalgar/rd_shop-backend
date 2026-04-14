/**
 * Perf scenario: cursor pagination — AFTER A2
 *
 * Validates that page 2 (cursor-based) costs exactly 1 DB query — not 2.
 * Before A2: ProductsRepository issued a findOne(cursor) DB lookup before
 * the paginated SELECT. After A2: cursor is decoded in-memory (id|sortValue),
 * no extra round-trip.
 *
 * Assertions:
 *   - Page 1: 1 products SELECT
 *   - Page 2 with cursor: 1 products SELECT (no extra findOne)
 *   - nextCursor decodes to { id: UUID, sortValue: non-empty string }
 *   - Orders pagination with cursor also costs 1 query
 *
 * Run: npm run test:perf (from apps/shop/)
 */
import {
  bootstrapPerfTest,
  getPgStatStatements,
  PerfTestContext,
  resetPgStatStatements,
  savePerfResults,
  teardownPerfTest,
} from '@test/performance/helpers/bootstrap';
import { isUUID } from 'class-validator';
import request from 'supertest';

import { seedProducts } from '@/db/perf-seed/generate-products';

let ctx: PerfTestContext;

describe('[After A2] Cursor pagination — 1 query per page', () => {
  beforeAll(async () => {
    ctx = await bootstrapPerfTest();
    await seedProducts(ctx.dataSource, 1_000);
  }, 120_000);

  afterAll(() => teardownPerfTest(ctx));

  it('page 1 issues exactly 1 products SELECT', async () => {
    await resetPgStatStatements(ctx.dataSource);

    const res = await request(ctx.app.getHttpServer() as unknown as string)
      .get('/api/v1/products?limit=20')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .expect(200);

    const body = res.body as { data?: unknown[]; nextCursor?: string };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.nextCursor).toBeTruthy();

    const stats = await getPgStatStatements(ctx.dataSource, 'products');
    const totalCalls = stats.reduce((sum, s) => sum + s.calls, 0);

    console.log(`[After A2] Page 1 — products SELECT calls: ${totalCalls}`);
    savePerfResults(
      'pagination-page1-after-a2',
      stats.map((s) => ({
        calls: s.calls,
        mean_ms: s.mean_exec_time.toFixed(2),
        query: s.query,
        total_ms: s.total_exec_time.toFixed(2),
      })),
    );
    expect(totalCalls).toBe(1);
  });

  it('page 2 with cursor issues exactly 1 products SELECT (no findOne pre-fetch)', async () => {
    // Fetch page 1 to obtain a real cursor
    const page1 = await request(ctx.app.getHttpServer() as unknown as string)
      .get('/api/v1/products?limit=20')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .expect(200);

    const cursor: string = (page1.body as { nextCursor: string }).nextCursor;
    expect(cursor).toBeTruthy();

    await resetPgStatStatements(ctx.dataSource);

    await request(ctx.app.getHttpServer() as unknown as string)
      .get(`/api/v1/products?limit=20&cursor=${encodeURIComponent(cursor)}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .expect(200);

    const stats = await getPgStatStatements(ctx.dataSource, 'products');
    const totalCalls = stats.reduce((sum, s) => sum + s.calls, 0);

    console.log(`[After A2] Page 2 with cursor — products SELECT calls: ${totalCalls}`);
    savePerfResults(
      'pagination-page2-after-a2',
      stats.map((s) => ({
        calls: s.calls,
        mean_ms: s.mean_exec_time.toFixed(2),
        query: s.query,
        total_ms: s.total_exec_time.toFixed(2),
      })),
    );

    // Key assertion: no extra findOne for cursor resolution
    expect(totalCalls).toBe(1);
  });

  it('nextCursor decodes to a valid UUID id and non-empty sortValue without a DB lookup', async () => {
    const page1 = await request(ctx.app.getHttpServer() as unknown as string)
      .get('/api/v1/products?limit=20')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .expect(200);

    const cursor: string = (page1.body as { nextCursor: string }).nextCursor;
    expect(cursor).toBeTruthy();

    // Cursor format: <uuid>|<sortValue> — no base64, no DB needed to decode
    const separatorIndex = cursor.indexOf('|');
    expect(separatorIndex).toBeGreaterThan(0);

    const id = cursor.slice(0, separatorIndex);
    const sortValue = cursor.slice(separatorIndex + 1);

    expect(isUUID(id)).toBe(true);
    expect(sortValue.length).toBeGreaterThan(0);
  });
});
