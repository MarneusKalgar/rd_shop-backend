import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';

import { FileRecord } from '../file-record.entity';

export class CompleteUploadDto {
  @ApiProperty({
    description: 'Type of entity this file belongs to',
    enum: ['product', 'user'],
    example: 'product',
  })
  @IsEnum(['product', 'user'])
  @IsNotEmpty()
  entityType: 'product' | 'user';

  @ApiProperty({
    description: 'File record ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  fileId: string;
}

export class CompleteUploadResponseDto {
  @ApiProperty({
    description: 'S3 bucket name where the file is stored',
    example: 'my-app-uploads',
  })
  bucket: string;

  @ApiProperty({
    description: 'Timestamp when the file upload was completed',
    example: '2024-06-01T12:00:00Z',
  })
  completedAt: Date | null;

  @ApiProperty({
    description: 'File content type',
    example: 'image/jpeg',
  })
  contentType: string;

  @ApiProperty({
    description: 'Timestamp when the file record was created',
    example: '2024-06-01T11:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'File record ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  fileId: string;

  @ApiProperty({
    description: 'File record ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'S3 object key',
    example: 'products/123/images/456.jpeg',
  })
  key: string;

  @ApiProperty({
    description: 'ID of the user who owns the file',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  ownerId: string;

  @ApiProperty({
    description: 'Public URL to access the file (if applicable)',
    example: 'https://cdn.example.com/products/123/images/456.jpeg',
  })
  publicUrl: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1024000,
  })
  size: number;

  @ApiProperty({
    description: 'File status',
    enum: ['PENDING', 'READY'],
    example: 'READY',
  })
  status: FileRecord['status'];

  @ApiProperty({
    description: 'Timestamp when the file record was last updated',
    example: '2024-06-01T12:30:00Z',
  })
  updatedAt: Date;
}
