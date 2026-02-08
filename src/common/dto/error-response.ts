import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({
    description: 'Error message or array of messages',
    oneOf: [
      { example: 'User not found', type: 'string' },
      {
        example: ['email must be an email', 'password is too short'],
        items: { type: 'string' },
        type: 'array',
      },
    ],
  })
  message!: string | string[];

  @ApiProperty({
    description: 'Request path that caused the error',
    example: '/api/v1/users/123',
  })
  path!: string;

  @ApiPropertyOptional({
    description: 'Unique request identifier for tracing',
    example: 'abc-123-def-456',
  })
  requestId?: string;

  @ApiProperty({
    description: 'HTTP status code',
    example: 404,
  })
  statusCode!: number;

  @ApiProperty({
    description: 'ISO 8601 timestamp of when the error occurred',
    example: '2026-01-20T10:30:00.000Z',
  })
  timestamp!: string;
}
