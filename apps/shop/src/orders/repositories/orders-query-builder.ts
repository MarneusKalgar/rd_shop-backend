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

  /**
   * Builds the main query that joins relations for the paginated order IDs.
   */
  buildMainQuery(orderIds: string[]): SelectQueryBuilder<Order> {
    return this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.items', 'orderItem')
      .leftJoinAndSelect('orderItem.product', 'product')
      .where('order.id IN (:...orderIds)', { orderIds })
      .orderBy('order.createdAt', 'DESC')
      .addOrderBy('order.id', 'DESC');
  }

  /**
   * Builds a subquery to get paginated order IDs with filters applied.
   * This ensures LIMIT applies to distinct orders, not joined rows.
   */
  buildOrderIdsSubquery(userId: string, params: FindOrdersFilterDto): SelectQueryBuilder<Order> {
    const { endDate, productName, startDate, status } = params;

    const subquery = this.orderRepository
      .createQueryBuilder('order')
      .select('order.id', 'id')
      .addSelect('order.createdAt', 'createdAt')
      .distinct(true)
      .where('order.userId = :userId', { userId });

    // Apply filters (same as before, but no joins yet)
    if (status) {
      subquery.andWhere('order.status = :status', { status });
    }

    if (startDate) {
      subquery.andWhere('order.createdAt >= :startDate', { startDate });
    }

    if (endDate) {
      subquery.andWhere('order.createdAt <= :endDate', { endDate });
    }

    // For product name filter, we need to join order_items and products in the subquery
    if (productName) {
      subquery
        .innerJoin('order.items', 'orderItem')
        .innerJoin('orderItem.product', 'product')
        .andWhere('product.title ILIKE :productName', {
          productName: `%${productName}%`,
        });
    }

    if (productName) {
      subquery.groupBy('order.id').addGroupBy('order.createdAt');
    }

    return subquery;
  }
}
