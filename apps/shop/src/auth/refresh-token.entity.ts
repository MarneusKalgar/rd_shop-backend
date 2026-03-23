import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '@/users/user.entity';

@Entity('refresh_tokens')
@Index('IDX_refresh_tokens_user_active', ['userId', 'revokedAt'])
export class RefreshToken {
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'revoked_at', nullable: true, type: 'timestamptz' })
  revokedAt: Date | null;

  @Column({ length: 255, name: 'token_hash', type: 'varchar' })
  tokenHash: string;

  @JoinColumn({ name: 'user_id' })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  get isActive(): boolean {
    return this.revokedAt === null && this.expiresAt > new Date();
  }
}
