import {
  bootstrapPerfTest,
  PerfTestContext,
  savePerfResults,
  teardownPerfTest,
} from '@test/performance/helpers/bootstrap';
/**
 * Perf scenario: DB connection pool — A4
 *
 * Validates that DB_POOL_SIZE env var is respected by TypeORM:
 *   1. All 20 concurrent queries eventually complete (pool queues, not rejects)
 *   2. Mid-flight active pg_sleep connections ≤ DB_POOL_SIZE
 *
 * This scenario has no "before" counterpart — A4 is a configuration addition.
 *
 * Why a separate raw pg.Client for monitoring?
 *   The TypeORM DataSource pool is capped at DB_POOL_SIZE (5). If we query
 *   pg_stat_activity through the same pool, all 5 slots are occupied by
 *   pg_sleep — the monitoring query itself would queue indefinitely.
 *   A raw pg.Client opens an extra connection outside the pool, so it never
 *   contends with the load queries.
 *
 * Run: npm run test:perf (from apps/shop/)
 */
import { Client } from 'pg';

let ctx: PerfTestContext;
let originalPoolSize: string | undefined;

describe('[A4] DB connection pool size enforcement', () => {
  beforeAll(async () => {
    // Must be set before bootstrapPerfTest() so AppModule's TypeORM config picks it up.
    // Default in typeORM.ts is 10; without this the pool is 10 and the assertion against 5 fails.
    originalPoolSize = process.env.DB_POOL_SIZE;
    process.env.DB_POOL_SIZE = '5';
    ctx = await bootstrapPerfTest();
  }, 120_000);

  afterAll(() => {
    if (originalPoolSize === undefined) {
      delete process.env.DB_POOL_SIZE;
    } else {
      process.env.DB_POOL_SIZE = originalPoolSize;
    }
    return teardownPerfTest(ctx);
  });

  it('all 20 concurrent queries complete without error (pool queues excess, does not reject)', async () => {
    const CONCURRENT = 20;

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT }, () => ctx.dataSource.query(`SELECT pg_sleep(0.05)`)),
    );

    const failures = results.filter((r) => r.status === 'rejected');
    console.log(`[A4] ${CONCURRENT} concurrent queries — failures: ${failures.length}`);
    savePerfResults('connection-pool-a4', [{ concurrent: CONCURRENT, failures: failures.length }]);

    expect(failures.length).toBe(0);
  });

  it('mid-flight active pg_sleep connections do not exceed DB_POOL_SIZE', async () => {
    const CONCURRENT = 20;
    // pg_sleep(1s) keeps slots occupied long enough to sample reliably
    const SLEEP_SEC = 1;
    const SAMPLE_DELAY_MS = 200;
    const poolSize = parseInt(process.env.DB_POOL_SIZE ?? '5', 10);

    // Raw client outside the TypeORM pool — never competes with the load queries
    const monitor = new Client({ connectionString: ctx.container.getConnectionUri() });
    await monitor.connect();

    // Declared outside try so finally can always drain them
    let queryPromises: Promise<unknown>[] = [];

    try {
      queryPromises = Array.from({ length: CONCURRENT }, () =>
        ctx.dataSource.query(`SELECT pg_sleep(${SLEEP_SEC})`),
      );

      // Wait for pool to be fully saturated
      await new Promise<void>((resolve) => setTimeout(resolve, SAMPLE_DELAY_MS));

      const result = await monitor.query<{ count: string }>(
        `SELECT count(*)::int AS count
         FROM pg_stat_activity
         WHERE state = 'active'
           AND query LIKE '%pg_sleep%'
           AND pid != pg_backend_pid()`,
      );
      const activeCount = parseInt(result.rows[0].count, 10);

      console.log(
        `[A4] Active pg_sleep connections mid-flight: ${activeCount} (pool max: ${poolSize})`,
      );
      savePerfResults('connection-pool-a4-concurrency', [{ activeCount, poolSize }]);

      expect(activeCount).toBeLessThanOrEqual(poolSize);
    } finally {
      // Wait for all queries to finish before closing the monitor and triggering
      // container teardown — prevents "Connection terminated" errors on pg_sleep sessions.
      await Promise.allSettled(queryPromises);
      await monitor.end();
    }
  });
});
