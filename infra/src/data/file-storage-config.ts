import { config, stack, stackName } from '../bootstrap';

const defaultFilesBucketCorsAllowedHeaders = ['*'];
const defaultFilesBucketCorsAllowedOrigins = ['*'];

export interface FoundationFileStorageConfig {
  bucketName: string;
  corsAllowedHeaders: string[];
  corsAllowedOrigins: string[];
  forceDestroy: boolean;
}

export function getFoundationFileStorageConfig(): FoundationFileStorageConfig {
  const bucketName = config.get('filesBucketName') ?? stackName('files-private');
  const corsAllowedHeaders =
    config.getObject<string[]>('filesBucketCorsAllowedHeaders') ??
    defaultFilesBucketCorsAllowedHeaders;
  const corsAllowedOrigins =
    config.getObject<string[]>('filesBucketCorsAllowedOrigins') ??
    defaultFilesBucketCorsAllowedOrigins;

  validateBucketName(bucketName);
  validateCorsValues('filesBucketCorsAllowedHeaders', corsAllowedHeaders);
  validateCorsAllowedOrigins(corsAllowedOrigins);

  return {
    bucketName,
    corsAllowedHeaders,
    corsAllowedOrigins,
    forceDestroy: stack !== 'production',
  };
}

function validateBucketName(bucketName: string) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName)) {
    throw new Error('filesBucketName must be a valid lowercase S3 bucket name.');
  }

  if (bucketName.includes('..')) {
    throw new Error('filesBucketName cannot contain consecutive dots.');
  }
}

function validateCorsAllowedOrigins(corsAllowedOrigins: string[]) {
  validateCorsValues('filesBucketCorsAllowedOrigins', corsAllowedOrigins);
}

function validateCorsValues(label: string, values: string[]) {
  if (values.length === 0) {
    throw new Error(`${label} must contain at least one value.`);
  }
}
