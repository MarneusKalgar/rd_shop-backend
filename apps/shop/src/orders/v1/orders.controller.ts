import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { extractAuditContext } from '@/audit-log/utils';
import { CurrentUser } from '@/auth/decorators/current-user';
import { Scopes } from '@/auth/decorators/scopes';
import { JwtAuthGuard, ScopesGuard } from '@/auth/guards';
import { UserScope } from '@/auth/permissions/constants';
import { AuthUser } from '@/auth/types';

import {
  CreateOrderDto,
  FindOrdersFilterDto,
  GetOrderByIdResponseDto,
  GetOrderPaymentResponseDto,
  GetOrdersResponseDto,
} from '../dto';
import { OrdersService } from '../orders.service';

@ApiTags('orders')
@Controller({ path: 'orders', version: '1' })
@UseGuards(JwtAuthGuard, ScopesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @ApiOperation({ summary: 'Cancel an order' })
  @ApiResponse({
    description: 'Order cancelled successfully',
    status: HttpStatus.OK,
    type: GetOrderByIdResponseDto,
  })
  @ApiResponse({
    description: 'Order not found',
    status: HttpStatus.NOT_FOUND,
  })
  @ApiResponse({
    description: 'Order is already cancelled',
    status: HttpStatus.CONFLICT,
  })
  @ApiResponse({
    description: 'Order is in an invalid state for cancellation',
    status: HttpStatus.BAD_REQUEST,
  })
  @HttpCode(HttpStatus.OK)
  @Post(':orderId/cancellation')
  @Scopes(UserScope.ORDERS_WRITE)
  @Throttle({ medium: { limit: 5, ttl: 60_000 } })
  async cancelOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<GetOrderByIdResponseDto> {
    const order = await this.ordersService.cancelOrder(user, orderId, extractAuditContext(req));
    return { data: order };
  }

  @ApiOperation({ summary: 'Create a new order (idempotent)' })
  @ApiResponse({
    description: 'Order created (or existing order returned for duplicate idempotency key)',
    status: HttpStatus.CREATED,
    type: GetOrderByIdResponseDto,
  })
  @ApiResponse({
    description: 'Invalid input data',
    status: HttpStatus.BAD_REQUEST,
  })
  @ApiResponse({
    description: 'Insufficient stock, product not found, product inactive, or user not found',
    status: HttpStatus.CONFLICT,
  })
  @ApiResponse({
    description: 'Internal server error',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  })
  @Post()
  @Scopes(UserScope.ORDERS_WRITE)
  @Throttle({ medium: { limit: 5, ttl: 60_000 } })
  async createOrder(
    @Body() createOrderDto: CreateOrderDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<GetOrderByIdResponseDto> {
    const order = await this.ordersService.createOrder(
      user.sub,
      createOrderDto,
      extractAuditContext(req),
    );

    return { data: order };
  }

  @ApiOperation({ summary: 'Get order by ID' })
  @ApiResponse({
    description: 'Order retrieved successfully',
    status: HttpStatus.OK,
    type: GetOrderByIdResponseDto,
  })
  @ApiResponse({
    description: 'Order not found',
    status: HttpStatus.NOT_FOUND,
  })
  @Get(':orderId')
  @Scopes(UserScope.ORDERS_READ)
  async getOrderById(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<GetOrderByIdResponseDto> {
    const order = await this.ordersService.getOrderById(user.sub, orderId);
    return { data: order };
  }

  @ApiOperation({ summary: 'Get payment information for an order' })
  @ApiResponse({
    description: 'Payment information retrieved successfully',
    status: HttpStatus.OK,
    type: GetOrderPaymentResponseDto,
  })
  @ApiResponse({
    description: 'Order not found',
    status: HttpStatus.NOT_FOUND,
  })
  @ApiResponse({
    description: 'Order has no associated payment',
    status: HttpStatus.BAD_REQUEST,
  })
  @ApiResponse({
    description: 'Failed to retrieve payment information',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  })
  @Get(':orderId/payment')
  @Scopes(UserScope.ORDERS_READ)
  async getOrderPayment(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<GetOrderPaymentResponseDto> {
    const payment = await this.ordersService.getOrderPayment(user.sub, orderId);
    return { data: payment };
  }

  @ApiOperation({ summary: 'Get orders with filters' })
  @ApiResponse({
    description: 'Orders retrieved successfully',
    status: HttpStatus.OK,
    type: GetOrdersResponseDto,
  })
  @ApiResponse({
    description: 'Invalid query parameters',
    status: HttpStatus.BAD_REQUEST,
  })
  @Get()
  @Scopes(UserScope.ORDERS_READ)
  async getOrders(
    @Query() filters: FindOrdersFilterDto,
    @CurrentUser() user: AuthUser,
  ): Promise<GetOrdersResponseDto> {
    const { nextCursor, orders } = await this.ordersService.findOrdersWithFilters(
      user.sub,
      filters,
    );

    return {
      data: orders,
      limit: filters.limit ?? 10,
      nextCursor,
    };
  }
}
