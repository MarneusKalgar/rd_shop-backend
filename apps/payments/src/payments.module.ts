import { Module } from '@nestjs/common';

import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController],
  imports: [],
  providers: [PaymentsService],
})
export class PaymentsModule {}
