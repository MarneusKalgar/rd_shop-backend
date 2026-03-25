import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { FileRecord } from '../files/file-record.entity';
import { Order } from '../orders/order.entity';

@Entity('users')
@Index('IDX_users_email_unique', ['email'], { unique: true })
@Index('IDX_users_avatar_id', ['avatarId'])
export class User {
  @JoinColumn({ name: 'avatar_id' })
  @ManyToOne(() => FileRecord, { nullable: true, onDelete: 'SET NULL' })
  avatar: FileRecord | null;

  @Column({ name: 'avatar_id', nullable: true, type: 'uuid' })
  avatarId: null | string;

  @Column({ length: 100, name: 'city', nullable: true, type: 'varchar' })
  city: null | string;

  @Column({ length: 2, name: 'country', nullable: true, type: 'varchar' })
  country: null | string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true, type: 'timestamptz' })
  deletedAt: Date | null;

  @Column({ length: 320, type: 'varchar' })
  email: string;

  @Column({ length: 50, name: 'first_name', nullable: true, type: 'varchar' })
  firstName: null | string;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: false, name: 'is_email_verified', type: 'boolean' })
  isEmailVerified: boolean;

  @Column({ length: 50, name: 'last_name', nullable: true, type: 'varchar' })
  lastName: null | string;

  @OneToMany(() => Order, (order) => order.user)
  orders: Order[];

  @Column({ length: 255, name: 'password', nullable: true, select: false, type: 'varchar' })
  password: null | string;

  @Column({ length: 20, name: 'phone', nullable: true, type: 'varchar' })
  phone: null | string;

  @Column({ length: 20, name: 'postcode', nullable: true, type: 'varchar' })
  postcode: null | string;

  @Column({ array: true, default: [], name: 'roles', type: 'text' })
  roles: string[];

  @Column({ array: true, default: [], name: 'scopes', type: 'text' })
  scopes: string[];

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
