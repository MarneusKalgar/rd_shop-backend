import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OrdersService } from '@/orders/orders.service';
import { ProductsRepository } from '@/products/product.repository';

import { Order } from '../orders/order.entity';
import { CartItem } from './cart-item.entity';
import { Cart } from './cart.entity';
import { AddCartItemDto, CartCheckoutDto, CartResponseDto, UpdateCartItemDto } from './dto';
import { toCartResponse } from './utils';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
    private readonly productsRepository: ProductsRepository,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Adds a product to the cart. If the product is already in the cart, increments quantity (upsert).
   * Rejects if product doesn't exist or has zero stock.
   *
   * @throws {NotFoundException} If product not found — HTTP 404
   * @throws {ConflictException} If product has zero stock, is inactive, or requested quantity exceeds available stock — HTTP 409
   */
  async addItem(userId: string, dto: AddCartItemDto): Promise<CartResponseDto> {
    const product = await this.productsRepository.findById(dto.productId);

    if (!product) {
      throw new NotFoundException(`Product with ID "${dto.productId}" not found`);
    }

    if (!product.isActive) {
      throw new ConflictException(`Product "${product.title}" is not available for purchase`);
    }

    if (product.stock === 0) {
      throw new ConflictException(`Product "${product.title}" is out of stock`);
    }

    const cart = await this.getCart(userId);

    const existingItem = cart.items.find((item) => item.productId === dto.productId);
    const newQuantity = (existingItem?.quantity ?? 0) + dto.quantity;

    if (newQuantity > product.stock) {
      throw new ConflictException(
        `Requested quantity (${newQuantity}) exceeds available stock (${product.stock}) for product "${product.title}"`,
      );
    }

    if (existingItem) {
      existingItem.quantity = newQuantity;
      await this.cartItemRepository.save(existingItem);
      this.logger.log(
        `Cart item quantity updated for product "${dto.productId}" in cart "${cart.id}"`,
      );
    } else {
      const item = this.cartItemRepository.create({
        cartId: cart.id,
        productId: dto.productId,
        quantity: dto.quantity,
      });
      await this.cartItemRepository.save(item);
      this.logger.log(`Cart item added for product "${dto.productId}" in cart "${cart.id}"`);
    }

    return toCartResponse((await this.findCartWithItems(userId))!);
  }

  /**
   * Converts the cart into an order by delegating to OrdersService.createOrder().
   * Clears the cart on success.
   *
   * @throws {BadRequestException} If cart is empty — HTTP 400
   */
  async checkout(userId: string, dto: CartCheckoutDto): Promise<Order> {
    const cart = await this.findCartWithItems(userId);

    if (!cart?.items.length) {
      throw new BadRequestException('Cannot checkout an empty cart');
    }

    const items = cart.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    }));

    const order = await this.ordersService.createOrder(userId, {
      idempotencyKey: dto.idempotencyKey,
      items,
      shipping: dto.shipping,
    });

    // TODO: uncomment after debugging
    //await this.clearCart(userId);

    return order;
  }

  /**
   * Removes all items from the user's cart.
   */
  async clearCart(userId: string): Promise<void> {
    const cart = await this.findCartWithItems(userId);
    if (!cart?.items.length) {
      return;
    }

    await this.cartItemRepository.remove(cart.items);
    this.logger.log(`Cart "${cart.id}" cleared for user "${userId}"`);
  }

  /**
   * Returns the cart for the given user. Creates one lazily if it doesn't exist.
   */
  async getCart(userId: string): Promise<CartResponseDto> {
    const existing = await this.findCartWithItems(userId);
    if (existing) {
      return toCartResponse(existing);
    }

    const cart = this.cartRepository.create({ userId });
    await this.cartRepository.save(cart);
    this.logger.log(`Cart created for user "${userId}"`);

    return toCartResponse((await this.findCartWithItems(userId))!);
  }

  /**
   * Removes a specific item from the cart.
   *
   * @throws {NotFoundException} If item not found or doesn't belong to user's cart — HTTP 404
   */
  async removeItem(userId: string, itemId: string): Promise<CartResponseDto> {
    const item = await this.findOwnedCartItem(userId, itemId);

    await this.cartItemRepository.remove(item);

    return toCartResponse((await this.findCartWithItems(userId))!);
  }

  /**
   * Updates the quantity of a specific cart item.
   *
   * @throws {NotFoundException} If item not found or doesn't belong to user's cart — HTTP 404
   */
  async updateItem(
    userId: string,
    itemId: string,
    dto: UpdateCartItemDto,
  ): Promise<CartResponseDto> {
    const item = await this.findOwnedCartItem(userId, itemId);

    if (dto.quantity > item.product.stock) {
      throw new ConflictException(
        `Requested quantity (${dto.quantity}) exceeds available stock (${item.product.stock}) for product "${item.product.title}"`,
      );
    }

    item.quantity = dto.quantity;
    await this.cartItemRepository.save(item);

    return toCartResponse((await this.findCartWithItems(userId))!);
  }

  /**
   * Returns the cart with its items and their associated products for the given user, or null if none exists.
   *
   * Callers that guarantee cart existence (e.g. after `getCart()`) may return this Promise directly
   * with a type cast (`as Promise<Cart>`) instead of awaiting and asserting non-null — both are
   * equivalent at runtime since no code executes after the return.
   */
  private async findCartWithItems(userId: string): Promise<Cart | null> {
    return this.cartRepository.findOne({
      relations: ['items', 'items.product'],
      where: { userId },
    });
  }

  private async findOwnedCartItem(userId: string, itemId: string): Promise<CartItem> {
    const cart = await this.findCartWithItems(userId);
    const item = cart?.items.find((i) => i.id === itemId);

    if (!item) {
      throw new NotFoundException(`Cart item with ID "${itemId}" not found`);
    }

    return item;
  }
}
