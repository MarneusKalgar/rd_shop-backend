import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Order } from '../orders/order.entity';

@Entity('users')
@Index('IDX_users_email_unique', ['email'], { unique: true })
export class User {
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ length: 320, type: 'varchar' })
  email: string;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToMany(() => Order, (order) => order.user)
  orders: Order[];

  @Column({ length: 255, name: 'password', nullable: true, select: false, type: 'varchar' })
  password: string;

  @Column({ array: true, default: [], name: 'roles', type: 'text' })
  roles: string[];

  @Column({ array: true, default: [], name: 'scopes', type: 'text' })
  scopes: string[];

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
