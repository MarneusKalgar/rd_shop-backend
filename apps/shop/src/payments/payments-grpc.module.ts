import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'node:path';

import { PAYMENTS_GRPC_CLIENT } from './constants';
import { PaymentsGrpcService } from './payments-grpc.service';
import { createPaymentsGrpcClient } from './utils';

@Module({
  exports: [PaymentsGrpcService, PAYMENTS_GRPC_CLIENT],
  imports: [ConfigModule],
  providers: [
    {
      inject: [ConfigService],
      provide: PAYMENTS_GRPC_CLIENT,
      useFactory: (config: ConfigService) => {
        const logger = new Logger(PaymentsGrpcModule.name);
        const host = config.getOrThrow<string>('PAYMENTS_GRPC_HOST');
        const port = config.get<number>('PAYMENTS_GRPC_PORT') ?? 5001;

        return createPaymentsGrpcClient({
          host,
          logger,
          port,
          protoPath: join(__dirname, '../proto/payments.proto'),
        });
      },
    },
    PaymentsGrpcService,
  ],
})
export class PaymentsGrpcModule {}
