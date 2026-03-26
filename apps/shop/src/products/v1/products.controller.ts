import { Controller, Get, HttpStatus, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { FindProductsQueryDto, ProductDataResponseDto, ProductsListResponseDto } from '../dto';
import { ProductsService } from '../products.service';

@ApiTags('products')
@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @ApiOperation({ summary: 'List products with filters, sorting and cursor pagination' })
  @ApiResponse({ status: HttpStatus.OK, type: ProductsListResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST })
  @Get()
  async findAll(@Query() query: FindProductsQueryDto): Promise<ProductsListResponseDto> {
    return this.productsService.findAll(query);
  }

  @ApiOperation({ summary: 'Get product by ID (includes all images)' })
  @ApiResponse({ status: HttpStatus.OK, type: ProductDataResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND })
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ProductDataResponseDto> {
    return this.productsService.findById(id);
  }
}
