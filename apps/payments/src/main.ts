import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'node:path';

import { PaymentsModule } from './payments.module';

async function bootstrap() {
  const app = await NestFactory.create(PaymentsModule);

  // TODO add config service
  const host = process.env.PAYMENTS_GRPC_HOST;
  const port = process.env.PAYMENTS_GRPC_PORT;

  const grpc = app.connectMicroservice<MicroserviceOptions>({
    options: {
      package: 'payments',
      protoPath: join(__dirname, 'proto/payments.proto'),
      url: `${host}:${port}`,
    },

    transport: Transport.GRPC,
  });

  await grpc.listen();
  await app.init();
  Logger.log(`payments-service gRPC started on ${host}:${port}`);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
