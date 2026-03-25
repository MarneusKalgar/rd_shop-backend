import { UserRole, UserScope } from '@/auth/permissions';
import { ProductCategory } from '@/products/constants';
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
  brand: string;
  category: ProductCategory;
  country: string;
  description: string;
  id: string;
  isActive: boolean;
  price: string;
  stock: number;
  title: string;
}

export interface SeedUser {
  email: string;
  id?: string;
  roles?: UserRole[];
  scopes?: UserScope[];
}
