import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreatePresignedUploadDto {
  @ApiProperty({
    description: 'MIME type of the file',
    example: 'image/jpeg',
  })
  @IsNotEmpty()
  @IsString()
  contentType: string;

  @ApiProperty({
    description: 'ID of the entity this file belongs to (e.g., productId)',
    example: '650e8400-e29b-41d4-a716-446655440001',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  entityId: string;

  @ApiProperty({
    description: 'Type of entity this file belongs to',
    enum: ['product', 'user'],
    example: 'product',
  })
  @IsEnum(['product', 'user'])
  @IsNotEmpty()
  entityType: 'product' | 'user';

  @ApiProperty({
    description: 'File size in bytes',
    example: 1024000,
  })
  @IsNumber()
  @Min(1)
  size: number;
}
