import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

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
    data: {
      idempotencyKey?: string;
      shippingCity?: null | string;
      shippingCountry?: null | string;
      shippingFirstName?: null | string;
      shippingLastName?: null | string;
      shippingPhone?: null | string;
      shippingPostcode?: null | string;
      user: User;
      userId: string;
    },
  ): Promise<Order> {
    const repo = this.getRepository(manager);
    const order = repo.create({
      idempotencyKey: data.idempotencyKey ?? null,
      shippingCity: data.shippingCity ?? null,
      shippingCountry: data.shippingCountry ?? null,
      shippingFirstName: data.shippingFirstName ?? null,
      shippingLastName: data.shippingLastName ?? null,
      shippingPhone: data.shippingPhone ?? null,
      shippingPostcode: data.shippingPostcode ?? null,
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

  async findByIdWithItemRelations(orderId: string, manager?: EntityManager): Promise<null | Order> {
    const repo = this.getRepository(manager);
    return repo.findOne({
      relations: ['items', 'items.product'],
      where: { id: orderId },
    });
  }

  async findByIdWithRelations(orderId: string, manager?: EntityManager): Promise<null | Order> {
    const repo = this.getRepository(manager);
    return repo.findOne({
      relations: ['items', 'items.product', 'user'],
      where: { id: orderId },
    });
  }

  async findByOrderIdsWithRelations(orderIds: string[], manager?: EntityManager): Promise<Order[]> {
    const repo = this.getRepository(manager);
    return repo.find({
      relations: ['items', 'items.product', 'user'],
      where: { id: In(orderIds) },
    });
  }

  async findByUserIdsWithRelations(userIds: string[], manager?: EntityManager): Promise<Order[]> {
    const repo = this.getRepository(manager);
    return repo.find({
      relations: ['items', 'items.product', 'user'],
      where: { userId: In(userIds) },
    });
  }

  getRepository(manager?: EntityManager): Repository<Order> {
    return manager ? manager.getRepository(Order) : this.repository;
  }
}
