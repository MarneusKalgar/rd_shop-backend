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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { extractAuditContext } from '@/audit-log/utils';
import { CurrentUser } from '@/auth/decorators/current-user';
import { Scopes } from '@/auth/decorators/scopes';
import { JwtAuthGuard, ScopesGuard } from '@/auth/guards';
import { UserScope } from '@/auth/permissions/constants';
import { AuthUser } from '@/auth/types';
import { GetOrderByIdResponseDto } from '@/orders/dto';

import { CartService } from '../cart.service';
import { AddCartItemDto, CartCheckoutDto, GetCartResponseDto, UpdateCartItemDto } from '../dto';

@ApiTags('cart')
@Controller({ path: 'cart', version: '1' })
@UseGuards(JwtAuthGuard, ScopesGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @ApiOperation({ summary: 'Add item to cart (upsert — increments quantity if already present)' })
  @ApiResponse({
    description: 'Item added successfully',
    status: HttpStatus.CREATED,
    type: GetCartResponseDto,
  })
  @ApiResponse({ description: 'Product not found', status: HttpStatus.NOT_FOUND })
  @ApiResponse({ description: 'Product out of stock or inactive', status: HttpStatus.CONFLICT })
  @Post('items')
  @Scopes(UserScope.ORDERS_WRITE)
  async addItem(
    @Body() dto: AddCartItemDto,
    @CurrentUser() user: AuthUser,
  ): Promise<GetCartResponseDto> {
    const cart = await this.cartService.addItem(user.sub, dto);
    return { data: cart };
  }

  @ApiOperation({ summary: 'Checkout — convert cart into an order' })
  @ApiResponse({
    description: 'Order created from cart successfully',
    status: HttpStatus.CREATED,
    type: GetOrderByIdResponseDto,
  })
  @ApiResponse({ description: 'Cart is empty', status: HttpStatus.BAD_REQUEST })
  @ApiResponse({
    description: 'Insufficient stock or product unavailable',
    status: HttpStatus.CONFLICT,
  })
  @Post('checkout')
  @Scopes(UserScope.ORDERS_WRITE)
  async checkout(
    @Body() dto: CartCheckoutDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<GetOrderByIdResponseDto> {
    const order = await this.cartService.checkout(user.sub, dto, extractAuditContext(req));
    return { data: order };
  }

  @ApiOperation({ summary: 'Clear entire cart' })
  @ApiResponse({ description: 'Cart cleared successfully', status: HttpStatus.NO_CONTENT })
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Scopes(UserScope.ORDERS_WRITE)
  async clearCart(@CurrentUser() user: AuthUser): Promise<void> {
    await this.cartService.clearCart(user.sub);
  }

  @ApiOperation({ summary: 'Get current user cart with items and product details' })
  @ApiResponse({
    description: 'Cart retrieved successfully',
    status: HttpStatus.OK,
    type: GetCartResponseDto,
  })
  @Get()
  @Scopes(UserScope.ORDERS_READ)
  async getCart(@CurrentUser() user: AuthUser): Promise<GetCartResponseDto> {
    const cart = await this.cartService.getCart(user.sub);
    return { data: cart };
  }

  @ApiOperation({ summary: 'Remove a specific item from the cart' })
  @ApiResponse({
    description: 'Item removed successfully',
    status: HttpStatus.OK,
    type: GetCartResponseDto,
  })
  @ApiResponse({ description: 'Cart item not found', status: HttpStatus.NOT_FOUND })
  @Delete('items/:itemId')
  @Scopes(UserScope.ORDERS_WRITE)
  async removeItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<GetCartResponseDto> {
    const cart = await this.cartService.removeItem(user.sub, itemId);
    return { data: cart };
  }

  @ApiOperation({ summary: 'Update quantity of a cart item' })
  @ApiResponse({
    description: 'Item updated successfully',
    status: HttpStatus.OK,
    type: GetCartResponseDto,
  })
  @ApiResponse({ description: 'Cart item not found', status: HttpStatus.NOT_FOUND })
  @Patch('items/:itemId')
  @Scopes(UserScope.ORDERS_WRITE)
  async updateItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateCartItemDto,
    @CurrentUser() user: AuthUser,
  ): Promise<GetCartResponseDto> {
    const cart = await this.cartService.updateItem(user.sub, itemId, dto);
    return { data: cart };
  }
}
