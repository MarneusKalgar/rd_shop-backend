import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';

import { InjectConfig, TypedConfigService } from '@/core/environment';

export interface CheckFileError {
  $metadata?: {
    httpStatusCode: number;
  };
  message?: string;
  name?: string;
}

export interface PresignedUrlOptions {
  contentType: string;
  expiresIn?: number;
  key: string;
  size: number;
}

@Injectable()
export class S3Service {
  get bucketName(): string {
    return this.bucket;
  }
  private readonly bucket: string;
  private readonly client: S3Client;
  private readonly endpoint: string;
  private readonly expiresInSeconds: number;
  private readonly forcePathStyle: string;
  private readonly logger = new Logger(S3Service.name);

  private readonly region: string;

  constructor(@InjectConfig() private readonly config: TypedConfigService) {
    this.bucket = this.config.get('AWS_S3_BUCKET', { infer: true });
    this.region = this.config.get('AWS_REGION', { infer: true });
    this.endpoint = this.config.get('AWS_S3_ENDPOINT', { infer: true });
    this.forcePathStyle = this.config.get('AWS_S3_FORCE_PATH_STYLE', { infer: true });
    this.expiresInSeconds =
      this.config.get('AWS_S3_PRESIGNED_URL_EXPIRATION', { infer: true }) ?? 900; // Default to 15 minutes if not set

    this.client = new S3Client({
      credentials: {
        accessKeyId: this.config.get('AWS_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: this.config.get('AWS_SECRET_ACCESS_KEY', { infer: true }),
      },
      endpoint: this.endpoint,
      forcePathStyle: this.forcePathStyle === 'true',
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
   * Generate a presigned URL for uploading a file to S3
   */
  async getPresignedUploadUrl(
    options: PresignedUrlOptions,
  ): Promise<{ expiresInSeconds: number; uploadUrl: string }> {
    const { contentType, expiresIn, key, size } = options;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      ContentLength: size,
      ContentType: contentType,
      Key: key,
    });

    const expiresInSeconds = expiresIn ?? this.expiresInSeconds;

    const url = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });

    this.logger.debug(`Generated presigned upload URL for key: ${key}`);

    return { expiresInSeconds, uploadUrl: url };
  }
}
