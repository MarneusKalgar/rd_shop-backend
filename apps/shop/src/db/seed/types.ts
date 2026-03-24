export interface SeedOrder {
  id: string;
  items: SeedOrderItem[];
  userEmail: string;
}

export interface SeedOrderItem {
  id: string;
  productTitle: string;
  quantity: number;
}

export interface SeedProduct {
  id: string;
  isActive: boolean;
  price: string;
  stock: number;
  title: string;
}

import { UserRole, UserScope } from '@/auth/permissions';

export interface SeedUser {
  email: string;
  id?: string;
  roles?: UserRole[];
  scopes?: UserScope[];
}
