import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
// import { GracefulShutdownModule } from '@tygra/nestjs-graceful-shutdown';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { QueryLoggerMiddleware, RequestIdMiddleware } from './common/middlewares';
import { /*getGracefulShutdownConfig,*/ getTypeOrmModuleOptions } from './config';
import { getEnvFile, validate } from './core/environment';
import { FilesModule } from './files/files.module';
import { GraphqlModule } from './graphql/graphql.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { UsersModule } from './users/users.module';

@Module({
  controllers: [AppController],
  imports: [
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
    // TODO: Uncomment when resolve problem with graphql module
    // GracefulShutdownModule.forRoot(getGracefulShutdownConfig()),
    UsersModule,
    OrdersModule,
    ProductsModule,
    FilesModule,
    GraphqlModule,
  ],
  providers: [AppService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
    consumer.apply(QueryLoggerMiddleware).forRoutes('*');
  }
}
