export const MAX_ORDER_QUANTITY = 1000;
export const DEFAULT_ORDERS_LIMIT = 10;
export const MAX_ORDERS_LIMIT = 50;
export const MIN_ORDERS_LIMIT = 1;
export const ORDER_WORKER_SCOPE = 'order-worker';

export const ORDER_EXAMPLE = {
  createdAt: '2026-03-27T12:31:54.000Z',
  id: '1e0a432b-b419-498e-b9ef-d3ecceba364f',
  idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
  items: [
    {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      orderId: '1e0a432b-b419-498e-b9ef-d3ecceba364f',
      priceAtPurchase: '499.99',
      product: {
        id: '550e8400-e29b-41d4-a716-446655440001',
        price: '499.99',
        title: 'Laptop Pro 15',
      },
      productId: '550e8400-e29b-41d4-a716-446655440001',
      quantity: 2,
    },
  ],
  paymentId: '43df3406-577e-4d45-a5b7-12a677e42b16',
  shippingCity: 'New York',
  shippingCountry: 'US',
  shippingFirstName: 'John',
  shippingLastName: 'Doe',
  shippingPhone: '+1234567890',
  shippingPostcode: '10001',
  status: 'PAID',
  updatedAt: '2026-03-27T12:31:56.000Z',
};
