import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum AuditAction {
  AUTH_LOGOUT = 'AUTH_LOGOUT',
  AUTH_PASSWORD_RESET_COMPLETE = 'AUTH_PASSWORD_RESET_COMPLETE',
  AUTH_PASSWORD_RESET_REQUEST = 'AUTH_PASSWORD_RESET_REQUEST',
  AUTH_SIGNIN_FAILURE = 'AUTH_SIGNIN_FAILURE',
  AUTH_SIGNUP = 'AUTH_SIGNUP',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  ORDER_CREATED = 'ORDER_CREATED',
  ORDER_CREATION_FAILED = 'ORDER_CREATION_FAILED',
  ORDER_IDEMPOTENT_HIT = 'ORDER_IDEMPOTENT_HIT',
  ORDER_PAYMENT_AUTHORIZED = 'ORDER_PAYMENT_AUTHORIZED',
  ORDER_PAYMENT_FAILED = 'ORDER_PAYMENT_FAILED',
  USER_ROLE_CHANGED = 'USER_ROLE_CHANGED',
  USER_SCOPE_CHANGED = 'USER_SCOPE_CHANGED',
  USER_SOFT_DELETED = 'USER_SOFT_DELETED',
}

export enum AuditOutcome {
  FAILURE = 'FAILURE',
  SUCCESS = 'SUCCESS',
}

@Entity('audit_logs')
export class AuditLog {
  @Column({ length: 100, type: 'varchar' })
  action: AuditAction;

  /** User performing the action. Null for unauthenticated events (e.g. failed login). */
  @Column({ name: 'actor_id', nullable: true, type: 'uuid' })
  actorId: null | string;

  @Column({ length: 50, name: 'actor_role', nullable: true, type: 'varchar' })
  actorRole: null | string;

  /** X-Request-ID from the originating HTTP request. */
  @Column({ length: 255, name: 'correlation_id', nullable: true, type: 'varchar' })
  correlationId: null | string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 45, nullable: true, type: 'varchar' })
  ip: null | string;

  @Column({ length: 20, type: 'varchar' })
  outcome: AuditOutcome;

  @Column({ nullable: true, type: 'text' })
  reason: null | string;

  /** Primary key of the target entity. */
  @Column({ length: 255, name: 'target_id', nullable: true, type: 'varchar' })
  targetId: null | string;

  /** Entity type the action targets (e.g. "User", "Order"). */
  @Column({ length: 100, name: 'target_type', nullable: true, type: 'varchar' })
  targetType: null | string;

  @Column({ name: 'user_agent', nullable: true, type: 'text' })
  userAgent: null | string;
}
