export enum ProductCategory {
  ACCESSORIES = 'accessories',
  AUDIO = 'audio',
  CAMERAS = 'cameras',
  LAPTOPS = 'laptops',
  MONITORS = 'monitors',
  OTHER = 'other',
  PERIPHERALS = 'peripherals',
  SMARTPHONES = 'smartphones',
  STORAGE = 'storage',
  TABLETS = 'tablets',
  WEARABLES = 'wearables',
}

export interface ProductCategoryMeta {
  name: ProductCategory;
  nameEn: string;
  nameUk: string;
}

export const PRODUCT_CATEGORIES_MAP = new Map<ProductCategory, ProductCategoryMeta>([
  [
    ProductCategory.ACCESSORIES,
    {
      name: ProductCategory.ACCESSORIES,
      nameEn: 'Accessories',
      nameUk: 'Аксесуари',
    },
  ],
  [ProductCategory.AUDIO, { name: ProductCategory.AUDIO, nameEn: 'Audio', nameUk: 'Аудіо' }],
  [ProductCategory.CAMERAS, { name: ProductCategory.CAMERAS, nameEn: 'Cameras', nameUk: 'Камери' }],
  [
    ProductCategory.LAPTOPS,
    { name: ProductCategory.LAPTOPS, nameEn: 'Laptops', nameUk: 'Ноутбуки' },
  ],
  [
    ProductCategory.MONITORS,
    { name: ProductCategory.MONITORS, nameEn: 'Monitors', nameUk: 'Монітори' },
  ],
  [ProductCategory.OTHER, { name: ProductCategory.OTHER, nameEn: 'Other', nameUk: 'Інше' }],
  [
    ProductCategory.PERIPHERALS,
    {
      name: ProductCategory.PERIPHERALS,
      nameEn: 'Peripherals',
      nameUk: 'Периферія',
    },
  ],
  [
    ProductCategory.SMARTPHONES,
    {
      name: ProductCategory.SMARTPHONES,
      nameEn: 'Smartphones',
      nameUk: 'Смартфони',
    },
  ],
  [
    ProductCategory.STORAGE,
    { name: ProductCategory.STORAGE, nameEn: 'Storage', nameUk: 'Накопичувачі' },
  ],
  [
    ProductCategory.TABLETS,
    {
      name: ProductCategory.TABLETS,
      nameEn: 'Tablets',
      nameUk: 'Планшети',
    },
  ],
  [
    ProductCategory.WEARABLES,
    {
      name: ProductCategory.WEARABLES,
      nameEn: 'Wearables',
      nameUk: 'Носимі пристрої',
    },
  ],
]);

export const PRODUCT_CATEGORIES: ProductCategoryMeta[] = Array.from(
  PRODUCT_CATEGORIES_MAP.values(),
);

export enum ProductSortBy {
  CREATED_AT = 'createdAt',
  PRICE = 'price',
  TITLE = 'title',
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export const DEFAULT_PRODUCTS_LIMIT = 10;
export const MAX_PRODUCTS_LIMIT = 50;
export const MIN_PRODUCTS_LIMIT = 1;

export const DEFAULT_REVIEWS_LIMIT = 10;
export const MAX_REVIEWS_LIMIT = 50;
export const MIN_REVIEWS_LIMIT = 1;
