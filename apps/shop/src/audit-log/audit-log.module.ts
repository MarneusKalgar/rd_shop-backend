import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLog } from './audit-log.entity';
import { AuditLogService } from './audit-log.service';

@Module({
  exports: [AuditLogService],
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditLogService],
})
export class AuditLogModule {}
