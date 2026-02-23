import { ApiProperty } from '@nestjs/swagger';

import { FileRecord } from '../file-record.entity';

export class PresignedUploadResponseDto {
  @ApiProperty({
    description: 'MIME type of the file',
    example: 'image/jpeg',
  })
  contentType: string;

  @ApiProperty({
    description: 'Expiration time of the presigned URL in seconds',
    example: 900,
  })
  expiresInSeconds: number;

  @ApiProperty({
    description: 'ID of the created file record',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  fileId: string;

  @ApiProperty({
    description: 'S3 object key',
    example: 'products/650e8400-e29b-41d4-a716-446655440001/images/uuid.jpeg',
  })
  key: string;

  @ApiProperty({
    description: 'Status of the file record',
    example: 'PENDING',
  })
  status: FileRecord['status'];

  @ApiProperty({
    description: 'HTTP method to use for uploading the file',
    example: 'PUT',
  })
  uploadMethod: string;

  @ApiProperty({
    description: 'Presigned upload URL (valid for limited time)',
    example: 'https://s3.amazonaws.com/...',
  })
  uploadUrl: string;
}
