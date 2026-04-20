import { ConflictException, Injectable, Logger } from '@nestjs/common';

import { Order } from '../order.entity';
import { OrdersRepository } from '../repositories';

/**
 * Translates PostgreSQL constraint violation codes into NestJS domain exceptions.
 *
 * Handles three PostgreSQL error codes:
 * - `23505` — unique violation: idempotency key race condition → returns existing order
 * - `57014` — statement timeout: query took too long → throws generic Error
 * - `55P03` — lock timeout: pessimistic lock wait exceeded → throws ConflictException
 *
 * All other errors are re-thrown as-is.
 */
@Injectable()
export class PgErrorMapperService {
  private readonly logger = new Logger(PgErrorMapperService.name);

  constructor(private readonly ordersRepository: OrdersRepository) {}

  /**
   * @param error - The raw error caught from the transaction
   * @param userId - Used for contextual error logging
   * @param idempotencyKey - Optional; enables the 23505 race-condition fallback path
   * @returns The existing Order if a 23505 race was detected and the order exists
   * @throws {ConflictException} On lock timeout (55P03)
   * @throws {Error} On statement timeout (57014) or unhandled errors
   */
  async handleCreationError(
    error: unknown,
    userId: string,
    idempotencyKey?: string,
  ): Promise<Order> {
    const pgError = error as { code?: string; message?: string };

    // Handle duplicate idempotency key race condition
    if (pgError?.code === '23505' && idempotencyKey) {
      this.logger.warn(
        `Race condition detected for idempotency key "${idempotencyKey}". Returning existing order.`,
      );

      const existingOrder = await this.ordersRepository.findByIdempotencyKey(idempotencyKey);

      if (existingOrder) {
        return existingOrder;
      }
    }

    // Handle timeout errors specifically
    if (pgError?.code === '57014' || pgError?.message?.includes('statement timeout')) {
      this.logger.error(
        `Statement timeout during order creation for user ${userId}. Consider optimizing query or increasing timeout.`,
      );
      throw new Error('Order creation timed out due to high load. Please try again in a moment.');
    }

    if (pgError?.code === '55P03' || pgError?.message?.includes('lock timeout')) {
      this.logger.error(`Lock timeout during order creation for user ${userId}.`);
      throw new ConflictException(
        'Unable to process order due to high concurrent activity. Please try again.',
      );
    }

    this.logger.error('Order creation failed, transaction rolled back', error);
    throw error;
  }
}
