import { encodeCursor } from '@/common/utils';

import { Order } from '../order.entity';

export const getTotalSumInCents = (order: Order) => {
  return order.items.reduce((sum, item) => {
    return sum + Math.round(parseFloat(item.priceAtPurchase) * item.quantity * 100);
  }, 0);
};

export function buildOrderNextCursor(
  pageSlice: { createdAt: Date | string; id: string }[],
  hasNextPage: boolean,
): null | string {
  if (!hasNextPage) return null;
  const last = pageSlice[pageSlice.length - 1];
  return encodeCursor(last.id, String(new Date(last.createdAt).getTime()));
}
