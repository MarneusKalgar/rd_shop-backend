import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import { ProductsService } from '@/products/products.service';

import { FileRecord, FileStatus, FileVisibility } from './file-record.entity';
import { S3Service } from './s3.service';

export interface CompleteUploadResponse {
  bucket: string;
  completedAt: Date | null;
  contentType: string;
  createdAt: Date;
  fileId: string;
  id: string;
  key: string;
  ownerId: string;
  size: number;
  status: FileStatus;
  updatedAt: Date;
  // publicUrl?: string;
}

export interface CreateFileRecordDto {
  contentType: string;
  entityId?: string;
  entityType: EntityFileAssociation;
  ownerId: string;
  size: number;
  visibility?: FileVisibility;
}

export type EntityFileAssociation = 'product' | 'user';

export interface FileUploadResponse {
  contentType: string;
  expiresInSeconds: number;
  fileId: string;
  key: string;
  status: FileRecord['status'];
  uploadMethod: string;
  uploadUrl: string;
}

// TODO add public URL generation logic
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRecordRepository: Repository<FileRecord>,
    private readonly s3Service: S3Service,
    private readonly productsService: ProductsService,
  ) {}

  /**
   * Complete file upload - verify file exists in S3 and update record status
   */
  async completeUpload(
    fileId: string,
    entityType: EntityFileAssociation,
  ): Promise<CompleteUploadResponse> {
    const fileRecord = await this.fileRecordRepository.findOne({
      where: { id: fileId },
    });

    if (!fileRecord) {
      throw new NotFoundException(`File record with ID ${fileId} not found`);
    }

    if (fileRecord.status === FileStatus.READY) {
      this.logger.warn(`File record ${fileId} is already marked as ready`);
      return this.getFileRecordData(fileRecord);
    }

    const fileExistsInS3 = await this.s3Service.checkFileExists(fileRecord.key);

    if (!fileExistsInS3) {
      throw new BadRequestException(
        `File not found in S3 bucket. Please upload the file first using the presigned URL.`,
      );
    }

    // Update file record status to ready
    fileRecord.status = FileStatus.READY;
    fileRecord.completedAt = new Date();
    await this.fileRecordRepository.save(fileRecord);

    if (fileRecord.entityId) {
      await this.associateFileWithEntity(fileRecord, entityType);
    }

    this.logger.log(`File upload completed for record: ${fileRecord.id}`);

    return this.getFileRecordData(fileRecord);
  }

  /**
   * Create a presigned upload URL and file record
   */
  async createPresignedUpload(dto: CreateFileRecordDto): Promise<FileUploadResponse> {
    const key = this.buildObjectKey(dto);

    // Create file record in database
    const fileRecord = this.fileRecordRepository.create({
      bucket: this.s3Service.bucketName,
      contentType: dto.contentType,
      entityId: dto.entityId,
      key,
      // TODO change to actual ownerId from auth context
      ownerId: dto.ownerId,
      size: dto.size,
      status: FileStatus.PENDING,
      visibility: FileVisibility.PRIVATE,
    });

    await this.fileRecordRepository.save(fileRecord);

    if (!fileRecord) {
      throw new Error('Failed to create file record');
    }

    this.logger.log(`Created file record: ${fileRecord.id} for key: ${key}`);

    // Generate presigned upload URL
    const { expiresInSeconds, uploadUrl } = await this.s3Service.getPresignedUploadUrl({
      contentType: dto.contentType,
      key,
      size: fileRecord.size,
    });

    return {
      contentType: fileRecord.contentType,
      expiresInSeconds,
      fileId: fileRecord.id,
      key: fileRecord.key,
      status: fileRecord.status,
      uploadMethod: 'PUT',
      uploadUrl,
      // publicUrl: this.s3Service.getPublicUrl(fileRecord.key)
    };
  }
  getFileRecordData(fileRecord: FileRecord) {
    return {
      bucket: fileRecord.bucket,
      completedAt: fileRecord.completedAt,
      contentType: fileRecord.contentType,
      createdAt: fileRecord.createdAt,
      fileId: fileRecord.id,
      id: fileRecord.id,
      key: fileRecord.key,
      ownerId: fileRecord.ownerId,
      size: fileRecord.size,
      status: fileRecord.status,
      updatedAt: fileRecord.updatedAt,
      // publicUrl: this.s3Service.getPublicUrl(fileRecord.key)
    };
  }

  /**
   * Associate file with entity (Product, User, etc.)
   */
  private async associateFileWithEntity(
    fileRecord: FileRecord,
    entityType: EntityFileAssociation,
  ): Promise<void> {
    switch (entityType) {
      case 'product':
        await this.productsService.associateMainImage(fileRecord.entityId!, fileRecord.id);
        break;
      case 'user':
        // TODO: Implement user avatar association
        this.logger.log(`User avatar association not yet implemented for ${fileRecord.id}`);
        break;
      default:
        this.logger.warn(`Unknown entity type: ${entityType as string}`);
    }
  }

  /**
   * Build S3 object key based on entity type
   */
  private buildObjectKey(dto: CreateFileRecordDto): string {
    const fileId = randomUUID();
    const extension = this.getFileExtension(dto.contentType);

    switch (dto.entityType) {
      case 'product':
        return `products/${dto.entityId}/images/${fileId}${extension}`;
      case 'user':
        return `users/${dto.ownerId}/avatars/${fileId}${extension}`;
      default:
        return `misc/${dto.ownerId}/${fileId}${extension}`;
    }
  }

  /**
   * Get file extension from content type
   */
  private getFileExtension(contentType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpeg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    };

    return mimeToExt[contentType] || '';
  }
}
