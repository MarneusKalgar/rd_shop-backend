import { IsEnum, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

import { NodeEnvironment } from '@/utils/env';

export class EnvironmentVariables {
  @IsOptional()
  @IsString()
  ALLOW_SEED_IN_PRODUCTION?: string;

  @IsEnum(['shop', 'payments'])
  @IsString()
  APP: string;

  @IsOptional()
  @IsString()
  APP_LOG_LEVEL?: string;

  @IsOptional()
  @IsString()
  APP_URL?: string;

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

  @IsOptional()
  @IsString()
  AWS_S3_PUBLIC_ENDPOINT?: string;

  @IsString()
  AWS_SECRET_ACCESS_KEY: string;

  @IsOptional()
  @IsString()
  AWS_SES_REGION?: string;

  @IsNumber()
  @IsOptional()
  BCRYPT_SALT_ROUNDS?: number;

  @IsOptional()
  @IsString()
  CORS_ALLOWED_ORIGINS?: string;

  @IsString()
  DATABASE_PROVIDER: string;

  @IsString()
  DATABASE_URL: string;

  @IsNumber()
  @IsOptional()
  DB_POOL_SIZE?: number;

  @IsNumber()
  @IsOptional()
  DB_SLOW_QUERY_THRESHOLD_MS?: number;

  @IsOptional()
  @IsString()
  EMAIL_VERIFICATION_EXPIRES_IN?: string;

  @IsNumber()
  @IsOptional()
  EVENT_LOOP_LAG_THRESHOLD_MS?: number;

  @IsOptional()
  @IsString()
  JWT_ACCESS_EXPIRES_IN?: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRES_IN?: string;

  @IsNumber()
  @IsOptional()
  MINIO_CONSOLE_PORT?: number;

  @IsNumber()
  @IsOptional()
  MINIO_PORT?: number;

  @IsEnum(NodeEnvironment)
  NODE_ENV: NodeEnvironment;

  @IsOptional()
  @IsString()
  NODE_HOSTNAME?: string;

  @IsOptional()
  @IsString()
  PASSWORD_RESET_EXPIRES_IN?: string;

  @IsString()
  PAYMENTS_GRPC_HOST: string;

  @IsNumber()
  PAYMENTS_GRPC_PORT: number;

  @IsNumber()
  @IsOptional()
  PAYMENTS_GRPC_TIMEOUT_MS?: number;

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

  @IsOptional()
  @IsString()
  RABBITMQ_DISABLE_PAYMENTS_AUTHORIZATION: string;

  @IsString()
  RABBITMQ_HOST: string;

  @IsNumber()
  @IsOptional()
  RABBITMQ_MANAGEMENT_PORT?: number;

  @IsString()
  RABBITMQ_PASSWORD: string;

  @IsNumber()
  RABBITMQ_PORT: number;

  @IsNumber()
  @IsOptional()
  RABBITMQ_PREFETCH_COUNT?: number;

  @IsNumber()
  @IsOptional()
  RABBITMQ_SIMULATE_DELAY?: number;

  @IsOptional()
  @IsString()
  RABBITMQ_SIMULATE_DUPLICATE_MESSAGE_ID?: string;

  @IsOptional()
  @IsString()
  RABBITMQ_SIMULATE_FAILURE?: string;

  @IsString()
  RABBITMQ_USER: string;

  @IsOptional()
  @IsString()
  RABBITMQ_VHOST?: string;

  @IsOptional()
  @IsString()
  SES_FROM_ADDRESS?: string;

  @IsOptional()
  @IsString()
  THROTTLE_SKIP?: string;

  @IsString()
  @MinLength(32)
  TOKEN_HMAC_SECRET: string;
}
