import { Injectable, Scope } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import DataLoader from 'dataloader';
import { In, Repository } from 'typeorm';

import { Product } from '@/products/product.entity';

@Injectable({ scope: Scope.REQUEST })
export class ProductLoader {
  readonly byId = new DataLoader<string, null | Product>(async (productIds: readonly string[]) => {
    const products = await this.productRepository.find({
      where: { id: In([...productIds]) },
    });

    const productMap = new Map(products.map((product) => [product.id, product]));

    return productIds.map((id) => productMap.get(id) ?? null);
  });

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}
}
