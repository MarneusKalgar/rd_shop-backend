import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PAYMENTS_GRPC_CLIENT } from './constants';
import { PaymentsGrpcClient, PaymentsGrpcClientService } from './payments-grpc-client.service';
import { PaymentsGrpcService } from './payments-grpc.service';

@Module({
  exports: [PaymentsGrpcClientService, PaymentsGrpcService, PAYMENTS_GRPC_CLIENT],
  imports: [ConfigModule],
  providers: [
    PaymentsGrpcClientService,
    {
      inject: [PaymentsGrpcClientService],
      provide: PAYMENTS_GRPC_CLIENT,
      useFactory: (client: PaymentsGrpcClientService): PaymentsGrpcClient => client,
    },
    PaymentsGrpcService,
  ],
})
export class PaymentsGrpcModule {}
