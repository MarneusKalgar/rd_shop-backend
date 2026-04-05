import { ApiProperty } from '@nestjs/swagger';

import { ORDER_EXAMPLE } from '../constants';
import { Order } from '../order.entity';

export class GetOrderByIdResponseDto {
  @ApiProperty({ example: ORDER_EXAMPLE, type: Order })
  data: Order;
}
