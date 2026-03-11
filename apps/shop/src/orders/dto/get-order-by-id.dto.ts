import { ApiProperty } from '@nestjs/swagger';

import { Order } from '../order.entity';

export class GetOrderByIdResponseDto {
  @ApiProperty({ type: Order })
  data: Order;
}
