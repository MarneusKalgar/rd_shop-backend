import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { join } from 'node:path';

import { PAYMENTS_GRPC_CLIENT } from './constants';
import { PaymentsGrpcService } from './payments-grpc.service';
import { resolvePaymentsGrpcUrl } from './utils';

@Module({
  exports: [PaymentsGrpcService, PAYMENTS_GRPC_CLIENT],
  imports: [ConfigModule],
  providers: [
    {
      inject: [ConfigService],
      provide: PAYMENTS_GRPC_CLIENT,
      useFactory: async (config: ConfigService) => {
        const logger = new Logger(PaymentsGrpcModule.name);
        const host = config.getOrThrow<string>('PAYMENTS_GRPC_HOST');
        const port = config.get<number>('PAYMENTS_GRPC_PORT') ?? 5001;
        const url = await resolvePaymentsGrpcUrl({ host, logger, port });

        return ClientProxyFactory.create({
          options: {
            loader: { enums: String },
            package: 'payments',
            protoPath: join(__dirname, '../proto/payments.proto'),
            url,
          },
          transport: Transport.GRPC,
        });
      },
    },
    PaymentsGrpcService,
  ],
})
export class PaymentsGrpcModule {}
