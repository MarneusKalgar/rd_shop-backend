export const ORDER_CANCELLED_EVENT = 'order.cancelled';
export const ORDER_CREATED_EVENT = 'order.created';
export const ORDER_PAID_EVENT = 'order.paid';

export class OrderCancelledEvent {
  constructor(
    public readonly orderId: string,
    public readonly userEmail: string,
  ) {}
}

export class OrderCreatedEvent {
  constructor(
    public readonly orderId: string,
    public readonly userEmail: string,
  ) {}
}

export class OrderPaidEvent {
  constructor(
    public readonly orderId: string,
    public readonly userEmail: string,
  ) {}
}
