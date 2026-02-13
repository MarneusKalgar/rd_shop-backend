import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { FindOrdersFilterDto } from '../dto';
import { Order } from '../order.entity';

@Injectable()
export class OrdersQueryBuilder {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  applyCursorPagination(
    queryBuilder: SelectQueryBuilder<Order>,
    cursorOrder: Pick<Order, 'createdAt' | 'id'>,
  ): void {
    queryBuilder.andWhere(
      '(order.createdAt < :cursorDate OR (order.createdAt = :cursorDate AND order.id < :cursorId))',
      {
        cursorDate: cursorOrder.createdAt,
        cursorId: cursorOrder.id,
      },
    );
  }

  applyOrderingAndLimit(queryBuilder: SelectQueryBuilder<Order>, limit: number): void {
    queryBuilder.orderBy('order.createdAt', 'DESC').addOrderBy('order.id', 'DESC').take(limit);
  }

  buildFilteredQuery(params: FindOrdersFilterDto): SelectQueryBuilder<Order> {
    const { endDate, productName, startDate, status, userEmail } = params;

    const queryBuilder = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.items', 'orderItem')
      .leftJoinAndSelect('orderItem.product', 'product');

    if (status) {
      queryBuilder.andWhere('order.status = :status', { status });
    }

    if (startDate) {
      queryBuilder.andWhere('order.createdAt >= :startDate', { startDate });
    }

    if (endDate) {
      queryBuilder.andWhere('order.createdAt <= :endDate', { endDate });
    }

    if (userEmail) {
      queryBuilder.andWhere('user.email ILIKE :userEmail', {
        userEmail: `%${userEmail}%`,
      });
    }

    if (productName) {
      queryBuilder.andWhere('product.title ILIKE :productName', {
        productName: `%${productName}%`,
      });
    }

    return queryBuilder;
  }
}
