import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { ALLOWED_IMAGE_MIME_TYPES, FILE_SIZE_LIMITS } from '../constants';

export class CreatePresignedUploadDto {
  @ApiProperty({
    description: 'MIME type of the file',
    enum: ALLOWED_IMAGE_MIME_TYPES,
    example: 'image/jpeg',
  })
  @IsIn(ALLOWED_IMAGE_MIME_TYPES, {
    message: `Content type must be one of: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`,
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
    description: `File size in bytes (max ${FILE_SIZE_LIMITS.MAX_MB}MB)`,
    example: 5242880, // 5MB in bytes
    maximum: FILE_SIZE_LIMITS.MAX,
    minimum: FILE_SIZE_LIMITS.MIN,
  })
  @IsNumber()
  @Max(FILE_SIZE_LIMITS.MAX, {
    message: `File size cannot exceed ${FILE_SIZE_LIMITS.MAX_MB}MB (${FILE_SIZE_LIMITS.MAX} bytes)`,
  })
  @Min(FILE_SIZE_LIMITS.MIN, { message: 'File size must be at least 1 byte' })
  size: number;
}
