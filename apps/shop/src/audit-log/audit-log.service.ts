import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';

import { AuditLog } from './audit-log.entity';
import { CreateAuditEventDto } from './audit-log.types';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Persists a structured audit event. Failures are swallowed with a warning to prevent
   * audit writes from disrupting the primary business flow.
   */
  async log(dto: CreateAuditEventDto): Promise<void> {
    try {
      const entry = this.auditLogRepository.create({
        action: dto.action,
        actorId: dto.actorId ?? null,
        actorRole: dto.actorRole ?? null,
        correlationId: dto.context?.correlationId ?? null,
        ip: dto.context?.ip ?? null,
        outcome: dto.outcome,
        reason: dto.reason ?? null,
        targetId: dto.targetId ?? null,
        targetType: dto.targetType ?? null,
        userAgent: dto.context?.userAgent ?? null,
      });

      await this.auditLogRepository.save(entry);
    } catch (err: unknown) {
      this.logger.warn({ err }, 'AuditLogService: failed to persist audit event');
    }
  }
}
