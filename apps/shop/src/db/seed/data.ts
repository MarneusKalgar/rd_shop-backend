import { UserRole, UserScope } from '@/auth/permissions';
import { ProductCategory } from '@/products/constants';

import { SeedOrder, SeedProduct, SeedReview, SeedUser } from './types';

/**
 * Seed data for users table
 */
export const seedUsers: SeedUser[] = [
  {
    city: 'New York',
    country: 'US',
    email: 'john.doe@example.com',
    firstName: 'John',
    lastName: 'Doe',
    phone: '+12125550101',
    postcode: '10001',
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
    city: 'San Francisco',
    country: 'US',
    email: 'jane.smith@example.com',
    firstName: 'Jane',
    lastName: 'Smith',
    phone: '+14155550102',
    postcode: '94102',
    roles: [UserRole.SUPPORT],
    scopes: [
      UserScope.ORDERS_READ,
      UserScope.PAYMENTS_READ,
      UserScope.PAYMENTS_WRITE,
      UserScope.PRODUCTS_IMAGES_WRITE,
    ],
  },
  {
    city: 'Chicago',
    country: 'US',
    email: 'bob.wilson@example.com',
    firstName: 'Bob',
    lastName: 'Wilson',
    phone: '+13125550103',
    postcode: '60601',
    roles: [UserRole.USER],
    scopes: [
      UserScope.ORDERS_READ,
      UserScope.ORDERS_WRITE,
      UserScope.FILES_WRITE,
      UserScope.PRODUCTS_IMAGES_READ,
    ],
  },
  {
    city: 'London',
    country: 'GB',
    email: 'alice.brown@example.com',
    firstName: 'Alice',
    lastName: 'Brown',
    phone: '+442075550104',
    postcode: 'EC1A 1BB',
    roles: [UserRole.SUPPORT],
    scopes: [UserScope.ORDERS_READ, UserScope.PAYMENTS_READ, UserScope.PAYMENTS_WRITE],
  },
  {
    city: 'Austin',
    country: 'US',
    email: 'charlie.davis@example.com',
    firstName: 'Charlie',
    lastName: 'Davis',
    phone: '+15125550105',
    postcode: '78701',
    roles: [UserRole.USER],
    scopes: [
      UserScope.ORDERS_READ,
      UserScope.ORDERS_WRITE,
      UserScope.FILES_WRITE,
      UserScope.PRODUCTS_IMAGES_READ,
    ],
  },
  {
    city: 'Madrid',
    country: 'ES',
    email: 'eva.martinez@example.com',
    firstName: 'Eva',
    lastName: 'Martinez',
    phone: '+34915550106',
    postcode: '28001',
    roles: [UserRole.USER],
    scopes: [
      UserScope.ORDERS_READ,
      UserScope.ORDERS_WRITE,
      UserScope.FILES_WRITE,
      UserScope.PRODUCTS_IMAGES_READ,
    ],
  },
  {
    city: 'Berlin',
    country: 'DE',
    email: 'frank.miller@example.com',
    firstName: 'Frank',
    lastName: 'Miller',
    phone: '+493015550107',
    postcode: '10115',
    roles: [UserRole.USER],
    scopes: [
      UserScope.ORDERS_READ,
      UserScope.ORDERS_WRITE,
      UserScope.FILES_WRITE,
      UserScope.PRODUCTS_IMAGES_READ,
    ],
  },
  {
    city: 'Seoul',
    country: 'KR',
    email: 'grace.lee@example.com',
    firstName: 'Grace',
    lastName: 'Lee',
    phone: '+82215550108',
    postcode: '04524',
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
  // ── Original 12 (IDs preserved, enriched with new fields) ─────────────────
  {
    brand: 'Sony',
    category: ProductCategory.AUDIO,
    country: 'JP',
    description:
      'Premium wireless headphones with 30-hour battery life and dual-device connectivity.',
    id: '650e8400-e29b-41d4-a716-446655440001',
    isActive: true,
    price: '299.99',
    stock: 100,
    title: 'Wireless Bluetooth Headphones',
  },
  {
    brand: 'Apple',
    category: ProductCategory.WEARABLES,
    country: 'US',
    description: 'Advanced smartwatch with health monitoring, GPS, and always-on display.',
    id: '650e8400-e29b-41d4-a716-446655440002',
    isActive: true,
    price: '899.99',
    stock: 50,
    title: 'Smart Watch Pro',
  },
  {
    brand: 'ASUS',
    category: ProductCategory.LAPTOPS,
    country: 'TW',
    description: 'High-performance gaming laptop with RTX 4070, 144Hz display and 32GB RAM.',
    id: '650e8400-e29b-41d4-a716-446655440003',
    isActive: true,
    price: '1299.99',
    stock: 25,
    title: 'Gaming Laptop 15"',
  },
  {
    brand: 'Anker',
    category: ProductCategory.ACCESSORIES,
    country: 'CN',
    description:
      'Braided nylon USB-C cable supporting 100W fast charging and 10Gbps data transfer.',
    id: '650e8400-e29b-41d4-a716-446655440004',
    isActive: true,
    price: '49.99',
    stock: 200,
    title: 'USB-C Charging Cable',
  },
  {
    brand: 'Corsair',
    category: ProductCategory.PERIPHERALS,
    country: 'US',
    description:
      'Tactile mechanical keyboard with Cherry MX switches and customizable RGB backlighting.',
    id: '650e8400-e29b-41d4-a716-446655440005',
    isActive: true,
    price: '199.99',
    stock: 75,
    title: 'Mechanical Keyboard RGB',
  },
  {
    brand: 'Logitech',
    category: ProductCategory.PERIPHERALS,
    country: 'CH',
    description: 'Lightweight wireless gaming mouse with HERO sensor, 25K DPI and 70h battery.',
    id: '650e8400-e29b-41d4-a716-446655440006',
    isActive: true,
    price: '79.99',
    stock: 150,
    title: 'Wireless Gaming Mouse',
  },
  {
    brand: 'LG',
    category: ProductCategory.MONITORS,
    country: 'KR',
    description: '27-inch 4K IPS display with HDR600, USB-C 90W PD and ergonomic stand.',
    id: '650e8400-e29b-41d4-a716-446655440007',
    isActive: true,
    price: '399.99',
    stock: 40,
    title: '27" 4K Monitor',
  },
  {
    brand: 'Spigen',
    category: ProductCategory.ACCESSORIES,
    country: 'KR',
    description: 'Military-grade drop protection phone case with raised bezel and slim profile.',
    id: '650e8400-e29b-41d4-a716-446655440008',
    isActive: true,
    price: '29.99',
    stock: 300,
    title: 'Phone Case Premium',
  },
  {
    brand: 'Samsung',
    category: ProductCategory.STORAGE,
    country: 'KR',
    description: 'Compact portable SSD with up to 1,050 MB/s read speed and USB 3.2 Gen 2.',
    id: '650e8400-e29b-41d4-a716-446655440009',
    isActive: true,
    price: '149.99',
    stock: 60,
    title: 'Portable SSD 1TB',
  },
  {
    brand: 'Sony',
    category: ProductCategory.AUDIO,
    country: 'JP',
    description:
      'Industry-leading noise cancellation headphones with 30h battery and LDAC support.',
    id: '650e8400-e29b-41d4-a716-446655440010',
    isActive: true,
    price: '599.99',
    stock: 80,
    title: 'Noise Cancelling Headphones',
  },
  {
    brand: 'DJI',
    category: ProductCategory.CAMERAS,
    country: 'CN',
    description: 'Consumer drone with 4K/60fps camera, 3-axis gimbal and 34-minute flight time.',
    id: '650e8400-e29b-41d4-a716-446655440011',
    isActive: false,
    price: '999.99',
    stock: 0,
    title: 'Drone with 4K Camera',
  },
  {
    brand: 'Belkin',
    category: ProductCategory.ACCESSORIES,
    country: 'US',
    description: 'Anti-scratch tempered glass screen protectors, 3-pack with easy alignment tool.',
    id: '650e8400-e29b-41d4-a716-446655440012',
    isActive: true,
    price: '24.99',
    stock: 250,
    title: 'Screen Protector Pack',
  },
  // ── Laptops ───────────────────────────────────────────────────────────────
  {
    brand: 'Apple',
    category: ProductCategory.LAPTOPS,
    country: 'US',
    description:
      'Ultra-thin laptop powered by M3 chip with 18-hour battery and Liquid Retina display.',
    id: '650e8400-e29b-41d4-a716-446655440013',
    isActive: true,
    price: '1299.99',
    stock: 30,
    title: 'MacBook Air M3',
  },
  {
    brand: 'Dell',
    category: ProductCategory.LAPTOPS,
    country: 'US',
    description: 'Premium 15.6" OLED laptop with Intel Core Ultra 9, 32GB RAM and 1TB NVMe SSD.',
    id: '650e8400-e29b-41d4-a716-446655440014',
    isActive: true,
    price: '1499.99',
    stock: 20,
    title: 'Dell XPS 15',
  },
  {
    brand: 'Lenovo',
    category: ProductCategory.LAPTOPS,
    country: 'CN',
    description:
      'Business ultrabook with military-grade durability, 14" IPS screen and 12th Gen Intel Core.',
    id: '650e8400-e29b-41d4-a716-446655440015',
    isActive: true,
    price: '1199.99',
    stock: 15,
    title: 'Lenovo ThinkPad X1 Carbon',
  },
  {
    brand: 'HP',
    category: ProductCategory.LAPTOPS,
    country: 'US',
    description:
      '2-in-1 convertible laptop with OLED touchscreen, Intel Evo platform and HP Sure View.',
    id: '650e8400-e29b-41d4-a716-446655440016',
    isActive: true,
    price: '1099.99',
    stock: 25,
    title: 'HP Spectre x360 14"',
  },
  // ── Smartphones ───────────────────────────────────────────────────────────
  {
    brand: 'Apple',
    category: ProductCategory.SMARTPHONES,
    country: 'US',
    description: 'Flagship iPhone with A17 Pro chip, 48MP camera system and titanium design.',
    id: '650e8400-e29b-41d4-a716-446655440017',
    isActive: true,
    price: '999.99',
    stock: 50,
    title: 'iPhone 15 Pro',
  },
  {
    brand: 'Samsung',
    category: ProductCategory.SMARTPHONES,
    country: 'KR',
    description: 'Android flagship with Galaxy AI, 200MP camera and 5000mAh battery.',
    id: '650e8400-e29b-41d4-a716-446655440018',
    isActive: true,
    price: '899.99',
    stock: 45,
    title: 'Samsung Galaxy S24 Ultra',
  },
  {
    brand: 'Google',
    category: ProductCategory.SMARTPHONES,
    country: 'US',
    description:
      'Pure Android experience with Tensor G3 chip and exceptional computational photography.',
    id: '650e8400-e29b-41d4-a716-446655440019',
    isActive: true,
    price: '699.99',
    stock: 35,
    title: 'Google Pixel 8 Pro',
  },
  {
    brand: 'OnePlus',
    category: ProductCategory.SMARTPHONES,
    country: 'CN',
    description: 'Flagship killer with Snapdragon 8 Gen 3, 100W fast charging and 6.82" AMOLED.',
    id: '650e8400-e29b-41d4-a716-446655440020',
    isActive: true,
    price: '549.99',
    stock: 40,
    title: 'OnePlus 12',
  },
  // ── Tablets ───────────────────────────────────────────────────────────────
  {
    brand: 'Apple',
    category: ProductCategory.TABLETS,
    country: 'US',
    description:
      'Most advanced iPad with M4 chip, Ultra Retina XDR OLED display and Apple Pencil Pro.',
    id: '650e8400-e29b-41d4-a716-446655440021',
    isActive: true,
    price: '1099.99',
    stock: 20,
    title: 'iPad Pro 13"',
  },
  {
    brand: 'Samsung',
    category: ProductCategory.TABLETS,
    country: 'KR',
    description: 'Premium Android tablet with Dynamic AMOLED 2X display, S Pen and DeX mode.',
    id: '650e8400-e29b-41d4-a716-446655440022',
    isActive: true,
    price: '799.99',
    stock: 18,
    title: 'Samsung Galaxy Tab S9 Ultra',
  },
  {
    brand: 'Microsoft',
    category: ProductCategory.TABLETS,
    country: 'US',
    description:
      'Versatile 2-in-1 tablet with Intel Core i7, 16GB RAM and full Windows 11 experience.',
    id: '650e8400-e29b-41d4-a716-446655440023',
    isActive: true,
    price: '1299.99',
    stock: 12,
    title: 'Microsoft Surface Pro 10',
  },
  // ── Audio ─────────────────────────────────────────────────────────────────
  {
    brand: 'Apple',
    category: ProductCategory.AUDIO,
    country: 'US',
    description:
      'Next-generation ANC earbuds with Adaptive Audio, Conversation Awareness and H2 chip.',
    id: '650e8400-e29b-41d4-a716-446655440024',
    isActive: true,
    price: '249.99',
    stock: 100,
    title: 'AirPods Pro 2nd Gen',
  },
  {
    brand: 'Bose',
    category: ProductCategory.AUDIO,
    country: 'US',
    description:
      'Over-ear headphones with world-class noise cancellation and 24-hour battery life.',
    id: '650e8400-e29b-41d4-a716-446655440025',
    isActive: true,
    price: '329.99',
    stock: 55,
    title: 'Bose QuietComfort 45',
  },
  // ── Wearables ─────────────────────────────────────────────────────────────
  {
    brand: 'Apple',
    category: ProductCategory.WEARABLES,
    country: 'US',
    description: 'Rugged adventure watch with 2000-nit display, 60-hour battery and precision GPS.',
    id: '650e8400-e29b-41d4-a716-446655440026',
    isActive: true,
    price: '799.99',
    stock: 30,
    title: 'Apple Watch Ultra 2',
  },
  {
    brand: 'Samsung',
    category: ProductCategory.WEARABLES,
    country: 'KR',
    description: 'Stylish smartwatch with sleep coaching, BioActive Sensor and Google Wear OS.',
    id: '650e8400-e29b-41d4-a716-446655440027',
    isActive: true,
    price: '299.99',
    stock: 50,
    title: 'Samsung Galaxy Watch 6 Classic',
  },
  {
    brand: 'Garmin',
    category: ProductCategory.WEARABLES,
    country: 'US',
    description:
      'Premium multisport GPS watch with solar charging, 14-day battery and topographic maps.',
    id: '650e8400-e29b-41d4-a716-446655440028',
    isActive: true,
    price: '699.99',
    stock: 25,
    title: 'Garmin Fenix 7 Solar',
  },
  // ── Monitors ──────────────────────────────────────────────────────────────
  {
    brand: 'Dell',
    category: ProductCategory.MONITORS,
    country: 'US',
    description:
      '32" IPS 4K USB-C monitor with 99% sRGB, factory colour calibration and VESA mount.',
    id: '650e8400-e29b-41d4-a716-446655440029',
    isActive: true,
    price: '799.99',
    stock: 10,
    title: 'Dell UltraSharp 32" 4K',
  },
  {
    brand: 'Samsung',
    category: ProductCategory.MONITORS,
    country: 'KR',
    description:
      'Dual QHD 49" curved gaming monitor with 240Hz refresh rate and 1ms response time.',
    id: '650e8400-e29b-41d4-a716-446655440030',
    isActive: true,
    price: '1199.99',
    stock: 8,
    title: 'Samsung Odyssey G9 49"',
  },
  {
    brand: 'LG',
    category: ProductCategory.MONITORS,
    country: 'KR',
    description: '34" UltraWide IPS display with WQHD, HDR10 and Thunderbolt 4 connectivity.',
    id: '650e8400-e29b-41d4-a716-446655440031',
    isActive: true,
    price: '599.99',
    stock: 15,
    title: 'LG UltraWide 34" QHD',
  },
  // ── Storage ───────────────────────────────────────────────────────────────
  {
    brand: 'Samsung',
    category: ProductCategory.STORAGE,
    country: 'KR',
    description: 'Portable NVMe SSD with 2,000 MB/s read, IP65 rating and included USB-C cable.',
    id: '650e8400-e29b-41d4-a716-446655440032',
    isActive: true,
    price: '199.99',
    stock: 70,
    title: 'Samsung T9 Portable SSD 2TB',
  },
  {
    brand: 'WD',
    category: ProductCategory.STORAGE,
    country: 'US',
    description:
      'Compact portable hard drive with USB 3.0, password protection and hardware encryption.',
    id: '650e8400-e29b-41d4-a716-446655440033',
    isActive: true,
    price: '119.99',
    stock: 80,
    title: 'WD My Passport 4TB',
  },
  // ── Peripherals ───────────────────────────────────────────────────────────
  {
    brand: 'Logitech',
    category: ProductCategory.PERIPHERALS,
    country: 'CH',
    description:
      'Advanced wireless keyboard with Smart Illumination, multi-device Bluetooth and USB-C.',
    id: '650e8400-e29b-41d4-a716-446655440034',
    isActive: true,
    price: '109.99',
    stock: 90,
    title: 'Logitech MX Keys Advanced',
  },
  {
    brand: 'Razer',
    category: ProductCategory.PERIPHERALS,
    country: 'US',
    description: 'Ultra-lightweight gaming mouse at 59g with Focus Pro 30K optical sensor.',
    id: '650e8400-e29b-41d4-a716-446655440035',
    isActive: true,
    price: '89.99',
    stock: 75,
    title: 'Razer DeathAdder V3',
  },
  {
    brand: 'Elgato',
    category: ProductCategory.PERIPHERALS,
    country: 'DE',
    description:
      '15-key customisable LCD stream controller for live production and content creation.',
    id: '650e8400-e29b-41d4-a716-446655440036',
    isActive: true,
    price: '149.99',
    stock: 35,
    title: 'Elgato Stream Deck MK.2',
  },
  // ── Cameras ───────────────────────────────────────────────────────────────
  {
    brand: 'Sony',
    category: ProductCategory.CAMERAS,
    country: 'JP',
    description:
      'Full-frame mirrorless camera with 33MP BSI-CMOS sensor, 4K 120fps and dual card slots.',
    id: '650e8400-e29b-41d4-a716-446655440037',
    isActive: true,
    price: '2499.99',
    stock: 8,
    title: 'Sony Alpha A7 IV',
  },
  {
    brand: 'Canon',
    category: ProductCategory.CAMERAS,
    country: 'JP',
    description:
      'Hybrid full-frame mirrorless with 24.2MP CMOS, 6K RAW video and in-body stabilisation.',
    id: '650e8400-e29b-41d4-a716-446655440038',
    isActive: true,
    price: '2499.99',
    stock: 6,
    title: 'Canon EOS R6 Mark II',
  },
  {
    brand: 'GoPro',
    category: ProductCategory.CAMERAS,
    country: 'US',
    description:
      'Action camera with HyperSmooth 6.0 stabilisation, 5.3K video and waterproof to 10m.',
    id: '650e8400-e29b-41d4-a716-446655440039',
    isActive: true,
    price: '399.99',
    stock: 45,
    title: 'GoPro HERO12 Black',
  },
  // ── Accessories ───────────────────────────────────────────────────────────
  {
    brand: 'Apple',
    category: ProductCategory.ACCESSORIES,
    country: 'US',
    description:
      'Slim MagSafe wallet with Find My support that attaches magnetically to any MagSafe case.',
    id: '650e8400-e29b-41d4-a716-446655440040',
    isActive: true,
    price: '49.99',
    stock: 200,
    title: 'MagSafe Wallet',
  },
  {
    brand: 'CalDigit',
    category: ProductCategory.ACCESSORIES,
    country: 'US',
    description: 'Thunderbolt 4 hub with 18 ports, 98W host charging and 40Gbps bandwidth.',
    id: '650e8400-e29b-41d4-a716-446655440041',
    isActive: true,
    price: '199.99',
    stock: 30,
    title: 'CalDigit Thunderbolt 4 Hub',
  },
  {
    brand: 'Rain Design',
    category: ProductCategory.ACCESSORIES,
    country: 'US',
    description:
      'Aluminium adjustable laptop stand compatible with 11"–17" laptops, foldable for travel.',
    id: '650e8400-e29b-41d4-a716-446655440042',
    isActive: true,
    price: '79.99',
    stock: 120,
    title: 'Laptop Stand Adjustable',
  },
  // ── Other ─────────────────────────────────────────────────────────────────
  {
    brand: 'Amazon',
    category: ProductCategory.OTHER,
    country: 'US',
    description:
      'Centralised smart home hub compatible with Alexa, Matter, Zigbee and Z-Wave devices.',
    id: '650e8400-e29b-41d4-a716-446655440043',
    isActive: true,
    price: '99.99',
    stock: 60,
    title: 'Smart Home Hub',
  },
  {
    brand: 'Mophie',
    category: ProductCategory.OTHER,
    country: 'US',
    description: '15W Universal Wireless Charging Pad compatible with Qi and MagSafe devices.',
    id: '650e8400-e29b-41d4-a716-446655440044',
    isActive: true,
    price: '39.99',
    stock: 150,
    title: 'Wireless Charging Pad 15W',
  },
  {
    brand: 'EZOPower',
    category: ProductCategory.OTHER,
    country: 'CN',
    description: 'Cable management kit with velcro straps, zip ties, cable sleeves and desk clips.',
    id: '650e8400-e29b-41d4-a716-446655440045',
    isActive: true,
    price: '19.99',
    stock: 300,
    title: 'Cable Management Kit',
  },
  {
    brand: 'SanDisk',
    category: ProductCategory.STORAGE,
    country: 'US',
    description:
      'High-speed microSDXC card for 4K content, up to 200 MB/s read and A2 app performance.',
    id: '650e8400-e29b-41d4-a716-446655440046',
    isActive: true,
    price: '49.99',
    stock: 200,
    title: 'SanDisk Extreme Pro microSD 256GB',
  },
  {
    brand: 'Fitbit',
    category: ProductCategory.WEARABLES,
    country: 'US',
    description: 'Advanced health smartwatch with ECG, stress management score and 6+ day battery.',
    id: '650e8400-e29b-41d4-a716-446655440047',
    isActive: true,
    price: '249.99',
    stock: 40,
    title: 'Fitbit Sense 2',
  },
  {
    brand: 'Focusrite',
    category: ProductCategory.AUDIO,
    country: 'GB',
    description:
      'Professional 2-in/2-out USB-C audio interface with 24-bit/192kHz converters and Air mode.',
    id: '650e8400-e29b-41d4-a716-446655440048',
    isActive: true,
    price: '179.99',
    stock: 35,
    title: 'Focusrite Scarlett 2i2 4th Gen',
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

/**
 * Seed data for product_reviews table.
 * 42 of 48 products (87.5%) have 1–3 reviews each; only UserRole.USER reviewers.
 * Products 043-048 have no reviews.
 */
export const seedReviews: SeedReview[] = [
  // ── Product 001: Wireless Bluetooth Headphones (1 review) ─────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440001',
    productId: '650e8400-e29b-41d4-a716-446655440001',
    rating: 5,
    text: 'Excellent sound quality and the battery life is impressive. Comfortable for long listening sessions.',
    userEmail: 'bob.wilson@example.com',
  },

  // ── Product 002: Smart Watch Pro (1 review) ────────────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440002',
    productId: '650e8400-e29b-41d4-a716-446655440002',
    rating: 4,
    text: 'Great smartwatch with accurate health tracking. The always-on display is a battery drain though.',
    userEmail: 'charlie.davis@example.com',
  },

  // ── Product 003: Gaming Laptop 15" (1 review) ─────────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440003',
    productId: '650e8400-e29b-41d4-a716-446655440003',
    rating: 5,
    text: 'Handles all my games at ultra settings. Runs hot under load but the cooling system keeps it manageable.',
    userEmail: 'eva.martinez@example.com',
  },

  // ── Product 004: USB-C Charging Cable (1 review) ──────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440004',
    productId: '650e8400-e29b-41d4-a716-446655440004',
    rating: 4,
    text: 'Charges fast and the cable feels durable. Good value for the price.',
    userEmail: 'frank.miller@example.com',
  },

  // ── Product 005: Mechanical Keyboard RGB (1 review) ───────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440005',
    productId: '650e8400-e29b-41d4-a716-446655440005',
    rating: 5,
    text: 'The key feel is satisfying and the RGB lighting is highly customizable. A must-have for any desk setup.',
    userEmail: 'grace.lee@example.com',
  },

  // ── Product 006: Wireless Gaming Mouse (1 review) ─────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440006',
    productId: '650e8400-e29b-41d4-a716-446655440006',
    rating: 4,
    text: 'Zero noticeable lag in wireless mode. Sensor is precise and the battery lasts two weeks.',
    userEmail: 'bob.wilson@example.com',
  },

  // ── Product 007: 27" 4K Monitor (1 review) ────────────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440007',
    productId: '650e8400-e29b-41d4-a716-446655440007',
    rating: 5,
    text: 'Colors are vivid and text is razor-sharp. Great for both design work and gaming.',
    userEmail: 'charlie.davis@example.com',
  },

  // ── Product 008: Phone Case Premium (1 review) ────────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440008',
    productId: '650e8400-e29b-41d4-a716-446655440008',
    rating: 3,
    text: 'Decent protection but feels a bit bulky. Buttons are slightly stiff to press.',
    userEmail: 'eva.martinez@example.com',
  },

  // ── Product 009: Portable SSD 1TB (1 review) ──────────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440009',
    productId: '650e8400-e29b-41d4-a716-446655440009',
    rating: 5,
    text: 'Blazing fast read/write speeds. Fits in my pocket and survived being dropped. Highly recommend.',
    userEmail: 'frank.miller@example.com',
  },

  // ── Product 010: Noise Cancelling Headphones (1 review) ───────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440010',
    productId: '650e8400-e29b-41d4-a716-446655440010',
    rating: 5,
    text: 'Best noise cancellation I have ever experienced. Commutes are so much more pleasant now.',
    userEmail: 'grace.lee@example.com',
  },

  // ── Product 011: Drone with 4K Camera (1 review) ──────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440011',
    productId: '650e8400-e29b-41d4-a716-446655440011',
    rating: 4,
    text: 'Stable in moderate wind and the footage is smooth. Takes some practice to master but worth it.',
    userEmail: 'bob.wilson@example.com',
  },

  // ── Product 012: Screen Protector Pack (1 review) ─────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440012',
    productId: '650e8400-e29b-41d4-a716-446655440012',
    rating: 3,
    text: 'Does the job but application was tricky. One of the three had a dust bubble I could not remove.',
    userEmail: 'charlie.davis@example.com',
  },

  // ── Product 013: MacBook Air M3 (2 reviews) ───────────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440013',
    productId: '650e8400-e29b-41d4-a716-446655440013',
    rating: 5,
    text: 'Incredibly fast and the fanless design means dead silence. Battery lasts a full workday easily.',
    userEmail: 'bob.wilson@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440014',
    productId: '650e8400-e29b-41d4-a716-446655440013',
    rating: 5,
    text: 'Switched from Windows and could not be happier. The M3 chip handles everything I throw at it.',
    userEmail: 'charlie.davis@example.com',
  },

  // ── Product 014: Dell XPS 15 (2 reviews) ──────────────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440015',
    productId: '650e8400-e29b-41d4-a716-446655440014',
    rating: 4,
    text: 'Premium build quality and a gorgeous OLED display. Thermal throttles a bit under sustained loads.',
    userEmail: 'eva.martinez@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440016',
    productId: '650e8400-e29b-41d4-a716-446655440014',
    rating: 3,
    text: 'Great screen but webcam placement at the bottom of the display is awkward for video calls.',
    userEmail: 'frank.miller@example.com',
  },

  // ── Product 015: Lenovo ThinkPad X1 Carbon (2 reviews) ────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440017',
    productId: '650e8400-e29b-41d4-a716-446655440015',
    rating: 5,
    text: 'Legendary keyboard and the carbon fiber chassis is feather light. My go-to travel laptop.',
    userEmail: 'grace.lee@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440018',
    productId: '650e8400-e29b-41d4-a716-446655440015',
    rating: 4,
    text: 'Solid business laptop. Performance is great and ThinkPad reliability is unmatched.',
    userEmail: 'bob.wilson@example.com',
  },

  // ── Product 016: HP Spectre x360 14" (2 reviews) ──────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440019',
    productId: '650e8400-e29b-41d4-a716-446655440016',
    rating: 4,
    text: 'The 2-in-1 design is versatile and the OLED panel is stunning. Charger brick is huge though.',
    userEmail: 'charlie.davis@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440020',
    productId: '650e8400-e29b-41d4-a716-446655440016',
    rating: 5,
    text: 'Best Windows 2-in-1 I have owned. Pen input is responsive and the display quality is excellent.',
    userEmail: 'eva.martinez@example.com',
  },

  // ── Product 017: iPhone 15 Pro (2 reviews) ────────────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440021',
    productId: '650e8400-e29b-41d4-a716-446655440017',
    rating: 5,
    text: 'The titanium frame feels premium and the camera system is class-leading. Action button is a great addition.',
    userEmail: 'frank.miller@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440022',
    productId: '650e8400-e29b-41d4-a716-446655440017',
    rating: 4,
    text: 'Excellent phone but battery life could be better for the Pro line. Camera quality justifies the price.',
    userEmail: 'grace.lee@example.com',
  },

  // ── Product 018: Samsung Galaxy S24 Ultra (2 reviews) ─────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440023',
    productId: '650e8400-e29b-41d4-a716-446655440018',
    rating: 5,
    text: 'S Pen is incredibly useful and the zoom camera is unreal. The best Android phone available right now.',
    userEmail: 'bob.wilson@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440024',
    productId: '650e8400-e29b-41d4-a716-446655440018',
    rating: 4,
    text: 'Powerful phone with a great display. It is on the heavy side but the feature set makes up for it.',
    userEmail: 'charlie.davis@example.com',
  },

  // ── Product 019: Google Pixel 8 Pro (2 reviews) ───────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440025',
    productId: '650e8400-e29b-41d4-a716-446655440019',
    rating: 5,
    text: 'Google AI features are genuinely useful. Call Screen and Magic Eraser alone justify the purchase.',
    userEmail: 'eva.martinez@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440026',
    productId: '650e8400-e29b-41d4-a716-446655440019',
    rating: 4,
    text: 'Clean Android experience with fast updates. Camera is stellar especially in low light.',
    userEmail: 'frank.miller@example.com',
  },

  // ── Product 020: OnePlus 12 (2 reviews) ───────────────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440027',
    productId: '650e8400-e29b-41d4-a716-446655440020',
    rating: 4,
    text: 'Fast charging is incredible — full charge in under 30 minutes. Great value flagship phone.',
    userEmail: 'grace.lee@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440028',
    productId: '650e8400-e29b-41d4-a716-446655440020',
    rating: 5,
    text: 'Smooth display and top-tier performance. Probably the best value phone I have bought.',
    userEmail: 'bob.wilson@example.com',
  },

  // ── Product 021: iPad Pro 13" (2 reviews) ─────────────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440029',
    productId: '650e8400-e29b-41d4-a716-446655440021',
    rating: 5,
    text: 'Incredible display and the M4 chip is overkill in the best way. Use it daily for drawing and video editing.',
    userEmail: 'charlie.davis@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440030',
    productId: '650e8400-e29b-41d4-a716-446655440021',
    rating: 4,
    text: 'Best tablet on the market. iPadOS still feels limited for pro workflows but hardware is unmatched.',
    userEmail: 'eva.martinez@example.com',
  },

  // ── Product 022: Samsung Galaxy Tab S9 Ultra (2 reviews) ──────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440031',
    productId: '650e8400-e29b-41d4-a716-446655440022',
    rating: 4,
    text: 'The 14.6 inch screen is perfect for multitasking. DeX mode makes it a capable laptop replacement.',
    userEmail: 'frank.miller@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440032',
    productId: '650e8400-e29b-41d4-a716-446655440022',
    rating: 5,
    text: 'Huge beautiful display and the S Pen included is a bonus. Samsung really nailed this tablet.',
    userEmail: 'grace.lee@example.com',
  },

  // ── Product 023: Microsoft Surface Pro 10 (2 reviews) ─────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440033',
    productId: '650e8400-e29b-41d4-a716-446655440023',
    rating: 4,
    text: 'The kickstand design is practical. Windows 11 on a tablet finally feels right with this hardware.',
    userEmail: 'bob.wilson@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440034',
    productId: '650e8400-e29b-41d4-a716-446655440023',
    rating: 3,
    text: 'Good product but keyboard and pen not included at this price point is disappointing.',
    userEmail: 'charlie.davis@example.com',
  },

  // ── Product 024: AirPods Pro 2nd Gen (2 reviews) ──────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440035',
    productId: '650e8400-e29b-41d4-a716-446655440024',
    rating: 5,
    text: 'Adaptive transparency is a killer feature. ANC is top of class and spatial audio is immersive.',
    userEmail: 'eva.martinez@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440036',
    productId: '650e8400-e29b-41d4-a716-446655440024',
    rating: 4,
    text: 'Seamless pairing with Apple devices. Fit could be better for running but great for everyday use.',
    userEmail: 'frank.miller@example.com',
  },

  // ── Product 025: Bose QuietComfort 45 (2 reviews) ─────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440037',
    productId: '650e8400-e29b-41d4-a716-446655440025',
    rating: 5,
    text: 'Exceptionally comfortable for long sessions. Sound signature is warm and the ANC is excellent.',
    userEmail: 'grace.lee@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440038',
    productId: '650e8400-e29b-41d4-a716-446655440025',
    rating: 4,
    text: 'Bose sound quality is always reliable. Wish there was multipoint Bluetooth enabled by default.',
    userEmail: 'bob.wilson@example.com',
  },

  // ── Product 026: Apple Watch Ultra 2 (2 reviews) ──────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440039',
    productId: '650e8400-e29b-41d4-a716-446655440026',
    rating: 5,
    text: 'Built like a tank but still stylish. Battery lasts 60+ hours with normal use. Perfect for hiking.',
    userEmail: 'charlie.davis@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440040',
    productId: '650e8400-e29b-41d4-a716-446655440026',
    rating: 4,
    text: 'Best Apple Watch yet. The extra sensors and siren feature make it ideal for outdoor adventures.',
    userEmail: 'eva.martinez@example.com',
  },

  // ── Product 027: Samsung Galaxy Watch 6 Classic (2 reviews) ───────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440041',
    productId: '650e8400-e29b-41d4-a716-446655440027',
    rating: 4,
    text: 'The rotating bezel is brilliant for navigation. Health tracking is comprehensive and accurate.',
    userEmail: 'frank.miller@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440042',
    productId: '650e8400-e29b-41d4-a716-446655440027',
    rating: 5,
    text: 'Classic looking watch with smart capabilities. Best Android watch for Samsung phone owners.',
    userEmail: 'grace.lee@example.com',
  },

  // ── Product 028: Garmin Fenix 7 Solar (2 reviews) ─────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440043',
    productId: '650e8400-e29b-41d4-a716-446655440028',
    rating: 5,
    text: 'Solar charging extends battery life significantly. GPS accuracy and trail maps are outstanding.',
    userEmail: 'bob.wilson@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440044',
    productId: '650e8400-e29b-41d4-a716-446655440028',
    rating: 4,
    text: 'Serious GPS watch for serious athletes. Learning curve with the menus but the data is incredibly detailed.',
    userEmail: 'charlie.davis@example.com',
  },

  // ── Product 029: Dell UltraSharp 32" 4K (2 reviews) ──────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440045',
    productId: '650e8400-e29b-41d4-a716-446655440029',
    rating: 5,
    text: 'Factory-calibrated panel with near-perfect colors. USB-C hub with 90W charging is incredibly convenient.',
    userEmail: 'eva.martinez@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440046',
    productId: '650e8400-e29b-41d4-a716-446655440029',
    rating: 4,
    text: 'Premium monitor for professional work. The IPS panel looks stunning. Worth every penny.',
    userEmail: 'frank.miller@example.com',
  },

  // ── Product 030: Samsung Odyssey G9 49" (2 reviews) ───────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440047',
    productId: '650e8400-e29b-41d4-a716-446655440030',
    rating: 5,
    text: 'This monitor is a game changer for immersive gaming. The 240Hz refresh rate is buttery smooth.',
    userEmail: 'grace.lee@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440048',
    productId: '650e8400-e29b-41d4-a716-446655440030',
    rating: 4,
    text: 'Super ultrawide is incredible once you adapt. Make sure your GPU can handle it before buying.',
    userEmail: 'bob.wilson@example.com',
  },

  // ── Product 031: LG UltraWide 34" QHD (3 reviews) ────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440049',
    productId: '650e8400-e29b-41d4-a716-446655440031',
    rating: 4,
    text: 'Great ultrawide for productivity. Running two windows side by side feels natural on this panel.',
    userEmail: 'charlie.davis@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440050',
    productId: '650e8400-e29b-41d4-a716-446655440031',
    rating: 5,
    text: 'Colors are accurate out of the box and the ergonomic stand is excellent. Solid 34-inch ultrawide.',
    userEmail: 'eva.martinez@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440051',
    productId: '650e8400-e29b-41d4-a716-446655440031',
    rating: 4,
    text: 'Good value at this price. The IPS glow is minimal and picture quality is great for the category.',
    userEmail: 'frank.miller@example.com',
  },

  // ── Product 032: Samsung T9 Portable SSD 2TB (3 reviews) ──────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440052',
    productId: '650e8400-e29b-41d4-a716-446655440032',
    rating: 5,
    text: 'Impressive speed over USB 3.2. The rubberized shell feels robust and survived a drop test.',
    userEmail: 'grace.lee@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440053',
    productId: '650e8400-e29b-41d4-a716-446655440032',
    rating: 5,
    text: '2TB in something this small is remarkable. Transfer speeds are consistently fast for large files.',
    userEmail: 'bob.wilson@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440054',
    productId: '650e8400-e29b-41d4-a716-446655440032',
    rating: 4,
    text: 'Reliable and fast. Used it as my editing drive for a month without any issues. Recommended.',
    userEmail: 'charlie.davis@example.com',
  },

  // ── Product 033: WD My Passport 4TB (3 reviews) ───────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440055',
    productId: '650e8400-e29b-41d4-a716-446655440033',
    rating: 4,
    text: 'Reliable portable drive for backups. 4TB is plenty for my photo library. Quiet operation.',
    userEmail: 'eva.martinez@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440056',
    productId: '650e8400-e29b-41d4-a716-446655440033',
    rating: 3,
    text: 'Works fine but the bundled software is unnecessary bloatware. Just use it as a plain drive.',
    userEmail: 'frank.miller@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440057',
    productId: '650e8400-e29b-41d4-a716-446655440033',
    rating: 5,
    text: 'Using it as my Time Machine backup drive. Compact and capacious — does exactly what it should.',
    userEmail: 'grace.lee@example.com',
  },

  // ── Product 034: Logitech MX Keys Advanced (3 reviews) ────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440058',
    productId: '650e8400-e29b-41d4-a716-446655440034',
    rating: 5,
    text: 'Multi-device pairing works flawlessly. The key feel is excellent and backlight adjusts automatically.',
    userEmail: 'bob.wilson@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440059',
    productId: '650e8400-e29b-41d4-a716-446655440034',
    rating: 5,
    text: 'Switched from a mechanical and do not miss it. Typing is quiet and comfortable for all-day use.',
    userEmail: 'charlie.davis@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440060',
    productId: '650e8400-e29b-41d4-a716-446655440034',
    rating: 4,
    text: 'Premium typing experience. Battery lasts months. A bit pricey but worth it for daily drivers.',
    userEmail: 'eva.martinez@example.com',
  },

  // ── Product 035: Razer DeathAdder V3 (3 reviews) ──────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440061',
    productId: '650e8400-e29b-41d4-a716-446655440035',
    rating: 5,
    text: 'Lightweight and the sensor is flawless. The ergonomic shape is perfect for palm grip.',
    userEmail: 'frank.miller@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440062',
    productId: '650e8400-e29b-41d4-a716-446655440035',
    rating: 4,
    text: 'Great gaming mouse. Click feel is satisfying and the sensor tracks perfectly on my desk pad.',
    userEmail: 'grace.lee@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440063',
    productId: '650e8400-e29b-41d4-a716-446655440035',
    rating: 5,
    text: 'Best wired mouse I have used. No frills, just excellent performance. Razer nailed the V3.',
    userEmail: 'bob.wilson@example.com',
  },

  // ── Product 036: Elgato Stream Deck MK.2 (3 reviews) ─────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440064',
    productId: '650e8400-e29b-41d4-a716-446655440036',
    rating: 5,
    text: 'Changed my streaming workflow completely. Each key is fully customizable and the software is intuitive.',
    userEmail: 'charlie.davis@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440065',
    productId: '650e8400-e29b-41d4-a716-446655440036',
    rating: 4,
    text: 'Great for streamers and content creators. Also useful for productivity macros. Solid build quality.',
    userEmail: 'eva.martinez@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440066',
    productId: '650e8400-e29b-41d4-a716-446655440036',
    rating: 5,
    text: 'Indispensable for my production setup. The LCD buttons look great and response is instant.',
    userEmail: 'frank.miller@example.com',
  },

  // ── Product 037: Sony Alpha A7 IV (3 reviews) ─────────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440067',
    productId: '650e8400-e29b-41d4-a716-446655440037',
    rating: 5,
    text: 'Best hybrid camera in its class. AF tracking is outstanding and 33MP files are stunning.',
    userEmail: 'grace.lee@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440068',
    productId: '650e8400-e29b-41d4-a716-446655440037',
    rating: 5,
    text: 'Upgraded from the A7 III and every aspect is improved. Weather sealing gives peace of mind outdoors.',
    userEmail: 'bob.wilson@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440069',
    productId: '650e8400-e29b-41d4-a716-446655440037',
    rating: 4,
    text: 'Professional-grade image quality. Menu system is complex but you get used to it over time.',
    userEmail: 'charlie.davis@example.com',
  },

  // ── Product 038: Canon EOS R6 Mark II (3 reviews) ─────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440070',
    productId: '650e8400-e29b-41d4-a716-446655440038',
    rating: 5,
    text: 'Fastest AF I have used. Subject tracking in video is magical. Perfect sports and wildlife camera.',
    userEmail: 'eva.martinez@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440071',
    productId: '650e8400-e29b-41d4-a716-446655440038',
    rating: 4,
    text: 'Canon colors straight out of camera are fantastic. Battery life is the only weak point.',
    userEmail: 'frank.miller@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440072',
    productId: '650e8400-e29b-41d4-a716-446655440038',
    rating: 5,
    text: 'Exceptional camera for weddings. Low light performance is incredible and AF reliability is superb.',
    userEmail: 'grace.lee@example.com',
  },

  // ── Product 039: GoPro HERO12 Black (3 reviews) ───────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440073',
    productId: '650e8400-e29b-41d4-a716-446655440039',
    rating: 5,
    text: 'Took it surfing and it handled everything. 5.3K footage and HyperSmooth stabilization are incredible.',
    userEmail: 'bob.wilson@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440074',
    productId: '650e8400-e29b-41d4-a716-446655440039',
    rating: 4,
    text: 'Great durable action camera. Battery drains fast in cold weather but footage quality is top notch.',
    userEmail: 'charlie.davis@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440075',
    productId: '650e8400-e29b-41d4-a716-446655440039',
    rating: 5,
    text: 'Ideal for outdoor sports. The lens mod system is great and GP-Log profile gives editing flexibility.',
    userEmail: 'eva.martinez@example.com',
  },

  // ── Product 040: MagSafe Wallet (3 reviews) ───────────────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440076',
    productId: '650e8400-e29b-41d4-a716-446655440040',
    rating: 4,
    text: 'Holds 3 cards perfectly and the magnet is strong. Slim profile does not add bulk to the phone.',
    userEmail: 'frank.miller@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440077',
    productId: '650e8400-e29b-41d4-a716-446655440040',
    rating: 3,
    text: 'Convenient but the magnet occasionally releases while sliding the phone into a pocket.',
    userEmail: 'grace.lee@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440078',
    productId: '650e8400-e29b-41d4-a716-446655440040',
    rating: 4,
    text: 'Clean minimalist design. Perfect if you carry just a couple of cards. Find My integration is handy.',
    userEmail: 'bob.wilson@example.com',
  },

  // ── Product 041: CalDigit Thunderbolt 4 Hub (3 reviews) ───────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440079',
    productId: '650e8400-e29b-41d4-a716-446655440041',
    rating: 5,
    text: 'Turned my MacBook into a proper desktop with one cable. All ports work reliably without dropouts.',
    userEmail: 'charlie.davis@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440080',
    productId: '650e8400-e29b-41d4-a716-446655440041',
    rating: 5,
    text: 'The gold standard of Thunderbolt hubs. 18 ports and absolutely rock solid since day one.',
    userEmail: 'eva.martinez@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440081',
    productId: '650e8400-e29b-41d4-a716-446655440041',
    rating: 4,
    text: 'Expensive but justified. Runs warm but no performance issues. Highly recommended for power users.',
    userEmail: 'frank.miller@example.com',
  },

  // ── Product 042: Laptop Stand Adjustable (3 reviews) ─────────────────────
  {
    id: '950e8400-e29b-41d4-a716-446655440082',
    productId: '650e8400-e29b-41d4-a716-446655440042',
    rating: 5,
    text: 'Solid and stable at all angles. Laptop thermals improved noticeably with the elevated airflow.',
    userEmail: 'grace.lee@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440083',
    productId: '650e8400-e29b-41d4-a716-446655440042',
    rating: 4,
    text: 'Good build for the price. Height adjustment is smooth and holds a 16-inch MacBook without wobble.',
    userEmail: 'bob.wilson@example.com',
  },
  {
    id: '950e8400-e29b-41d4-a716-446655440084',
    productId: '650e8400-e29b-41d4-a716-446655440042',
    rating: 5,
    text: 'Ergonomic game changer. My neck pain is gone since raising the screen to eye level. Great purchase.',
    userEmail: 'charlie.davis@example.com',
  },
];
