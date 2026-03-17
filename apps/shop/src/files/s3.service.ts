import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';

import { InjectConfig, TypedConfigService } from '@/core/environment';

import { CheckFileError, PresignedUrlOptions } from './types';

@Injectable()
export class S3Service {
  get bucketName(): string {
    return this.bucket;
  }
  private readonly bucket: string;
  private readonly client: S3Client;
  private readonly cloudfrontBaseUrl?: string;
  private readonly downloadExpiresInSeconds: number;
  private readonly endpoint?: string;
  private readonly expiresInSeconds: number;
  private readonly forcePathStyle: boolean;
  private readonly logger = new Logger(S3Service.name);
  private readonly region: string;

  constructor(@InjectConfig() private readonly config: TypedConfigService) {
    this.bucket = this.config.get('AWS_S3_BUCKET', { infer: true });
    this.region = this.config.get('AWS_REGION', { infer: true });
    this.endpoint = this.config.get('AWS_S3_ENDPOINT', { infer: true });
    this.forcePathStyle = this.config.get('AWS_S3_FORCE_PATH_STYLE', { infer: true }) === 'true';
    this.expiresInSeconds =
      this.config.get('AWS_S3_PRESIGNED_URL_EXPIRATION', { infer: true }) ?? 900; // Default to 15 minutes if not set
    this.downloadExpiresInSeconds =
      this.config.get('AWS_S3_PRESIGNED_URL_DOWNLOAD_EXPIRATION', { infer: true }) ?? 3600; // Default to 1 hour if not set
    this.cloudfrontBaseUrl = this.config.get('AWS_CLOUDFRONT_URL', { infer: true });

    this.client = new S3Client({
      credentials: {
        accessKeyId: this.config.get('AWS_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: this.config.get('AWS_SECRET_ACCESS_KEY', { infer: true }),
      },
      endpoint: this.endpoint,
      forcePathStyle: this.forcePathStyle,
      region: this.region,
    });

    this.logger.log(
      `S3 client initialized with endpoint: ${this.endpoint}, region: ${this.region}`,
    );
  }

  /**
   * Check if a file exists in S3 bucket
   */
  async checkFileExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
      this.logger.debug(`File exists in S3: ${key}`);
      return true;
    } catch (error: unknown) {
      const err = error as CheckFileError;
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        this.logger.debug(`File does not exist in S3: ${key}`);
        return false;
      }
      this.logger.error(`Error checking file existence: ${err.message}`);
      throw error;
    }
  }

  /**
   * Generate presigned download URL
   */
  async getPresignedDownloadUrl(
    key: string,
  ): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    const downloadUrl = await getSignedUrl(this.client, command, {
      expiresIn: this.downloadExpiresInSeconds,
    });

    return {
      downloadUrl,
      expiresInSeconds: this.downloadExpiresInSeconds,
    };
  }

  /**
   * Generate a presigned URL for uploading a file to S3
   */
  async getPresignedUploadUrl(
    options: PresignedUrlOptions,
  ): Promise<{ expiresInSeconds: number; uploadUrl: string }> {
    const { contentType, key, size } = options;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      ContentLength: size,
      ContentType: contentType,
      Key: key,
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: this.expiresInSeconds,
    });

    this.logger.debug(`Generated presigned upload URL for key: ${key}`);

    return { expiresInSeconds: this.expiresInSeconds, uploadUrl: url };
  }

  /**
   * Get permanent public URL for a file
   * NOTE: This URL will only work if the file is publicly accessible (e.g. via CloudFront or if the S3 bucket/object ACL allows public read access).
   * For private files, use getPresignedDownloadUrl instead.
   */
  getPublicUrl(key: string): string {
    if (this.cloudfrontBaseUrl) {
      return `${this.cloudfrontBaseUrl}/${key}`;
    }

    if (this.forcePathStyle && this.endpoint) {
      return `${this.endpoint}/${this.bucketName}/${key}`;
    }

    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async healthCheck(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      console.error(error);
      this.logger.error(`S3 health check failed: ${error}`);
      throw error;
    }
  }
}
