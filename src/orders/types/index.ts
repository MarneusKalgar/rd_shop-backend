import { Order } from '../order.entity';

export interface FindOrdersWithFiltersResponse {
  nextCursor: null | string;
  orders: Order[];
  total: number;
}
