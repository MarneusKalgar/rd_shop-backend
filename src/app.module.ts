import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { validate, getEnvFile } from './core/environment';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      envFilePath: getEnvFile(),
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
