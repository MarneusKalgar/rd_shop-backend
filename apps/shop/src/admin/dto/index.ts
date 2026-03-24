import { IsArray, IsEnum } from 'class-validator';

import { UserRole, UserScope } from '@/auth/constants';

export class UpdateUserPermissionsDto {
  @IsArray()
  @IsEnum(UserRole, { each: true })
  roles: UserRole[];

  @IsArray()
  @IsEnum(UserScope, { each: true })
  scopes: UserScope[];
}

export class UpdateUserPermissionsResponseDto {
  message: string;
}
