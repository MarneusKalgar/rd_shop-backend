export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const;

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MIN_FILE_SIZE_BYTES = 1;

export const FILE_SIZE_LIMITS = {
  MAX: MAX_FILE_SIZE_BYTES,
  MAX_MB: 10,
  MIN: MIN_FILE_SIZE_BYTES,
} as const;
