import { IsNumber, IsOptional, IsString } from 'class-validator';

export class EnvironmentVariables {
  @IsNumber()
  PORT: number;

  @IsString()
  NODE_ENV?: string;

  @IsString()
  @IsOptional()
  NODE_HOSTNAME?: string;
}
