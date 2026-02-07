import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({ example: 'VALIDATION_FAILED' })
  code!: string;

  @ApiProperty({ example: 'req-123' })
  correlationId!: string;

  @ApiPropertyOptional({
    example: { fields: [{ errors: ['email must be an email'], field: 'email' }] },
  })
  details?: Record<string, unknown>;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;
}
