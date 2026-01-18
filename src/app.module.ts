import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GracefulShutdownModule } from '@tygra/nestjs-graceful-shutdown';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { getGracefulShutdownConfig } from './config';
import { getEnvFile, validate } from './core/environment';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({
      envFilePath: getEnvFile(),
      isGlobal: true,
      validate,
    }),
    GracefulShutdownModule.forRoot(getGracefulShutdownConfig()),
  ],
  providers: [AppService],
})
export class AppModule {}
