import { Body, Controller, Get, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  CreateOrderDto,
  CreateOrderResponseDto,
  FindOrdersFilterDto,
  GetOrdersResponseDto,
} from '../dto';
import { Order } from '../order.entity';
import { OrdersService } from '../orders.service';

// TODO: add roles/scopes
@ApiTags('orders')
@Controller({ path: 'orders', version: '1' })
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
  async createOrder(@Body() createOrderDto: CreateOrderDto): Promise<CreateOrderResponseDto> {
    const order = await this.ordersService.createOrder(createOrderDto);

    return {
      data: order,
    };
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
  async getOrders(@Query() filters: FindOrdersFilterDto): Promise<GetOrdersResponseDto> {
    const { nextCursor, orders } = await this.ordersService.findOrdersWithFilters(filters);

    return {
      data: orders,
      limit: filters.limit ?? 10,
      nextCursor,
    };
  }
}
