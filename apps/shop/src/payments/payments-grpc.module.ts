import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { join } from 'path';

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
            package: 'payments',
            protoPath: join(process.cwd(), 'src/proto/payments.proto'),
            url: `${config.get('PAYMENTS_GRPC_HOST') ?? 'localhost'}:${config.get('PAYMENTS_GRPC_PORT') ?? 5000}`,
          },
          transport: Transport.GRPC,
        }),
    },
    PaymentsGrpcService,
  ],
})
export class PaymentsGrpcModule {}
