import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity';
import { CartItem } from './cart-item.entity';

@Entity('carts')
@Index('IDX_carts_user_id', ['userId'], { unique: true })
export class Cart {
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToMany(() => CartItem, (item) => item.cart, { cascade: true })
  items: CartItem[];

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @JoinColumn({ name: 'user_id' })
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;
}
