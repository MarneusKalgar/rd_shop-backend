import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class GetFileDto {
  @ApiProperty({
    description: 'User ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsUUID()
  userId: string;
}

export class GetFileUrlResponseDto {
  @ApiProperty({
    description: 'Presigned URL to download the file',
    example: 'https://bucket.s3.amazonaws.com/path/to/file?X-Amz-Signature=...',
  })
  url: string;
}
