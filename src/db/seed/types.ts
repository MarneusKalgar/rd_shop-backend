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

export interface SeedUser {
  email: string;
  id?: string;
}
