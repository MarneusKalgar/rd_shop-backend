import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { Product } from '@/products/product.entity';
import { ProductsRepository } from '@/products/product.repository';

import { OrderItem } from '../order-item.entity';
import { OrderStockService, StockItem } from './order-stock.service';

const makeProduct = (overrides: Partial<Product> = {}): Product => {
  return {
    id: 'prod-1',
    isActive: true,
    price: '99.99',
    stock: 10,
    title: 'Test Product',
    ...overrides,
  } as Product;
};

const makeItem = (overrides: Partial<StockItem> = {}): StockItem => ({
  productId: 'prod-1',
  quantity: 2,
  ...overrides,
});

describe('OrderStockService', () => {
  let service: OrderStockService;
  let productsRepository: jest.Mocked<ProductsRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderStockService,
        {
          provide: ProductsRepository,
          useValue: {
            findByIds: jest.fn(),
            findByIdsWithLock: jest.fn(),
            saveProducts: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(OrderStockService);
    productsRepository = module.get(ProductsRepository);
  });

  describe('validateStockAndAvailability', () => {
    it('throws NotFoundException when product missing from map', () => {
      const items = [makeItem({ productId: 'missing' })];
      const productMap = new Map<string, Product>();

      expect(() => service.validateStockAndAvailability(items, productMap)).toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when product is inactive', () => {
      const product = makeProduct({ isActive: false });
      const items = [makeItem()];
      const productMap = new Map([['prod-1', product]]);

      expect(() => service.validateStockAndAvailability(items, productMap)).toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when stock is insufficient', () => {
      const product = makeProduct({ stock: 1 });
      const items = [makeItem({ quantity: 5 })];
      const productMap = new Map([['prod-1', product]]);

      expect(() => service.validateStockAndAvailability(items, productMap)).toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when stock equals zero and item quantity > 0', () => {
      const product = makeProduct({ stock: 0 });
      const items = [makeItem({ quantity: 1 })];
      const productMap = new Map([['prod-1', product]]);

      expect(() => service.validateStockAndAvailability(items, productMap)).toThrow(
        ConflictException,
      );
    });

    it('does not throw when stock exactly equals requested quantity', () => {
      const product = makeProduct({ stock: 2 });
      const items = [makeItem({ quantity: 2 })];
      const productMap = new Map([['prod-1', product]]);

      expect(() => service.validateStockAndAvailability(items, productMap)).not.toThrow();
    });

    it('does not throw when all products are valid and stock is sufficient', () => {
      const product = makeProduct({ stock: 10 });
      const items = [makeItem({ quantity: 3 })];
      const productMap = new Map([['prod-1', product]]);

      expect(() => service.validateStockAndAvailability(items, productMap)).not.toThrow();
    });

    it('validates all items — throws on the failing one', () => {
      const p1 = makeProduct({ id: 'p1', stock: 10 });
      const p2 = makeProduct({ id: 'p2', isActive: false, stock: 1 });
      const items = [
        makeItem({ productId: 'p1', quantity: 2 }),
        makeItem({ productId: 'p2', quantity: 1 }),
      ];
      const productMap = new Map([
        ['p1', p1],
        ['p2', p2],
      ]);

      expect(() => service.validateStockAndAvailability(items, productMap)).toThrow(
        ConflictException,
      );
    });
  });

  describe('decrementStock', () => {
    it('decrements stock in-memory for each item', () => {
      const product = makeProduct({ stock: 10 });
      const items = [makeItem({ quantity: 3 })];
      const productMap = new Map([['prod-1', product]]);

      service.decrementStock(items, productMap);

      expect(product.stock).toBe(7);
    });

    it('handles multiple items affecting different products', () => {
      const p1 = makeProduct({ id: 'p1', stock: 10 });
      const p2 = makeProduct({ id: 'p2', stock: 5 });
      const items = [
        makeItem({ productId: 'p1', quantity: 4 }),
        makeItem({ productId: 'p2', quantity: 2 }),
      ];
      const productMap = new Map([
        ['p1', p1],
        ['p2', p2],
      ]);

      service.decrementStock(items, productMap);

      expect(p1.stock).toBe(6);
      expect(p2.stock).toBe(3);
    });

    it('does not modify products not in the items list', () => {
      const p1 = makeProduct({ id: 'p1', stock: 10 });
      const p2 = makeProduct({ id: 'p2', stock: 5 });
      const items = [makeItem({ productId: 'p1', quantity: 2 })];
      const productMap = new Map([
        ['p1', p1],
        ['p2', p2],
      ]);

      service.decrementStock(items, productMap);

      expect(p2.stock).toBe(5);
    });
  });

  describe('restoreStock', () => {
    it('increments stock in-memory for each item', () => {
      const product = makeProduct({ stock: 5 });
      const items = [{ productId: 'prod-1', quantity: 3 }] as Pick<
        OrderItem,
        'productId' | 'quantity'
      >[];
      const productMap = new Map([['prod-1', product]]);

      service.restoreStock(items, productMap);

      expect(product.stock).toBe(8);
    });

    it('skips items whose product is absent from the map', () => {
      const items = [{ productId: 'missing', quantity: 5 }] as Pick<
        OrderItem,
        'productId' | 'quantity'
      >[];
      const productMap = new Map<string, Product>();

      expect(() => service.restoreStock(items, productMap)).not.toThrow();
    });

    it('handles multiple items restoring to different products', () => {
      const p1 = makeProduct({ id: 'p1', stock: 0 });
      const p2 = makeProduct({ id: 'p2', stock: 2 });
      const items = [
        { productId: 'p1', quantity: 3 },
        { productId: 'p2', quantity: 1 },
      ] as Pick<OrderItem, 'productId' | 'quantity'>[];
      const productMap = new Map([
        ['p1', p1],
        ['p2', p2],
      ]);

      service.restoreStock(items, productMap);

      expect(p1.stock).toBe(3);
      expect(p2.stock).toBe(3);
    });
  });

  describe('lockValidateAndDecrement', () => {
    it('locks products, validates, decrements, and persists', async () => {
      const product = makeProduct({ stock: 10 });
      const items = [makeItem({ quantity: 3 })];
      const manager = {} as never;

      productsRepository.findByIdsWithLock.mockResolvedValueOnce([product]);
      productsRepository.saveProducts.mockResolvedValueOnce([{ ...product, stock: 7 }]);

      const result = await service.lockValidateAndDecrement(manager, items, ['prod-1']);

      expect(productsRepository.findByIdsWithLock.mock.calls).toEqual([[manager, ['prod-1']]]);
      expect(product.stock).toBe(7);
      expect(productsRepository.saveProducts.mock.calls).toEqual([[manager, [product]]]);
      expect(result.get('prod-1')).toBe(product);
    });

    it('propagates validation errors from validateStockAndAvailability', async () => {
      const product = makeProduct({ isActive: false });
      const items = [makeItem()];
      const manager = {} as never;

      productsRepository.findByIdsWithLock.mockResolvedValueOnce([product]);

      await expect(service.lockValidateAndDecrement(manager, items, ['prod-1'])).rejects.toThrow(
        ConflictException,
      );
      expect(productsRepository.saveProducts.mock.calls).toHaveLength(0);
    });
  });

  describe('lockAndRestore', () => {
    it('locks products, restores stock, and persists', async () => {
      const product = makeProduct({ stock: 5 });
      const items = [{ productId: 'prod-1', quantity: 3 }] as Pick<
        OrderItem,
        'productId' | 'quantity'
      >[];
      const manager = {} as never;

      productsRepository.findByIdsWithLock.mockResolvedValueOnce([product]);
      productsRepository.saveProducts.mockResolvedValueOnce([{ ...product, stock: 8 }]);

      await service.lockAndRestore(manager, items, ['prod-1']);

      expect(productsRepository.findByIdsWithLock.mock.calls).toEqual([[manager, ['prod-1']]]);
      expect(product.stock).toBe(8);
      expect(productsRepository.saveProducts.mock.calls).toEqual([[manager, [product]]]);
    });
  });

  describe('validateExist', () => {
    it('does not throw when all products are found', async () => {
      productsRepository.findByIds.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }] as Product[]);

      await expect(service.validateExist(['p1', 'p2'])).resolves.toBeUndefined();
    });

    it('throws NotFoundException when a product is missing', async () => {
      productsRepository.findByIds.mockResolvedValueOnce([{ id: 'p1' }] as Product[]);

      await expect(service.validateExist(['p1', 'p2'])).rejects.toThrow(NotFoundException);
    });

    it('includes the missing product id in the error message', async () => {
      productsRepository.findByIds.mockResolvedValueOnce([] as Product[]);

      await expect(service.validateExist(['missing-id'])).rejects.toThrow(/missing-id/);
    });

    it('does not throw when productIds array is empty', async () => {
      productsRepository.findByIds.mockResolvedValueOnce([] as Product[]);

      await expect(service.validateExist([])).resolves.toBeUndefined();
    });
  });
});
