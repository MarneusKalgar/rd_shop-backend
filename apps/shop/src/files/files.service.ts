import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ProductsService } from '@/products/products.service';

import { CreatePresignedUploadDto } from './dto';
import { FileRecord, FileStatus, FileVisibility } from './file-record.entity';
import { S3Service } from './s3.service';
import { CompleteUploadResponse, EntityFileAssociation, FileUploadResponse } from './types';
import { getObjectKey } from './utils';

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

  checkIsOwner(fileRecord: FileRecord, userId: string) {
    const isOwner = fileRecord.ownerId === userId;

    if (!isOwner) {
      throw new ForbiddenException('You do not have access to this file');
    }
  }

  /**
   * Complete file upload - verify file exists in S3 and update record status
   */
  async completeUpload(
    userId: string,
    fileId: string,
    entityType: EntityFileAssociation,
  ): Promise<CompleteUploadResponse> {
    const fileRecord = await this.findFileRecordOrFail(fileId);

    this.checkIsOwner(fileRecord, userId);

    if (fileRecord.status === FileStatus.READY) {
      this.logger.warn(`File record ${fileId} is already marked as ready`);
      return await this.getFileRecordData(fileRecord);
    }

    const fileExistsInS3 = await this.s3Service.checkFileExists(fileRecord.key);

    if (!fileExistsInS3) {
      throw new BadRequestException(
        `File not found in S3 bucket. Please upload the file first using the presigned URL.`,
      );
    }

    fileRecord.status = FileStatus.READY;
    fileRecord.completedAt = new Date();
    await this.fileRecordRepository.save(fileRecord);

    if (fileRecord.entityId) {
      await this.associateFileWithEntity(fileRecord, entityType);
    }

    this.logger.log(`File upload completed for record: ${fileRecord.id}`);

    return await this.getFileRecordData(fileRecord);
  }

  /**
   * Create a presigned upload URL and file record
   */
  async createPresignedUpload(
    userId: string,
    dto: CreatePresignedUploadDto,
  ): Promise<FileUploadResponse> {
    const key = getObjectKey(userId, dto);

    const fileRecord = this.fileRecordRepository.create({
      bucket: this.s3Service.bucketName,
      contentType: dto.contentType,
      entityId: dto.entityId,
      key,
      ownerId: userId,
      size: dto.size,
      status: FileStatus.PENDING,
      visibility: FileVisibility.PRIVATE,
    });

    await this.fileRecordRepository.save(fileRecord);

    this.logger.log(`Created file record: ${fileRecord.id} for key: ${key}`);

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
    };
  }

  /**
   * Get file record by ID
   */
  async getFileById(userId: string, fileId: string): Promise<CompleteUploadResponse> {
    const fileRecord = await this.findFileRecordOrFail(fileId);

    this.checkIsOwner(fileRecord, userId);

    const fileRecordData = await this.getFileRecordData(fileRecord);

    if (!fileRecordData) {
      throw new Error('Failed to retrieve file record data');
    }

    return fileRecordData;
  }

  async getFileRecordData(fileRecord: FileRecord) {
    const { url: publicUrl } = await this.getPresignedDownloadUrl(fileRecord);

    return {
      bucket: fileRecord.bucket,
      completedAt: fileRecord.completedAt,
      contentType: fileRecord.contentType,
      createdAt: fileRecord.createdAt,
      fileId: fileRecord.id,
      id: fileRecord.id,
      key: fileRecord.key,
      ownerId: fileRecord.ownerId,
      publicUrl,
      size: fileRecord.size,
      status: fileRecord.status,
      updatedAt: fileRecord.updatedAt,
    };
  }

  /**
   * Get presigned download URL for a file
   */
  async getFileUrl(userId: string, fileId: string): Promise<{ url: string }> {
    const fileRecord = await this.findFileRecordOrFail(fileId);

    this.checkIsOwner(fileRecord, userId);

    if (fileRecord.status !== FileStatus.READY) {
      throw new BadRequestException('File is not ready for download');
    }

    const { url } = await this.getPresignedDownloadUrl(fileRecord);

    return { url };
  }

  async getPresignedDownloadUrl(fileRecord: FileRecord): Promise<{ url: string }> {
    const { downloadUrl: url } = await this.s3Service.getPresignedDownloadUrl(fileRecord.key);
    return { url };
  }

  /**
   * Get presigned download URL for a file by ID (used by external services, e.g. UserService for avatar)
   */
  async getPresignedUrlForFileId(fileId: string): Promise<null | string> {
    const fileRecord = await this.fileRecordRepository.findOne({ where: { id: fileId } });

    if (fileRecord?.status !== FileStatus.READY) return null;

    const { downloadUrl } = await this.s3Service.getPresignedDownloadUrl(fileRecord.key);
    return downloadUrl;
  }

  /**
   * Verify file ownership + S3 existence, mark READY if PENDING.
   * Returns { fileId, presignedUrl } for use by entity-specific services (e.g. avatar).
   */
  async prepareFileForEntity(
    userId: string,
    fileId: string,
  ): Promise<{ fileId: string; presignedUrl: string }> {
    const fileRecord = await this.findFileRecordOrFail(fileId);

    this.checkIsOwner(fileRecord, userId);

    const fileExistsInS3 = await this.s3Service.checkFileExists(fileRecord.key);

    if (!fileExistsInS3) {
      throw new BadRequestException(
        'File not found in S3. Please upload the file first using the presigned URL.',
      );
    }

    if (fileRecord.status === FileStatus.PENDING) {
      fileRecord.status = FileStatus.READY;
      fileRecord.completedAt = new Date();
      await this.fileRecordRepository.save(fileRecord);
    }

    const { downloadUrl: presignedUrl } = await this.s3Service.getPresignedDownloadUrl(
      fileRecord.key,
    );

    return { fileId: fileRecord.id, presignedUrl };
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
      default:
        this.logger.warn(`Unknown entity type: ${entityType as string}`);
    }
  }

  /**
   * Find file record by ID or throw NotFoundException
   */
  private async findFileRecordOrFail(fileId: string): Promise<FileRecord> {
    const fileRecord = await this.fileRecordRepository.findOne({
      where: { id: fileId },
    });

    if (!fileRecord) {
      throw new NotFoundException(`File record with ID ${fileId} not found`);
    }

    return fileRecord;
  }
}
