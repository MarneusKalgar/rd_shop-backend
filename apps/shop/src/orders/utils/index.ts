import { BadRequestException, NotFoundException } from '@nestjs/common';

import { encodeCursor } from '@/common/utils';

import { MAX_ORDER_QUANTITY } from '../constants';
import { CreateOrderDto } from '../dto';
import { Order } from '../order.entity';

export function assertOrderOwnership(order: null | Order, userId: string): asserts order is Order {
  if (order?.userId !== userId) {
    throw new NotFoundException(`Order with ID "${order?.id ?? 'unknown'}" not found`);
  }
}

export const getTotalSumInCents = (order: Order) => {
  return order.items.reduce((sum, item) => {
    return sum + Math.round(parseFloat(item.priceAtPurchase) * item.quantity * 100);
  }, 0);
};

export function validateOrderItems(items: CreateOrderDto['items']): void {
  for (const item of items) {
    if (item.quantity <= 0) {
      throw new BadRequestException(
        `Quantity must be greater than zero for product ${item.productId}`,
      );
    }

    if (item.quantity > MAX_ORDER_QUANTITY) {
      throw new BadRequestException(
        `Quantity cannot exceed ${MAX_ORDER_QUANTITY} for product ${item.productId}`,
      );
    }
  }
}

export const buildOrderNextCursor = (
  pageSlice: { createdAt: Date | string; id: string }[],
  hasNextPage: boolean,
): null | string => {
  if (!hasNextPage) return null;
  const last = pageSlice[pageSlice.length - 1];
  return encodeCursor(last.id, String(new Date(last.createdAt).getTime()));
};
