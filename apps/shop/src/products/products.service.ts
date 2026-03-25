import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { FileRecord, FileStatus } from '../files/file-record.entity';
import { S3Service } from '../files/s3.service';
import { DEFAULT_PRODUCTS_LIMIT, ProductCategory, ProductSortBy, SortOrder } from './constants';
import {
  CreateProductDto,
  FindProductsQueryDto,
  ProductDataResponseDto,
  ProductImageDto,
  ProductImagesDataResponseDto,
  ProductResponseDto,
  ProductsListResponseDto,
  UpdateProductDto,
} from './dto';
import { Product } from './product.entity';
import { ProductsRepository } from './product.repository';
import { ReviewsService } from './reviews.service';
import { omitUndefined } from './utils';

const UNIQUE_VIOLATION_CODE = '23505';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly productsRepository: ProductsRepository,
    @InjectRepository(FileRecord)
    private readonly fileRecordRepository: Repository<FileRecord>,
    private readonly reviewsService: ReviewsService,
    private readonly s3Service: S3Service,
  ) {}

  async addImage(productId: string, fileId: string): Promise<void> {
    await this.findProductOrFail(productId);

    const fileRecord = await this.fileRecordRepository.findOne({
      where: { id: fileId, status: FileStatus.READY },
    });

    if (!fileRecord) {
      throw new NotFoundException(`File with ID "${fileId}" not found or not ready`);
    }

    fileRecord.entityId = productId;
    await this.fileRecordRepository.save(fileRecord);

    this.logger.log(`Associated image ${fileId} with product ${productId}`);
  }

  async associateMainImage(productId: string, fileId: string): Promise<void> {
    const product = await this.findProductOrFail(productId);

    product.mainImageId = fileId;
    await this.productRepository.save(product);

    this.logger.log(`Associated file ${fileId} with product ${productId} as main image`);
  }

  async create(dto: CreateProductDto): Promise<ProductDataResponseDto> {
    const product = this.productRepository.create({
      brand: dto.brand ?? null,
      category: dto.category ?? ProductCategory.OTHER,
      country: dto.country ?? null,
      description: dto.description ?? null,
      isActive: dto.isActive ?? true,
      price: dto.price,
      stock: dto.stock ?? 0,
      title: dto.title,
    });

    try {
      const saved = await this.productRepository.save(product);
      this.logger.log(`Created product: ${saved.id}`);
      return { data: ProductResponseDto.fromEntity(saved) };
    } catch (error) {
      this.handleUniqueViolation(error, dto.title);
      throw error;
    }
  }

  async findAll(filters: FindProductsQueryDto): Promise<ProductsListResponseDto> {
    const limit = filters.limit ?? DEFAULT_PRODUCTS_LIMIT;
    const sortBy = filters.sortBy ?? ProductSortBy.CREATED_AT;
    const sortOrder = filters.sortOrder ?? SortOrder.DESC;

    const defined = omitUndefined(filters);
    const products = await this.productsRepository.findWithFilters({
      ...defined,
      limit: limit + 1,
      sortBy,
      sortOrder,
    });

    const hasNextPage = products.length > limit;
    const page = hasNextPage ? products.slice(0, limit) : products;
    const nextCursor = hasNextPage ? page[page.length - 1].id : null;
    const ratingMap = await this.reviewsService.getRatingInfoBatch(page.map((p) => p.id));
    const data = page.map((p) => {
      const rating = ratingMap.get(p.id) ?? { averageRating: null, reviewsCount: 0 };
      return ProductResponseDto.fromEntity(
        p,
        null,
        undefined,
        rating.averageRating,
        rating.reviewsCount,
      );
    });

    return { data, limit, nextCursor };
  }

  async findById(id: string): Promise<ProductDataResponseDto> {
    const product = await this.findProductOrFail(id);

    const [mainImageUrl, imageRecords, ratingInfo] = await Promise.all([
      this.resolveMainImageUrl(product.mainImageId),
      this.fileRecordRepository.find({ where: { entityId: id, status: FileStatus.READY } }),
      this.reviewsService.getRatingInfo(id),
    ]);

    const images = await Promise.all(
      imageRecords
        .filter((r) => r.id !== product.mainImageId)
        .map(async (r) => {
          const url = await this.resolveFileUrl(r);
          return {
            contentType: r.contentType,
            createdAt: r.createdAt,
            id: r.id,
            key: r.key,
            url,
          } as ProductImageDto;
        }),
    );

    return {
      data: ProductResponseDto.fromEntity(
        product,
        mainImageUrl,
        images,
        ratingInfo.averageRating,
        ratingInfo.reviewsCount,
      ),
    };
  }

  async listImages(productId: string): Promise<ProductImagesDataResponseDto> {
    await this.findProductOrFail(productId);

    const records = await this.fileRecordRepository.find({
      where: { entityId: productId, status: FileStatus.READY },
    });

    const data = await Promise.all(
      records.map(async (r) => {
        const url = await this.resolveFileUrl(r);
        return { contentType: r.contentType, createdAt: r.createdAt, id: r.id, key: r.key, url };
      }),
    );

    return { data };
  }

  async remove(id: string): Promise<void> {
    await this.findProductOrFail(id);
    await this.productRepository.softDelete(id);
    this.logger.log(`Soft-deleted product: ${id}`);
  }

  async removeImage(productId: string, fileId: string): Promise<void> {
    await this.findProductOrFail(productId);

    const fileRecord = await this.fileRecordRepository.findOne({
      where: { entityId: productId, id: fileId },
    });

    if (!fileRecord) {
      throw new NotFoundException(`Image with ID "${fileId}" not found for product "${productId}"`);
    }

    fileRecord.entityId = null;
    await this.fileRecordRepository.save(fileRecord);
    await this.productRepository.update(
      { id: productId, mainImageId: fileId },
      { mainImageId: null },
    );

    this.logger.log(`Dissociated image ${fileId} from product ${productId}`);
  }

  async setMainImage(productId: string, fileId: string): Promise<ProductDataResponseDto> {
    await this.findProductOrFail(productId);

    const fileRecord = await this.fileRecordRepository.findOne({
      where: { entityId: productId, id: fileId, status: FileStatus.READY },
    });

    if (!fileRecord) {
      throw new NotFoundException(`Image with ID "${fileId}" not found for product "${productId}"`);
    }

    await this.associateMainImage(productId, fileId);
    const data = await this.findById(productId);

    return data;
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductDataResponseDto> {
    const product = await this.findProductOrFail(id);
    const definedFields = omitUndefined(dto);
    Object.assign(product, definedFields);

    try {
      const saved = await this.productRepository.save(product);
      const mainImageUrl = await this.resolveMainImageUrl(saved.mainImageId);
      return { data: ProductResponseDto.fromEntity(saved, mainImageUrl) };
    } catch (error) {
      this.handleUniqueViolation(error, dto.title);
      throw error;
    }
  }

  private async findProductOrFail(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }
    return product;
  }

  private handleUniqueViolation(error: unknown, title: string | undefined): void {
    if (
      error instanceof QueryFailedError &&
      (error as { code?: string }).code === UNIQUE_VIOLATION_CODE
    ) {
      throw new ConflictException(`Product with title "${title}" already exists`);
    }
  }

  private async resolveFileUrl(fileRecord: FileRecord): Promise<null | string> {
    try {
      const { downloadUrl } = await this.s3Service.getPresignedDownloadUrl(fileRecord.key);
      return downloadUrl;
    } catch {
      return null;
    }
  }

  private async resolveMainImageUrl(mainImageId: null | string): Promise<null | string> {
    if (!mainImageId) return null;

    const fileRecord = await this.fileRecordRepository.findOne({
      where: { id: mainImageId, status: FileStatus.READY },
    });

    if (!fileRecord) return null;

    return this.resolveFileUrl(fileRecord);
  }
}
