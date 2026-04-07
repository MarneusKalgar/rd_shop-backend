import { AuditAction, AuditOutcome } from './audit-log.entity';

export interface AuditEventContext {
  correlationId?: string;
  ip?: string;
  userAgent?: string;
}

export interface CreateAuditEventDto {
  action: AuditAction;
  actorId?: null | string;
  actorRole?: null | string;
  context?: AuditEventContext;
  outcome: AuditOutcome;
  reason?: null | string;
  targetId?: null | string;
  targetType?: null | string;
}
