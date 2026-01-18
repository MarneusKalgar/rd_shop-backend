import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { GracefulShutdownModule } from '@tygra/nestjs-graceful-shutdown';
import { validate, getEnvFile } from './core/environment';
import { getGracefulShutdownConfig } from './config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      envFilePath: getEnvFile(),
    }),
    GracefulShutdownModule.forRoot(getGracefulShutdownConfig()),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
