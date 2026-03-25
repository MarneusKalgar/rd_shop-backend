import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FileRecord } from '../files/file-record.entity';
import { S3Service } from '../files/s3.service';
import { Product } from './product.entity';
import { ProductsRepository } from './product.repository';
import { ProductsService } from './products.service';
import { ReviewsService } from './reviews.service';

describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: getRepositoryToken(Product),
          useValue: { findOne: jest.fn(), save: jest.fn(), softDelete: jest.fn() },
        },
        {
          provide: ProductsRepository,
          useValue: {
            findByIds: jest.fn(),
            findByIdsWithLock: jest.fn(),
            findWithFilters: jest.fn(),
            saveProducts: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(FileRecord),
          useValue: { find: jest.fn(), findOne: jest.fn(), save: jest.fn() },
        },
        {
          provide: ReviewsService,
          useValue: { getRatingInfo: jest.fn(), getRatingInfoBatch: jest.fn() },
        },
        {
          provide: S3Service,
          useValue: { getPresignedDownloadUrl: jest.fn(), getPublicUrl: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
