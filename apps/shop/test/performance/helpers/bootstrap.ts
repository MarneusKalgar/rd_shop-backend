/**
 * Shared Testcontainers + NestJS bootstrap for performance tests.
 *
 * Usage in each *.perf.ts:
 *
 *   import { bootstrapPerfTest, PerfTestContext, teardownPerfTest } from '@test/performance/helpers/bootstrap';
 *
 *   let ctx: PerfTestContext;
 *
 *   beforeAll(async () => {
 *     ctx = await bootstrapPerfTest();
 *     await seedProducts(ctx.dataSource, 10_000);
 *   }, 120_000);
 *
 *   afterAll(() => teardownPerfTest(ctx));
 */
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { getDataSourceToken } from '@nestjs/typeorm';
import { MIGRATIONS_GLOB } from '@test/paths';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';

export type { PerfResultRow } from './save-results';
export { savePerfResults } from './save-results';

import { AppModule } from '@/app.module';
import { FileRecord } from '@/files/file-record.entity';
import { PaymentsHealthIndicator } from '@/health/indicators/payments.health';
import { OrderItem } from '@/orders/order-item.entity';
import { Order } from '@/orders/order.entity';
import { PAYMENTS_GRPC_CLIENT } from '@/payments/constants';
import { PaymentsGrpcService } from '@/payments/payments-grpc.service';
import { Product } from '@/products/product.entity';
import { ProcessedMessage } from '@/rabbitmq/processed-message.entity';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { User } from '@/users/user.entity';

export interface PerfTestContext {
  /** Pre-signed JWT with admin scopes for HTTP requests. */
  accessToken: string;
  app: INestApplication;
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
}

/**
 * Starts a real Postgres 16 container with pg_stat_statements enabled,
 * runs all migrations, and boots the NestJS app with infrastructure mocked out.
 *
 * pg_stat_statements lets each *.perf.ts verify query counts before/after optimizations.
 */
export async function bootstrapPerfTest(): Promise<PerfTestContext> {
  // 1. Start Postgres with pg_stat_statements enabled
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withCommand([
      'postgres',
      '-c',
      'shared_preload_libraries=pg_stat_statements',
      '-c',
      'pg_stat_statements.track=all',
      '-c',
      'log_min_duration_statement=100',
    ])
    .start();

  const dbUrl = `${container.getConnectionUri()}?sslmode=disable`;
  process.env.DATABASE_URL = dbUrl;

  // 2. Run migrations against the blank container DB
  const migrationDs = new DataSource({
    entities: [FileRecord, Order, OrderItem, ProcessedMessage, Product, User],
    migrations: [MIGRATIONS_GLOB],
    ssl: false,
    synchronize: false,
    type: 'postgres',
    url: container.getConnectionUri(),
  });
  await migrationDs.initialize();
  // pg_stat_statements is preloaded via shared_preload_libraries but the
  // extension object must still be created inside the database before
  // pg_stat_statements_reset() and the view become available.
  await migrationDs.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
  await migrationDs.runMigrations();
  await migrationDs.destroy();

  // 3. Build the NestJS module — same provider overrides as integration tests.
  //    Infrastructure not under test: RabbitMQ, gRPC client, throttler, health check.
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken())
    .useValue({
      skipIf: () => true,
      throttlers: [
        { limit: 100_000, name: 'short', ttl: 1000 },
        { limit: 100_000, name: 'medium', ttl: 10_000 },
        { limit: 100_000, name: 'long', ttl: 60_000 },
      ],
    })
    .overrideProvider(RabbitMQService)
    .useValue({
      cancelConsumer: jest.fn().mockResolvedValue(undefined),
      channel: null,
      connection: null,
      consume: jest.fn().mockResolvedValue({ consumerTag: 'test-consumer' }),
      publish: jest.fn(),
    })
    .overrideProvider(PAYMENTS_GRPC_CLIENT)
    .useValue({})
    .overrideProvider(PaymentsGrpcService)
    .useValue({ authorize: jest.fn(), getPaymentStatus: jest.fn() })
    .overrideProvider(PaymentsHealthIndicator)
    .useValue({ check: jest.fn().mockResolvedValue({ payments: { status: 'up' } }) })
    .compile();

  const app = moduleFixture.createNestApplication();
  app.enableVersioning({ defaultVersion: '1', type: VersioningType.URI });
  app.setGlobalPrefix('api', { exclude: ['/'] });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      whitelist: true,
    }),
  );
  await app.init();

  const dataSource = app.get<DataSource>(getDataSourceToken());

  // 4. Sign a broad-scopes JWT for use in HTTP test requests
  const jwtService = app.get(JwtService);
  const accessToken = await jwtService.signAsync({
    email: 'perf@test.local',
    roles: ['admin'],
    scopes: [
      'orders:read',
      'orders:write',
      'products:read',
      'products:write',
      'users:read',
      'users:write',
      'payments:read',
      'payments:write',
    ],
    sub: '00000000-0000-0000-0000-000000000001',
  });

  return { accessToken, app, container, dataSource };
}

/**
 * Returns rows from pg_stat_statements matching an optional query fragment.
 * Useful for asserting call counts and total execution time.
 */
export async function getPgStatStatements(
  dataSource: DataSource,
  queryFragment?: string,
): Promise<{ calls: number; mean_exec_time: number; query: string; total_exec_time: number }[]> {
  const filter = queryFragment
    ? `WHERE query ILIKE $1 AND query NOT ILIKE '%pg_stat_statements%'`
    : `WHERE query NOT ILIKE '%pg_stat_statements%'`;
  const params = queryFragment ? [`%${queryFragment}%`] : [];
  // bigint columns (calls) are returned as strings by node-postgres.
  // Cast to int to keep downstream arithmetic correct.
  return dataSource.query(
    `SELECT query, calls::int AS calls, total_exec_time, mean_exec_time
     FROM pg_stat_statements
     ${filter}
     ORDER BY total_exec_time DESC`,
    params,
  );
}

/**
 * Resets all pg_stat_statements counters for the current database.
 * Call before the operation under test to get a clean baseline.
 */
export async function resetPgStatStatements(dataSource: DataSource): Promise<void> {
  await dataSource.query('SELECT pg_stat_statements_reset()');
}

/**
 * Tears down the NestJS app and stops the Postgres container.
 * Call this in afterAll(); ryuk also cleans up the container on process exit.
 *
 * The short drain delay lets fire-and-forget async operations (e.g. AuditLogService)
 * complete before the container is stopped, preventing "Connection terminated" noise.
 */
export async function teardownPerfTest(ctx: PerfTestContext): Promise<void> {
  // Allow in-flight fire-and-forget operations to settle.
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  try {
    if (ctx.app) await ctx.app.close();
  } finally {
    if (ctx.container) await ctx.container.stop();
  }
}
