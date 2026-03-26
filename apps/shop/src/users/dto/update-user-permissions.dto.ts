import { IsArray, IsDefined, IsEnum, IsOptional, ValidateIf } from 'class-validator';

import { UserRole, UserScope } from '@/auth/constants';

export class UpdateUserPermissionsDto {
  @IsArray()
  @IsDefined({ message: 'At least one of roles or scopes must be provided' })
  @IsEnum(UserRole, { each: true })
  @ValidateIf((o: UpdateUserPermissionsDto) => o.roles !== undefined || o.scopes === undefined)
  roles?: UserRole[];

  @IsArray()
  @IsEnum(UserScope, { each: true })
  @IsOptional()
  scopes?: UserScope[];
}

export class UpdateUserPermissionsResponseDto {
  message: string;
}
