import { UserRole, UserScope } from './constants';
import { UserPermissionSet } from './types';

export const NewUserPermissions: UserPermissionSet = Object.freeze({
  roles: Object.freeze([UserRole.USER]),
  scopes: Object.freeze([
    UserScope.ORDERS_READ,
    UserScope.ORDERS_WRITE,
    UserScope.FILES_WRITE,
    UserScope.PRODUCTS_READ,
  ]),
});

export const AdminPermissions: UserPermissionSet = Object.freeze({
  roles: Object.freeze([UserRole.ADMIN]),
  scopes: Object.freeze(Object.values(UserScope)),
});

export const SupportPermissions: UserPermissionSet = Object.freeze({
  roles: Object.freeze([UserRole.SUPPORT]),
  scopes: Object.freeze([
    UserScope.ORDERS_READ,
    UserScope.PAYMENTS_READ,
    UserScope.PRODUCTS_READ,
    UserScope.USERS_READ,
  ]),
});
