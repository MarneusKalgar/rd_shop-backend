import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { User } from '@/users/user.entity';

import { Order } from '../order.entity';

@Injectable()
export class OrdersRepository {
  constructor(
    @InjectRepository(Order)
    private readonly repository: Repository<Order>,
  ) {}

  async createOrder(
    manager: EntityManager,
    data: { idempotencyKey?: string; user: User; userId: string },
  ): Promise<Order> {
    const repo = this.getRepository(manager);
    const order = repo.create({
      idempotencyKey: data.idempotencyKey ?? null,
      user: data.user,
      userId: data.userId,
    });
    return repo.save(order);
  }

  async findByCursor(cursor: string): Promise<null | Pick<Order, 'createdAt' | 'id'>> {
    return this.repository.findOne({
      select: ['createdAt', 'id'],
      where: { id: cursor },
    });
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<null | Order> {
    return this.repository.findOne({
      relations: ['items', 'items.product', 'user'],
      where: { idempotencyKey },
    });
  }

  async findByIdWithRelations(orderId: string, manager?: EntityManager): Promise<null | Order> {
    const repo = this.getRepository(manager);
    return repo.findOne({
      relations: ['items', 'items.product', 'user'],
      where: { id: orderId },
    });
  }

  getRepository(manager?: EntityManager): Repository<Order> {
    return manager ? manager.getRepository(Order) : this.repository;
  }
}
