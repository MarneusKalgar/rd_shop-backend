import { AdminPermissions, NewUserPermissions, SupportPermissions } from './definitions';
import { UserPermissionSet } from './types';

export const UserPermissions = Object.freeze({
  Admin: AdminPermissions,
  NewUser: NewUserPermissions,
  Support: SupportPermissions,
} satisfies Record<string, UserPermissionSet>);
