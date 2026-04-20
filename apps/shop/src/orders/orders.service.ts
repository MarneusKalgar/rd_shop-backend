import { Injectable } from '@nestjs/common';

import { AuditEventContext } from '@/audit-log/audit-log.types';
import { AuthUser } from '@/auth/types';

import { CreateOrderDto, FindOrdersFilterDto } from './dto';
import { Order } from './order.entity';
import { OrdersCommandService, OrdersQueryService } from './services';
import { FindOrdersWithFiltersResponse } from './types';

/**
 * Facade delegating to OrdersCommandService (write operations) and
 * OrdersQueryService (read operations). Preserved for backward compatibility
 * with existing call sites (controller, CartService, GraphQL resolver).
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly commandService: OrdersCommandService,
    private readonly queryService: OrdersQueryService,
  ) {}

  cancelOrder(user: AuthUser, orderId: string, context?: AuditEventContext): Promise<Order> {
    return this.commandService.cancelOrder(user, orderId, context);
  }

  createOrder(
    userId: string,
    createOrderDto: CreateOrderDto,
    context?: AuditEventContext,
  ): Promise<Order> {
    return this.commandService.createOrder(userId, createOrderDto, context);
  }

  findOrdersWithFilters(
    userId: string,
    params: FindOrdersFilterDto,
  ): Promise<FindOrdersWithFiltersResponse> {
    return this.queryService.findOrdersWithFilters(userId, params);
  }

  getOrderById(userId: string, orderId: string): Promise<Order> {
    return this.queryService.getOrderById(userId, orderId);
  }

  getOrderPayment(userId: string, orderId: string): Promise<{ paymentId: string; status: string }> {
    return this.queryService.getOrderPayment(userId, orderId);
  }
}
