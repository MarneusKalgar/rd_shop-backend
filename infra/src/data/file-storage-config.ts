import { config, stack, stackName } from '../bootstrap';

const defaultFilesBucketCorsAllowedHeaders = ['*'];
const defaultFilesBucketCorsAllowedOrigins = ['*'];

export interface FoundationFileStorageConfig {
  bucketName: string;
  corsAllowedHeaders: string[];
  corsAllowedOrigins: string[];
  forceDestroy: boolean;
}

/**
 * Step 1.2 file-storage config helper.
 * Accepts no arguments.
 * Resolves the S3 bucket name, CORS rules, and stack-specific destroy policy used by file-storage provisioning.
 */
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

/**
 * Step 1.2 validation helper.
 * Accepts the resolved S3 bucket name.
 * Throws when the bucket name violates the lowercase naming rules required by S3.
 */
function validateBucketName(bucketName: string) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName)) {
    throw new Error('filesBucketName must be a valid lowercase S3 bucket name.');
  }

  if (bucketName.includes('..')) {
    throw new Error('filesBucketName cannot contain consecutive dots.');
  }
}

/**
 * Step 1.2 validation helper.
 * Accepts the configured CORS allowed origins list.
 * Delegates to the generic value validator so origin lists cannot be empty.
 */
function validateCorsAllowedOrigins(corsAllowedOrigins: string[]) {
  validateCorsValues('filesBucketCorsAllowedOrigins', corsAllowedOrigins);
}

/**
 * Step 1.2 validation helper.
 * Accepts the config label and configured CORS values.
 * Throws when the caller tries to create the bucket with an empty CORS list.
 */
function validateCorsValues(label: string, values: string[]) {
  if (values.length === 0) {
    throw new Error(`${label} must contain at least one value.`);
  }
}
