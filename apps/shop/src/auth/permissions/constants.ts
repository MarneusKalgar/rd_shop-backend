export enum UserRole {
  ADMIN = 'admin',
  SUPPORT = 'support',
  USER = 'user',
}

export enum UserScope {
  FILES_WRITE = 'files:write',
  ORDERS_READ = 'orders:read',
  ORDERS_WRITE = 'orders:write',
  PAYMENTS_READ = 'payments:read',
  PAYMENTS_WRITE = 'payments:write',
  PRODUCTS_IMAGES_READ = 'products:images:read',
  PRODUCTS_IMAGES_WRITE = 'products:images:write',
  PRODUCTS_READ = 'products:read',
  PRODUCTS_WRITE = 'products:write',
  USERS_READ = 'users:read',
  USERS_WRITE = 'users:write',
}
