import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GracefulShutdownModule } from '@tygra/nestjs-graceful-shutdown';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RequestIdMiddleware } from './common/middlewares';
import { getGracefulShutdownConfig } from './config';
import { getEnvFile, validate } from './core/environment';
import { UsersModule } from './users/users.module';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({
      envFilePath: getEnvFile(),
      isGlobal: true,
      validate,
    }),
    GracefulShutdownModule.forRoot(getGracefulShutdownConfig()),
    UsersModule,
  ],
  providers: [AppService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
