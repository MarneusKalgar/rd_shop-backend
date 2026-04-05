import { UserRole, UserScope } from './constants';

export interface UserPermissionSet {
  readonly roles: readonly UserRole[];
  readonly scopes: readonly UserScope[];
}
