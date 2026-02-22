import { FileRecord, FileStatus } from '../file-record.entity';

export interface CompleteUploadResponse {
  bucket: string;
  completedAt: Date | null;
  contentType: string;
  createdAt: Date;
  fileId: string;
  id: string;
  key: string;
  ownerId: string;
  publicUrl?: string;
  size: number;
  status: FileStatus;
  updatedAt: Date;
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

export interface PresignedUrlOptions {
  contentType: string;
  expiresIn?: number;
  key: string;
  size: number;
}
