import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

import { Product } from './product.entity';

@Injectable()
export class ProductsRepository {
  constructor(
    @InjectRepository(Product)
    private readonly repository: Repository<Product>,
  ) {}

  async findByIds(productIds: string[]): Promise<Product[]> {
    return this.repository.find({
      where: { id: In(productIds) },
    });
  }

  async findByIdsWithLock(manager: EntityManager, productIds: string[]): Promise<Product[]> {
    const repo = this.getRepository(manager);
    return repo
      .createQueryBuilder('product')
      .setLock('pessimistic_write')
      .where('product.id IN (:...ids)', { ids: productIds })
      .getMany();
  }

  async saveProducts(manager: EntityManager, products: Product[]): Promise<Product[]> {
    const repo = this.getRepository(manager);
    return repo.save(products);
  }

  /**
   * Helper to get the appropriate repository (transactional or default).
   */
  private getRepository(manager?: EntityManager): Repository<Product> {
    return manager ? manager.getRepository(Product) : this.repository;
  }
}
