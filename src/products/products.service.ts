import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Product } from './product.entity';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  /**
   * Associate a file record with a product as its main image
   */
  async associateMainImage(productId: string, fileId: string): Promise<void> {
    const product = await this.productRepository.findOne({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    // Set the file as the main image for the product
    product.mainImageId = fileId;
    await this.productRepository.save(product);

    this.logger.log(`Associated file ${fileId} with product ${productId} as main image`);
  }
}
