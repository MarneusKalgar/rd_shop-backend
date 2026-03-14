import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { join } from 'node:path';

import { PAYMENTS_GRPC_CLIENT } from './constants';
import { PaymentsGrpcService } from './payments-grpc.service';

@Module({
  exports: [PaymentsGrpcService],
  imports: [ConfigModule],
  providers: [
    {
      inject: [ConfigService],
      provide: PAYMENTS_GRPC_CLIENT,
      useFactory: (config: ConfigService) =>
        ClientProxyFactory.create({
          options: {
            loader: { enums: String },
            package: 'payments',
            protoPath: join(__dirname, '../proto/payments.proto'),
            url: `${config.get<string>('PAYMENTS_GRPC_HOST')}:${config.get<number>('PAYMENTS_GRPC_PORT')}`,
          },
          transport: Transport.GRPC,
        }),
    },
    PaymentsGrpcService,
  ],
})
export class PaymentsGrpcModule {}
