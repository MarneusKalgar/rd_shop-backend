import { UserRole, UserScope } from '@/auth/permissions';

import { SeedOrder, SeedProduct, SeedUser } from './types';

/**
 * Seed data for users table
 */
export const seedUsers: SeedUser[] = [
  {
    email: 'john.doe@example.com',
    roles: [UserRole.ADMIN],
    scopes: [
      UserScope.ORDERS_READ,
      UserScope.ORDERS_WRITE,
      UserScope.PRODUCTS_READ,
      UserScope.PRODUCTS_WRITE,
      UserScope.PRODUCTS_IMAGES_WRITE,
      UserScope.PRODUCTS_IMAGES_READ,
    ],
  },
  {
    email: 'jane.smith@example.com',
    roles: [UserRole.SUPPORT],
    scopes: [
      UserScope.ORDERS_READ,
      UserScope.PAYMENTS_READ,
      UserScope.PAYMENTS_WRITE,
      UserScope.PRODUCTS_IMAGES_WRITE,
    ],
  },
  {
    email: 'bob.wilson@example.com',
    roles: [UserRole.USER],
    scopes: [
      UserScope.ORDERS_READ,
      UserScope.ORDERS_WRITE,
      UserScope.FILES_WRITE,
      UserScope.PRODUCTS_IMAGES_READ,
    ],
  },
  {
    email: 'alice.brown@example.com',
    roles: [UserRole.SUPPORT],
    scopes: [UserScope.ORDERS_READ, UserScope.PAYMENTS_READ, UserScope.PAYMENTS_WRITE],
  },
  {
    email: 'charlie.davis@example.com',
    roles: [UserRole.USER],
    scopes: [
      UserScope.ORDERS_READ,
      UserScope.ORDERS_WRITE,
      UserScope.FILES_WRITE,
      UserScope.PRODUCTS_IMAGES_READ,
    ],
  },
];

/**
 * Seed data for products table
 */
export const seedProducts: SeedProduct[] = [
  {
    id: '650e8400-e29b-41d4-a716-446655440001',
    isActive: true,
    price: '299.99',
    stock: 100,
    title: 'Wireless Bluetooth Headphones',
  },
  {
    id: '650e8400-e29b-41d4-a716-446655440002',
    isActive: true,
    price: '899.99',
    stock: 50,
    title: 'Smart Watch Pro',
  },
  {
    id: '650e8400-e29b-41d4-a716-446655440003',
    isActive: true,
    price: '1299.99',
    stock: 25,
    title: 'Gaming Laptop 15"',
  },
  {
    id: '650e8400-e29b-41d4-a716-446655440004',
    isActive: true,
    price: '49.99',
    stock: 200,
    title: 'USB-C Charging Cable',
  },
  {
    id: '650e8400-e29b-41d4-a716-446655440005',
    isActive: true,
    price: '199.99',
    stock: 75,
    title: 'Mechanical Keyboard RGB',
  },
  {
    id: '650e8400-e29b-41d4-a716-446655440006',
    isActive: true,
    price: '79.99',
    stock: 150,
    title: 'Wireless Gaming Mouse',
  },
  {
    id: '650e8400-e29b-41d4-a716-446655440007',
    isActive: true,
    price: '399.99',
    stock: 40,
    title: '27" 4K Monitor',
  },
  {
    id: '650e8400-e29b-41d4-a716-446655440008',
    isActive: true,
    price: '29.99',
    stock: 300,
    title: 'Phone Case Premium',
  },
  {
    id: '650e8400-e29b-41d4-a716-446655440009',
    isActive: true,
    price: '149.99',
    stock: 60,
    title: 'Portable SSD 1TB',
  },
  {
    id: '650e8400-e29b-41d4-a716-446655440010',
    isActive: true,
    price: '599.99',
    stock: 80,
    title: 'Noise Cancelling Headphones',
  },
  {
    id: '650e8400-e29b-41d4-a716-446655440011',
    isActive: false,
    price: '999.99',
    stock: 0,
    title: 'Drone with 4K Camera',
  },
  {
    id: '650e8400-e29b-41d4-a716-446655440012',
    isActive: true,
    price: '24.99',
    stock: 250,
    title: 'Screen Protector Pack',
  },
];

/**
 * Seed data for orders and order_items tables
 */
export const seedOrders: SeedOrder[] = [
  {
    id: '750e8400-e29b-41d4-a716-446655440001',
    items: [
      {
        id: '850e8400-e29b-41d4-a716-446655440001',
        productTitle: 'Wireless Bluetooth Headphones',
        quantity: 1,
      },
      {
        id: '850e8400-e29b-41d4-a716-446655440002',
        productTitle: 'USB-C Charging Cable',
        quantity: 2,
      },
    ],
    userEmail: 'john.doe@example.com',
  },
  {
    id: '750e8400-e29b-41d4-a716-446655440002',
    items: [
      {
        id: '850e8400-e29b-41d4-a716-446655440003',
        productTitle: 'Gaming Laptop 15"',
        quantity: 1,
      },
      {
        id: '850e8400-e29b-41d4-a716-446655440004',
        productTitle: 'Wireless Gaming Mouse',
        quantity: 1,
      },
      {
        id: '850e8400-e29b-41d4-a716-446655440005',
        productTitle: 'Mechanical Keyboard RGB',
        quantity: 1,
      },
    ],
    userEmail: 'jane.smith@example.com',
  },
  {
    id: '750e8400-e29b-41d4-a716-446655440003',
    items: [
      {
        id: '850e8400-e29b-41d4-a716-446655440006',
        productTitle: 'Smart Watch Pro',
        quantity: 1,
      },
    ],
    userEmail: 'bob.wilson@example.com',
  },
  {
    id: '750e8400-e29b-41d4-a716-446655440004',
    items: [
      {
        id: '850e8400-e29b-41d4-a716-446655440007',
        productTitle: 'Phone Case Premium',
        quantity: 3,
      },
      {
        id: '850e8400-e29b-41d4-a716-446655440008',
        productTitle: 'Screen Protector Pack',
        quantity: 2,
      },
    ],
    userEmail: 'alice.brown@example.com',
  },
  {
    id: '750e8400-e29b-41d4-a716-446655440005',
    items: [
      {
        id: '850e8400-e29b-41d4-a716-446655440009',
        productTitle: '27" 4K Monitor',
        quantity: 2,
      },
      {
        id: '850e8400-e29b-41d4-a716-446655440010',
        productTitle: 'USB-C Charging Cable',
        quantity: 4,
      },
    ],
    userEmail: 'charlie.davis@example.com',
  },
  {
    id: '750e8400-e29b-41d4-a716-446655440006',
    items: [
      {
        id: '850e8400-e29b-41d4-a716-446655440011',
        productTitle: 'Noise Cancelling Headphones',
        quantity: 1,
      },
      {
        id: '850e8400-e29b-41d4-a716-446655440012',
        productTitle: 'Portable SSD 1TB',
        quantity: 1,
      },
    ],
    userEmail: 'john.doe@example.com',
  },
  {
    id: '750e8400-e29b-41d4-a716-446655440007',
    items: [
      {
        id: '850e8400-e29b-41d4-a716-446655440013',
        productTitle: 'Mechanical Keyboard RGB',
        quantity: 2,
      },
    ],
    userEmail: 'jane.smith@example.com',
  },
  {
    id: '750e8400-e29b-41d4-a716-446655440008',
    items: [
      {
        id: '850e8400-e29b-41d4-a716-446655440014',
        productTitle: 'Wireless Gaming Mouse',
        quantity: 1,
      },
      {
        id: '850e8400-e29b-41d4-a716-446655440015',
        productTitle: 'Phone Case Premium',
        quantity: 1,
      },
    ],
    userEmail: 'bob.wilson@example.com',
  },
];
