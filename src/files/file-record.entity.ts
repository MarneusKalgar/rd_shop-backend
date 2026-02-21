import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '@/users/user.entity';

export enum FileStatus {
  PENDING = 'PENDING',
  READY = 'READY',
}

export enum FileVisibility {
  PRIVATE = 'PRIVATE',
  PUBLIC = 'PUBLIC',
}

@Entity('file_records')
@Index('IDX_file_records_owner_id', ['ownerId'])
@Index('IDX_file_records_entity_id', ['entityId'])
@Index('IDX_file_records_object_key', ['key'])
export class FileRecord {
  @Column({ length: 120, type: 'varchar' })
  bucket: string;

  @Column({ name: 'completed_at', nullable: true, type: 'timestamptz' })
  completedAt: Date | null;

  @Column({ length: 255, name: 'content_type', type: 'varchar' })
  contentType: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'entity_id', nullable: true, type: 'uuid' })
  entityId: null | string;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 500, name: 'key', type: 'varchar' })
  key: string;

  @JoinColumn({ name: 'owner_id' })
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  owner: User;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'bigint' })
  size: number;

  @Column({
    default: FileStatus.PENDING,
    enum: FileStatus,
    enumName: 'file_records_status_enum',
    type: 'enum',
  })
  status: FileStatus;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({
    default: FileVisibility.PRIVATE,
    enum: FileVisibility,
    enumName: 'file_records_visibility_enum',
    type: 'enum',
  })
  visibility: FileVisibility;
}
