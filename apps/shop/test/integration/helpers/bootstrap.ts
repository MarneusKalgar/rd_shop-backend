import type { Server } from 'http';

/**
 * Shared Testcontainers + NestJS bootstrap for integration tests.
 *
 * Usage in each *.integration-spec.ts:
 *
 *   import { bootstrapIntegrationTest, IntegrationTestContext, teardownIntegrationTest } from '@test/integration/helpers/bootstrap';
 *
 *   let ctx: IntegrationTestContext;
 *
 *   beforeAll(async () => {
 *     ctx = await bootstrapIntegrationTest();
 *     // spec-specific seeding using ctx.dataSource
 *   }, 90_000);
 *
 *   afterAll(async () => {
 *     try {
 *       if (ctx?.dataSource) {
 *         await ctx.dataSource.query(`DELETE FROM ...`);
 *       }
 *     } finally {
 *       await teardownIntegrationTest(ctx);
 *     }
 *   });
 */
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import { getDataSourceToken } from '@nestjs/typeorm';
import { MIGRATIONS_GLOB } from '@test/paths';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

import { AppModule } from '@/app.module';
import { FileRecord } from '@/files/file-record.entity';
import { HEALTH_PATHS_TO_BYPASS } from '@/health/constants';
import { PaymentsHealthIndicator } from '@/health/indicators/payments.health';
import { OrderItem } from '@/orders/order-item.entity';
import { Order } from '@/orders/order.entity';
import { PAYMENTS_GRPC_CLIENT } from '@/payments/constants';
import { PaymentsGrpcService } from '@/payments/payments-grpc.service';
import { Product } from '@/products/product.entity';
import { ProcessedMessage } from '@/rabbitmq/processed-message.entity';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { User } from '@/users/user.entity';

export interface IntegrationTestContext {
  app: INestApplication;
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
  httpServer: Server;
  paymentsGrpcMock: PaymentsGrpcMock;
  rabbitmqMock: RabbitMQMock;
}

export interface PaymentsGrpcMock {
  authorize: jest.Mock;
  getPaymentStatus: jest.Mock;
}

export interface RabbitMQMock {
  cancelConsumer: jest.Mock;
  channel: null;
  connection: null;
  consume: jest.Mock;
  publish: jest.Mock;
}

type ConsumeCalls = [queue: string, handler: (msg: unknown, channel: unknown) => Promise<void>][];

/**
 * Starts a real Postgres 16 container, runs all migrations, and boots the NestJS
 * app with infrastructure providers (RabbitMQ, gRPC, throttler, health) mocked out.
 *
 * Returns mocks so individual specs can assert on them or set per-test return values.
 */
export async function bootstrapIntegrationTest(): Promise<IntegrationTestContext> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = `${container.getConnectionUri()}?sslmode=disable`;

  const migrationDs = new DataSource({
    entities: [FileRecord, Order, OrderItem, ProcessedMessage, Product, User],
    migrations: [MIGRATIONS_GLOB],
    ssl: false,
    synchronize: false,
    type: 'postgres',
    url: container.getConnectionUri(),
  });
  await migrationDs.initialize();
  await migrationDs.runMigrations();
  await migrationDs.destroy();

  const rabbitmqMock: RabbitMQMock = {
    cancelConsumer: jest.fn().mockResolvedValue(undefined),
    channel: null,
    connection: null,
    consume: jest.fn().mockResolvedValue({ consumerTag: 'test-consumer' }),
    publish: jest.fn(),
  };

  const paymentsGrpcMock: PaymentsGrpcMock = {
    authorize: jest.fn(),
    getPaymentStatus: jest.fn(),
  };

  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken())
    .useValue([
      { limit: 10_000, name: 'short', ttl: 1000 },
      { limit: 10_000, name: 'medium', ttl: 10_000 },
      { limit: 10_000, name: 'long', ttl: 60_000 },
    ])
    .overrideProvider(RabbitMQService)
    .useValue(rabbitmqMock)
    .overrideProvider(PAYMENTS_GRPC_CLIENT)
    .useValue({})
    .overrideProvider(PaymentsGrpcService)
    .useValue(paymentsGrpcMock)
    .overrideProvider(PaymentsHealthIndicator)
    .useValue({ check: jest.fn().mockResolvedValue({ payments: { status: 'up' } }) })
    .compile();

  const app = moduleFixture.createNestApplication();
  app.enableVersioning({ defaultVersion: '1', type: VersioningType.URI });
  app.setGlobalPrefix('api', { exclude: [...HEALTH_PATHS_TO_BYPASS, '/'] });
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
  const httpServer = app.getHttpServer() as Server;

  return { app, container, dataSource, httpServer, paymentsGrpcMock, rabbitmqMock };
}

export async function teardownIntegrationTest(ctx: IntegrationTestContext): Promise<void> {
  if (!ctx) return;

  try {
    if (ctx.app) await ctx.app.close();
  } finally {
    if (ctx.container) await ctx.container.stop();
  }
}

export function triggerConsumer(ctx: IntegrationTestContext, dto: object): Promise<void> {
  const [[, handler]] = ctx.rabbitmqMock.consume.mock.calls as ConsumeCalls;
  return handler({ content: Buffer.from(JSON.stringify(dto)) }, { ack: jest.fn() });
}
