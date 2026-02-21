import { Body, Controller, HttpStatus, Post /*, Req*/ } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  CompleteUploadDto,
  CompleteUploadResponseDto,
  CreatePresignedUploadDto,
  PresignedUploadResponseDto,
} from '../dto';
import { FilesService } from '../files.service';

@ApiTags('files')
@Controller({ path: 'files', version: '1' })
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @ApiOperation({
    description:
      'Complete file upload by verifying the file exists in S3 and updating the file record status to ready.',
    summary: 'Complete file upload',
  })
  @ApiResponse({
    description: 'File upload completed successfully',
    status: HttpStatus.OK,
    type: CompleteUploadResponseDto,
  })
  @ApiResponse({
    description: 'File record not found',
    status: HttpStatus.NOT_FOUND,
  })
  @ApiResponse({
    description: 'File not found in S3 bucket',
    status: HttpStatus.BAD_REQUEST,
  })
  @Post('complete-upload')
  async completeUpload(@Body() body: CompleteUploadDto): Promise<CompleteUploadResponseDto> {
    const { entityType, fileId } = body;
    return this.filesService.completeUpload(fileId, entityType);
  }

  @ApiOperation({
    description:
      'Generate a presigned URL for uploading a file to S3. The URL is valid for a limited time (default: 15 minutes).',
    summary: 'Create presigned upload URL',
  })
  @ApiResponse({
    description: 'Presigned URL created successfully',
    status: HttpStatus.CREATED,
    type: PresignedUploadResponseDto,
  })
  @ApiResponse({
    description: 'Invalid input data',
    status: HttpStatus.BAD_REQUEST,
  })
  @Post('presigned-upload')
  async createPresignedUpload(
    // TODO: uncomment to accept user id
    // @Req() req,
    @Body() body: CreatePresignedUploadDto,
  ): Promise<PresignedUploadResponseDto> {
    return this.filesService.createPresignedUpload(body);
  }
}
