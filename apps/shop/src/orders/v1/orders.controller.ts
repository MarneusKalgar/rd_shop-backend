import { Body, Controller, Get, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/auth/decorators/current-user';
import { JwtAuthGuard } from '@/auth/guards';
import { AuthUser } from '@/auth/types';

import {
  CreateOrderDto,
  CreateOrderResponseDto,
  FindOrdersFilterDto,
  GetOrderByIdResponseDto,
  GetOrderPaymentResponseDto,
  GetOrdersResponseDto,
} from '../dto';
import { Order } from '../order.entity';
import { OrdersService } from '../orders.service';

// TODO: add roles/scopes
@ApiTags('orders')
@Controller({ path: 'orders', version: '1' })
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @ApiOperation({ summary: 'Create a new order (idempotent)' })
  @ApiResponse({
    description: 'Order created successfully',
    status: HttpStatus.CREATED,
    type: Order,
  })
  @ApiResponse({
    description: 'Order already exists (idempotency)',
    status: HttpStatus.OK,
    type: Order,
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
  async createOrder(
    @Body() createOrderDto: CreateOrderDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CreateOrderResponseDto> {
    const order = await this.ordersService.createOrder(user.sub, createOrderDto);

    return {
      data: order,
    };
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
  async getOrderById(
    @Param('orderId') orderId: string,
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
  async getOrderPayment(
    @Param('orderId') orderId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<GetOrderPaymentResponseDto> {
    const payment = await this.ordersService.getOrderPayment(user.sub, orderId);
    return { data: payment };
  }

  @ApiOperation({ summary: 'Get orders with filters' })
  @ApiResponse({
    description: 'Orders retrieved successfully',
    status: HttpStatus.OK,
    type: [GetOrdersResponseDto],
  })
  @ApiResponse({
    description: 'Invalid query parameters',
    status: HttpStatus.BAD_REQUEST,
  })
  @Get()
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
