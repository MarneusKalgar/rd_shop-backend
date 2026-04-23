import { Injectable } from '@nestjs/common';

import { AuditEventContext } from '@/audit-log/audit-log.types';
import { AuthUser } from '@/auth/types';

import { CreateOrderDto, FindOrdersFilterDto } from './dto';
import { Order } from './order.entity';
import { OrdersCommandService, OrdersQueryService } from './services';
import { FindOrdersWithFiltersResponse } from './types';

/**
 * Backward-compatibility facade over the orders domain services.
 *
 * Preserves the original public API so that existing call sites
 * (`OrdersController`, `CartService`, `OrdersResolver`) require no import changes.
 *
 * Write operations are delegated to `OrdersCommandService`.
 * Read operations are delegated to `OrdersQueryService`.
 *
 * New code should prefer injecting `OrdersCommandService` or `OrdersQueryService` directly.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly commandService: OrdersCommandService,
    private readonly queryService: OrdersQueryService,
  ) {}

  /** @see OrdersCommandService.cancelOrder */
  cancelOrder(user: AuthUser, orderId: string, context?: AuditEventContext): Promise<Order> {
    return this.commandService.cancelOrder(user, orderId, context);
  }

  /** @see OrdersCommandService.createOrder */
  createOrder(
    userId: string,
    createOrderDto: CreateOrderDto,
    context?: AuditEventContext,
  ): Promise<Order> {
    return this.commandService.createOrder(userId, createOrderDto, context);
  }

  /** @see OrdersQueryService.findOrdersWithFilters */
  findOrdersWithFilters(
    userId: string,
    params: FindOrdersFilterDto,
  ): Promise<FindOrdersWithFiltersResponse> {
    return this.queryService.findOrdersWithFilters(userId, params);
  }

  /** @see OrdersQueryService.getOrderById */
  getOrderById(userId: string, orderId: string): Promise<Order> {
    return this.queryService.getOrderById(userId, orderId);
  }

  /** @see OrdersQueryService.getOrderPayment */
  getOrderPayment(userId: string, orderId: string): Promise<{ paymentId: string; status: string }> {
    return this.queryService.getOrderPayment(userId, orderId);
  }
}
