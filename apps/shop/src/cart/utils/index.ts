import { Cart } from '../cart.entity';
import { CartResponseDto } from '../dto';

/**
 * Maps a hydrated {@link Cart} entity (with `items.product` loaded) to a {@link CartResponseDto}.
 *
 * Computes:
 * - `itemTotal` per line — `product.price × quantity`, rounded to 2 decimal places
 * - `total` for the whole cart — sum of all line totals, rounded to 2 decimal places
 *
 * Both values are returned as strings to preserve decimal precision in JSON serialization.
 */
export const toCartResponse = (cart: Cart): CartResponseDto => {
  const items = cart.items.map((item) => ({
    ...item,
    itemTotal: (parseFloat(item.product.price) * item.quantity).toFixed(2),
  }));
  const total = items.reduce((sum, item) => sum + parseFloat(item.itemTotal), 0).toFixed(2);
  return { ...cart, items, total };
};
