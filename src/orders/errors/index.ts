export class DuplicateIdempotencyKeyError extends Error {
  constructor(
    public readonly idempotencyKey: string,
    public readonly existingOrderId: string,
  ) {
    super(`Order with idempotency key "${idempotencyKey}" already exists`);
    this.name = 'DuplicateIdempotencyKeyError';
  }
}

export class InsufficientStockError extends Error {
  constructor(
    public readonly productId: string,
    public readonly productTitle: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `Insufficient stock for product "${productTitle}". Requested: ${requested}, Available: ${available}`,
    );
    this.name = 'InsufficientStockError';
  }
}

export class ProductInactiveError extends Error {
  constructor(
    public readonly productId: string,
    public readonly productTitle: string,
  ) {
    super(`Product "${productTitle}" is not available for purchase`);
    this.name = 'ProductInactiveError';
  }
}

export class ProductNotFoundError extends Error {
  constructor(public readonly productId: string) {
    super(`Product with ID "${productId}" not found`);
    this.name = 'ProductNotFoundError';
  }
}

export class UserNotFoundError extends Error {
  constructor(public readonly userId: string) {
    super(`User with ID "${userId}" not found`);
    this.name = 'UserNotFoundError';
  }
}
