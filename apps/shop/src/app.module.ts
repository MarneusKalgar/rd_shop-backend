import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';

import { AuthModule } from './auth/auth.module';
import { GqlThrottlerGuard } from './auth/guards';
import { CartModule } from './cart/cart.module';
import { QueryLoggerMiddleware } from './common/middlewares';
import { getPinoLoggerConfig, getTypeOrmModuleOptions } from './config';
import { getThrottlerModuleOptions } from './config/throttler';
import { getEnvFile, validate } from './core/environment';
import { FilesModule } from './files/files.module';
import { GraphqlModule } from './graphql/graphql.module';
import { HealthModule } from './health/health.module';
import { HttpMetricsMiddleware, ObservabilityModule } from './observability';
import { OrderWorkerModule } from './orders-worker/orders-worker.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { RabbitMQModule } from './rabbitmq/rabbitmq.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    LoggerModule.forRoot(getPinoLoggerConfig()),
    ConfigModule.forRoot({
      envFilePath: getEnvFile(),
      isGlobal: true,
      validate,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getTypeOrmModuleOptions,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getThrottlerModuleOptions,
    }),
    AuthModule,
    UsersModule,
    CartModule,
    ObservabilityModule,
    OrdersModule,
    ProductsModule,
    FilesModule,
    GraphqlModule,
    RabbitMQModule,
    OrderWorkerModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: GqlThrottlerGuard,
    },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(QueryLoggerMiddleware, HttpMetricsMiddleware).forRoutes('*');
  }
}
