import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles, Scopes } from '@/auth/decorators';
import { CurrentUser } from '@/auth/decorators/current-user';
import { JwtAuthGuard, RolesGuard, ScopesGuard } from '@/auth/guards';
import { UserRole, UserScope } from '@/auth/permissions';
import { AuthUser } from '@/auth/types';

import {
  CompleteUploadDto,
  CompleteUploadResponseDto,
  CreatePresignedUploadDto,
  // GetFileDto,
  GetFileUrlResponseDto,
  PresignedUploadResponseDto,
} from '../dto';
import { FilesService } from '../files.service';

@ApiTags('files')
@Controller({ path: 'files', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, ScopesGuard)
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
  @Roles(UserRole.ADMIN, UserRole.SUPPORT)
  @Scopes(UserScope.PRODUCTS_IMAGES_WRITE)
  async completeUpload(
    @CurrentUser() user: AuthUser,
    @Body() body: CompleteUploadDto,
  ): Promise<CompleteUploadResponseDto> {
    const { fileId } = body;
    return this.filesService.completeUpload(user.sub, fileId);
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
  // @Roles(UserRole.ADMIN, UserRole.SUPPORT)
  // @Scopes(UserScope.PRODUCTS_IMAGES_WRITE)
  async createPresignedUpload(
    @CurrentUser() user: AuthUser,
    @Body() body: CreatePresignedUploadDto,
  ): Promise<PresignedUploadResponseDto> {
    return this.filesService.createPresignedUpload(user.sub, body);
  }

  @ApiOperation({
    description: 'Get file record by ID',
    summary: 'Get file by ID',
  })
  @ApiResponse({
    description: 'File record retrieved successfully',
    status: HttpStatus.OK,
    type: CompleteUploadResponseDto,
  })
  @ApiResponse({
    description: 'File record not found',
    status: HttpStatus.NOT_FOUND,
  })
  @Get(':fileId')
  @Roles(UserRole.ADMIN, UserRole.SUPPORT)
  @Scopes(UserScope.PRODUCTS_IMAGES_READ)
  async getFileById(
    @CurrentUser() user: AuthUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<CompleteUploadResponseDto> {
    return this.filesService.getFileById(user.sub, fileId);
  }

  @ApiOperation({
    description:
      'Get a presigned URL to view/download the file from S3. The URL is valid for 1 hour.',
    summary: 'Get file URL',
  })
  @ApiResponse({
    description: 'Presigned URL generated successfully',
    status: HttpStatus.OK,
    type: GetFileUrlResponseDto,
  })
  @ApiResponse({
    description: 'File record not found',
    status: HttpStatus.NOT_FOUND,
  })
  @ApiResponse({
    description: 'File is not ready for download',
    status: HttpStatus.BAD_REQUEST,
  })
  @Get(':fileId/url')
  @Roles(UserRole.ADMIN, UserRole.SUPPORT)
  @Scopes(UserScope.PRODUCTS_IMAGES_READ)
  async getFileUrl(
    @CurrentUser() user: AuthUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<GetFileUrlResponseDto> {
    return this.filesService.getFileUrl(user.sub, fileId);
  }
}
