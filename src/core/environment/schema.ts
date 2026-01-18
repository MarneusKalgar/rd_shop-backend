import { IsNumber, IsOptional, IsString } from 'class-validator';

export class EnvironmentVariables {
  @IsString()
  NODE_ENV?: string;

  @IsOptional()
  @IsString()
  NODE_HOSTNAME?: string;

  @IsNumber()
  PORT: number;
}
