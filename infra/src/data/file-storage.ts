import * as aws from '@pulumi/aws';

import { commonTags, stackName } from '../bootstrap';
import { getFoundationFileStorageConfig } from './file-storage-config';

const corsMaxAgeSeconds = 3000;

/**
 * Step 1.2 / data layer.
 * Accepts no arguments.
 * Creates the private files bucket plus its public-access block, encryption, versioning, and CORS configuration, then returns the exported bucket metadata.
 */
export function createFoundationFileStorage() {
  const storageConfig = getFoundationFileStorageConfig();

  const filesBucket = new aws.s3.Bucket(stackName('files-bucket'), {
    bucket: storageConfig.bucketName,
    forceDestroy: storageConfig.forceDestroy,
    tags: {
      ...commonTags,
      Component: 'files',
      Name: storageConfig.bucketName,
      Scope: 'private',
      Service: 'shop',
    },
  });

  new aws.s3.BucketPublicAccessBlock(stackName('files-bucket-public-access-block'), {
    blockPublicAcls: true,
    blockPublicPolicy: true,
    bucket: filesBucket.id,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });

  new aws.s3.BucketServerSideEncryptionConfiguration(stackName('files-bucket-encryption'), {
    bucket: filesBucket.id,
    rules: [
      {
        applyServerSideEncryptionByDefault: {
          sseAlgorithm: 'AES256',
        },
      },
    ],
  });

  new aws.s3.BucketVersioning(stackName('files-bucket-versioning'), {
    bucket: filesBucket.id,
    versioningConfiguration: {
      status: 'Enabled',
    },
  });

  new aws.s3.BucketCorsConfiguration(stackName('files-bucket-cors'), {
    bucket: filesBucket.id,
    corsRules: [
      {
        allowedHeaders: storageConfig.corsAllowedHeaders,
        allowedMethods: ['GET', 'HEAD', 'PUT'],
        allowedOrigins: storageConfig.corsAllowedOrigins,
        exposeHeaders: ['ETag'],
        maxAgeSeconds: corsMaxAgeSeconds,
      },
    ],
  });

  return {
    filesBucketArn: filesBucket.arn,
    filesBucketName: filesBucket.bucket,
    filesBucketRegionalDomainName: filesBucket.bucketRegionalDomainName,
  };
}
