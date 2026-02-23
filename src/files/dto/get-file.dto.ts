import { ApiProperty } from '@nestjs/swagger';

export class GetFileUrlResponseDto {
  @ApiProperty({
    description: 'Presigned URL to download the file',
    example: 'https://bucket.s3.amazonaws.com/path/to/file?X-Amz-Signature=...',
  })
  url: string;
}
