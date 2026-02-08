import { IsNumber, IsOptional, IsString } from 'class-validator';

export class EnvironmentVariables {
  @IsOptional()
  @IsString()
  APP_LOG_LEVEL?: string;

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
