import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { MailService } from './mail.service';

@Module({
  exports: [MailService],
  imports: [ConfigModule],
  providers: [MailService],
})
export class MailModule {}
