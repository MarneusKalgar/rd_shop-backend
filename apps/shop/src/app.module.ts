import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
// import { GracefulShutdownModule } from '@tygra/nestjs-graceful-shutdown';

import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { QueryLoggerMiddleware } from './common/middlewares';
import {
  /*getGracefulShutdownConfig,*/ getPinoLoggerConfig,
  getTypeOrmModuleOptions,
} from './config';
import { getEnvFile, validate } from './core/environment';
import { FilesModule } from './files/files.module';
import { GraphqlModule } from './graphql/graphql.module';
import { HealthModule } from './health/health.module';
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
    ThrottlerModule.forRoot([
      { limit: 3, name: 'short', ttl: 1000 },
      { limit: 20, name: 'medium', ttl: 10000 },
      { limit: 100, name: 'long', ttl: 60000 },
    ]),
    // TODO: Uncomment when resolve problem with graphql module
    // GracefulShutdownModule.forRoot(getGracefulShutdownConfig()),
    AuthModule,
    AdminModule,
    UsersModule,
    CartModule,
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
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(QueryLoggerMiddleware).forRoutes('*');
  }
}
