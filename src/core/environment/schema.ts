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
  AWS_S3_PRESIGNED_URL_EXPIRATION?: number;

  @IsString()
  AWS_SECRET_ACCESS_KEY: string;

  @IsString()
  DATABASE_PROVIDER: string;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  NODE_ENV: string;

  @IsOptional()
  @IsString()
  NODE_HOSTNAME?: string;

  @IsNumber()
  PORT: number;
}
