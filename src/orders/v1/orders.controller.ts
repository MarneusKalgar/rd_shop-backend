import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CreateOrderDto } from '../dto';
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
}
