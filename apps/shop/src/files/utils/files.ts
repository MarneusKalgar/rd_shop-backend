import { randomUUID } from 'node:crypto';

import { CreatePresignedUploadDto } from '../dto';

/**
 * Get file extension from content type
 */
export const getFileExtension = (contentType: string): string => {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpeg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };

  return mimeToExt[contentType] || '';
};

/**
 * Build S3 object key based on entity type
 */
export const getObjectKey = (ownerId: string, dto: CreatePresignedUploadDto): string => {
  const fileId = randomUUID();
  const extension = getFileExtension(dto.contentType);

  switch (dto.entityType) {
    case 'product':
      return `products/${dto.entityId}/images/${fileId}${extension}`;
    case 'user':
      return `users/${ownerId}/avatars/${fileId}${extension}`;
    default:
      return `misc/${ownerId}/${fileId}${extension}`;
  }
};
