import { ApiProperty } from '@nestjs/swagger';

export class PaymentDto {
  @ApiProperty({ example: 'b35292be-16b6-4806-a686-00b960f73b1a' })
  paymentId: string;

  @ApiProperty({
    description: 'Payment status: AUTHORIZED, CAPTURED, REFUNDED, FAILED, PENDING',
    example: 'AUTHORIZED',
  })
  status: string;
}

export class GetOrderPaymentResponseDto {
  @ApiProperty({ type: PaymentDto })
  data: PaymentDto;
}
