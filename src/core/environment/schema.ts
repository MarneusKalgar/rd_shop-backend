import { IsNumber, IsOptional, IsString } from 'class-validator';

export class EnvironmentVariables {
  @IsOptional()
  @IsString()
  APP_LOG_LEVEL?: string;

  @IsString()
  AWS_ACCESS_KEY_ID: string;

  @IsOptional()
  @IsString()
  AWS_CLOUDFRONT_URL?: string;

  @IsString()
  AWS_REGION: string;

  @IsString()
  AWS_S3_BUCKET: string;

  @IsOptional()
  @IsString()
  AWS_S3_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  AWS_S3_FORCE_PATH_STYLE?: string;

  @IsNumber()
  @IsOptional()
  AWS_S3_PRESIGNED_URL_DOWNLOAD_EXPIRATION?: number;

  @IsNumber()
  @IsOptional()
  AWS_S3_PRESIGNED_URL_EXPIRATION?: number;

  @IsString()
  AWS_SECRET_ACCESS_KEY: string;

  @IsNumber()
  @IsOptional()
  BCRYPT_SALT_ROUNDS?: number;

  @IsString()
  DATABASE_PROVIDER: string;

  @IsString()
  DATABASE_URL: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_EXPIRES_IN?: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsNumber()
  @IsOptional()
  MINIO_CONSOLE_PORT?: number;

  @IsNumber()
  @IsOptional()
  MINIO_PORT?: number;

  @IsString()
  NODE_ENV: string;

  @IsOptional()
  @IsString()
  NODE_HOSTNAME?: string;

  @IsNumber()
  PORT: number;

  @IsOptional()
  @IsString()
  POSTGRES_DB?: string;

  @IsOptional()
  @IsString()
  POSTGRES_PASSWORD?: string;

  @IsOptional()
  @IsString()
  POSTGRES_USER?: string;

  @IsString()
  RABBITMQ_HOST: string;

  @IsNumber()
  RABBITMQ_MANAGEMENT_PORT: number;

  @IsString()
  RABBITMQ_PASSWORD: string;

  @IsNumber()
  RABBITMQ_PORT: number;

  @IsNumber()
  @IsOptional()
  RABBITMQ_PREFETCH_COUNT?: number;

  @IsString()
  RABBITMQ_USER: string;

  @IsOptional()
  @IsString()
  RABBITMQ_VHOST: string;
}
