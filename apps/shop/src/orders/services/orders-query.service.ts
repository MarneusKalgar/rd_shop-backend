import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { decodeEpochCursor } from '@/common/utils';
import { PaymentsGrpcService } from '@/payments/payments-grpc.service';

import { DEFAULT_ORDERS_LIMIT } from '../constants';
import { FindOrdersFilterDto } from '../dto';
import { Order } from '../order.entity';
import { OrdersQueryBuilder, OrdersRepository } from '../repositories';
import { FindOrdersWithFiltersResponse } from '../types';
import { assertOrderOwnership, buildOrderNextCursor } from '../utils';

@Injectable()
export class OrdersQueryService {
  private readonly logger = new Logger(OrdersQueryService.name);

  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly ordersQueryBuilder: OrdersQueryBuilder,
    private readonly paymentsGrpcService: PaymentsGrpcService,
  ) {}

  async findOrdersWithFilters(
    userId: string,
    params: FindOrdersFilterDto,
  ): Promise<FindOrdersWithFiltersResponse> {
    const { cursor, limit = DEFAULT_ORDERS_LIMIT } = params;

    const subquery = this.ordersQueryBuilder.buildOrderIdsSubquery(userId, params);

    if (cursor) {
      const { date: cursorDate, id: cursorId } = decodeEpochCursor(cursor);
      this.ordersQueryBuilder.applyCursorPagination(subquery, {
        createdAt: cursorDate,
        id: cursorId,
      });
    }

    this.ordersQueryBuilder.applyOrderingAndLimit(subquery, limit + 1);

    const paginatedOrders: { createdAt: Date; id: string }[] = await subquery.getRawMany();
    if (!paginatedOrders.length) {
      return { nextCursor: null, orders: [] };
    }

    const hasNextPage = paginatedOrders.length > limit;
    const pageSlice = hasNextPage ? paginatedOrders.slice(0, limit) : paginatedOrders;

    const orderIds = pageSlice.map((row) => row.id);
    const mainQuery = this.ordersQueryBuilder.buildMainQuery(orderIds, { withUser: false });
    const orders = await mainQuery.getMany();

    const nextCursor = buildOrderNextCursor(pageSlice, hasNextPage);

    return { nextCursor, orders };
  }

  async getOrderById(userId: string, orderId: string): Promise<Order> {
    const order = await this.ordersRepository.findByIdWithItemRelations(orderId);

    assertOrderOwnership(order, userId);

    return order;
  }

  async getOrderPayment(
    userId: string,
    orderId: string,
  ): Promise<{ paymentId: string; status: string }> {
    const order = await this.ordersRepository.findByIdWithItemRelations(orderId);

    assertOrderOwnership(order, userId);

    if (!order.paymentId) {
      throw new BadRequestException(`Order "${orderId}" has no associated payment`);
    }

    try {
      const paymentStatus = await this.paymentsGrpcService.getPaymentStatus(order.paymentId);
      return paymentStatus;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`Failed to fetch payment status for order ${orderId}`, error);
      throw new ServiceUnavailableException('Failed to retrieve payment information');
    }
  }
}
