import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const DEFAULT_USERS_LIMIT = 10;
export const MAX_USERS_LIMIT = 100;

export class FindUsersDto {
  @IsOptional()
  @IsString()
  @IsUUID()
  cursor?: string;

  @IsInt()
  @IsOptional()
  @Max(MAX_USERS_LIMIT)
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
