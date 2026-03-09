import { Order } from '../order.entity';

export const getTotalSum = (order: Order) => {
  return order.items.reduce((sum, item) => {
    return sum + Math.round(parseFloat(item.priceAtPurchase) * item.quantity * 100);
  }, 0);
};
