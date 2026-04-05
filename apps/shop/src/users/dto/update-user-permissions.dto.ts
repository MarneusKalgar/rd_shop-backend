import { IsArray, IsEnum } from 'class-validator';

import { UserRole, UserScope } from '@/auth/constants';

export class UpdateRolesDto {
  @IsArray()
  @IsEnum(UserRole, { each: true })
  roles: UserRole[];
}

export class UpdateScopesDto {
  @IsArray()
  @IsEnum(UserScope, { each: true })
  scopes: UserScope[];
}

export class UpdateUserPermissionsResponseDto {
  message: string;
}
