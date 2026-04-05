import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '@/auth/decorators/roles';
import { Scopes } from '@/auth/decorators/scopes';
import { JwtAuthGuard, RolesGuard, ScopesGuard } from '@/auth/guards';
import { UserRole, UserScope } from '@/auth/permissions/constants';

import {
  CreateProductDto,
  ProductDataResponseDto,
  ProductImagesDataResponseDto,
  UpdateProductDto,
} from '../dto';
import { ProductsService } from '../products.service';

@ApiTags('admin / products')
@Controller({ path: 'admin/products', version: '1' })
@Roles(UserRole.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard, ScopesGuard)
export class AdminProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @ApiOperation({ summary: 'Associate an uploaded file with a product as an image' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/images/:fileId')
  @Scopes(UserScope.PRODUCTS_IMAGES_WRITE)
  async addImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<void> {
    return this.productsService.addImage(id, fileId);
  }

  @ApiOperation({ summary: 'Create a new product' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ProductDataResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @ApiResponse({
    description: 'Product with this title already exists',
    status: HttpStatus.CONFLICT,
  })
  @Post()
  @Scopes(UserScope.PRODUCTS_WRITE)
  async create(@Body() dto: CreateProductDto): Promise<ProductDataResponseDto> {
    return this.productsService.create(dto);
  }

  @ApiOperation({ summary: 'List all images for a product' })
  @ApiResponse({ status: HttpStatus.OK, type: ProductImagesDataResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  @Get(':id/images')
  @Scopes(UserScope.PRODUCTS_IMAGES_READ)
  async listImages(@Param('id', ParseUUIDPipe) id: string): Promise<ProductImagesDataResponseDto> {
    return this.productsService.listImages(id);
  }

  @ApiOperation({ summary: 'Soft delete a product' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Scopes(UserScope.PRODUCTS_WRITE)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.productsService.remove(id);
  }

  @ApiOperation({ summary: 'Remove an image association from a product' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  @Delete(':id/images/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Scopes(UserScope.PRODUCTS_IMAGES_WRITE)
  async removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<void> {
    return this.productsService.removeImage(id, fileId);
  }

  @ApiOperation({ summary: 'Set an image as the main product image' })
  @ApiResponse({ status: HttpStatus.OK, type: ProductDataResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  @Patch(':id/images/:fileId/main')
  @Scopes(UserScope.PRODUCTS_WRITE)
  async setMainImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<ProductDataResponseDto> {
    return this.productsService.setMainImage(id, fileId);
  }

  @ApiOperation({ summary: 'Update a product' })
  @ApiResponse({ status: HttpStatus.OK, type: ProductDataResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  @ApiResponse({
    description: 'Product with this title already exists',
    status: HttpStatus.CONFLICT,
  })
  @Patch(':id')
  @Scopes(UserScope.PRODUCTS_WRITE)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductDataResponseDto> {
    return this.productsService.update(id, dto);
  }
}
