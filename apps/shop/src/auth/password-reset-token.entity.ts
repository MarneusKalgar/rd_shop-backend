import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '@/users/user.entity';

@Entity('password_reset_tokens')
export class PasswordResetToken {
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255, name: 'token_hash', type: 'varchar' })
  tokenHash: string;

  @Column({ name: 'used_at', nullable: true, type: 'timestamptz' })
  usedAt: Date | null;

  @JoinColumn({ name: 'user_id' })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  get isUsable(): boolean {
    return this.usedAt === null && this.expiresAt > new Date();
  }
}
