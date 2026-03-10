import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { getTypeOrmModuleOptions } from './config';
import { getEnvFile, validate } from './core/environment';
import { Payment } from './payment.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController],
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
    TypeOrmModule.forFeature([Payment]),
  ],
  providers: [PaymentsService],
})
export class PaymentsModule {}
