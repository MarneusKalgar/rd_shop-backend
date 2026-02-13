import { Body, Controller, Get, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CreateOrderDto, FindOrdersFilterDto, GetOrdersResponseDto } from '../dto';
import { Order } from '../order.entity';
import { OrdersService } from '../orders.service';

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
  async createOrder(@Body() createOrderDto: CreateOrderDto): Promise<Order> {
    return await this.ordersService.createOrder(createOrderDto);
  }

  @ApiOperation({ summary: 'Get orders with filters' })
  @ApiResponse({
    description: 'Orders retrieved successfully',
    status: HttpStatus.OK,
    type: [Order],
  })
  @ApiResponse({
    description: 'Invalid query parameters',
    status: HttpStatus.BAD_REQUEST,
  })
  @Get()
  async getOrders(@Query() filters: FindOrdersFilterDto): Promise<GetOrdersResponseDto> {
    const { orders, total } = await this.ordersService.findOrdersWithFilters(filters);

    return {
      items: orders,
      page: filters.offset ? Math.floor(filters.offset / (filters.limit ?? 10)) + 1 : 1,
      perPage: filters.limit ?? 10,
      total,
    };
  }
}
