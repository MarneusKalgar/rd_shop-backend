import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class EnvironmentVariables {
  @IsEnum(['shop', 'payments'])
  @IsString()
  APP: string;

  @IsOptional()
  @IsString()
  APP_LOG_LEVEL?: string;

  @IsString()
  DATABASE_PROVIDER: string;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  NODE_ENV: string;

  @IsString()
  PAYMENTS_GRPC_HOST: string;

  @IsNumber()
  PAYMENTS_GRPC_PORT: number;

  @IsOptional()
  @IsString()
  POSTGRES_DB?: string;

  @IsOptional()
  @IsString()
  POSTGRES_PASSWORD?: string;

  @IsOptional()
  @IsString()
  POSTGRES_USER?: string;
}
