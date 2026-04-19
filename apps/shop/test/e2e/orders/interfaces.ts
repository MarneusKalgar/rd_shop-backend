export interface OrderBody {
  createdAt: string;
  id: string;
  idempotencyKey: null | string;
  items: OrderItemBody[];
  paymentId: null | string;
  status: string;
  updatedAt: string;
  userId: string;
}

export interface OrderItemBody {
  id: string;
  productId: string;
  quantity: number;
}

export interface OrdersListBody {
  data: OrderBody[];
  limit: number;
  nextCursor: null | string;
}

export interface PaymentBody {
  paymentId: string;
  status: string;
}

export interface ProductBody {
  id: string;
  stock: number;
}
