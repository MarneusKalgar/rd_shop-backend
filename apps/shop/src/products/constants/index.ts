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
