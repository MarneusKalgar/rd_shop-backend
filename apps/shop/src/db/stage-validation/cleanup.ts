/* eslint-disable perfectionist/sort-modules */

import { Client } from 'pg';
import { In } from 'typeorm';

import { AuditLog } from '@/audit-log/audit-log.entity';
import dataSource from '@/data-source';
import { Order } from '@/orders/order.entity';
import { Product } from '@/products/product.entity';
import { ProcessedMessage } from '@/rabbitmq/processed-message.entity';
import { User } from '@/users/user.entity';

import { getStageValidationUserEmails } from './constants';
import {
  assertStageValidationRuntime,
  getStageValidationNamespace,
  requireStageValidationProductId,
} from './runtime';

/** Returns the payments database URL required to remove validation-owned payment rows. */
function getValidationPaymentsDatabaseUrl(): string {
  const paymentsDatabaseUrl = process.env.VALIDATION_PAYMENTS_DATABASE_URL?.trim();

  if (!paymentsDatabaseUrl) {
    throw new Error('VALIDATION_PAYMENTS_DATABASE_URL environment variable is not set');
  }

  return paymentsDatabaseUrl;
}

/** Deletes payment rows linked to validation orders from the payments database. */
async function deleteValidationPayments(orderIds: string[]): Promise<number> {
  if (orderIds.length === 0) {
    return 0;
  }

  const client = new Client({ connectionString: getValidationPaymentsDatabaseUrl() });
  await client.connect();

  try {
    const result = await client.query('DELETE FROM payments WHERE order_id = ANY($1::uuid[])', [
      orderIds,
    ]);

    return result.rowCount ?? 0;
  } finally {
    await client.end();
  }
}

/** Removes validation-owned shop and payments rows without touching shared stage records. */
export async function cleanupStageValidationData(): Promise<void> {
  assertStageValidationRuntime('cleanup');

  if (!process.env.DATABASE_URL || !process.env.DATABASE_PROVIDER) {
    throw new Error('DATABASE_URL or DATABASE_PROVIDER environment variable is not set');
  }

  const namespace = getStageValidationNamespace();
  const productId = requireStageValidationProductId();
  const validationEmails = getStageValidationUserEmails(namespace);

  await dataSource.initialize();

  try {
    const userRepository = dataSource.getRepository(User);
    const orderRepository = dataSource.getRepository(Order);
    const productRepository = dataSource.getRepository(Product);
    const processedMessageRepository = dataSource.getRepository(ProcessedMessage);
    const auditLogRepository = dataSource.getRepository(AuditLog);

    const users = await userRepository.find({
      select: { email: true, id: true },
      where: { email: In(validationEmails) },
    });
    const userIds = users.map((user) => user.id);

    const orders = userIds.length
      ? await orderRepository.find({
          select: { id: true },
          where: { userId: In(userIds) },
        })
      : [];
    const orderIds = orders.map((order) => order.id);

    const deletedPayments = await deleteValidationPayments(orderIds);

    if (orderIds.length > 0) {
      await processedMessageRepository
        .createQueryBuilder()
        .delete()
        .where('order_id IN (:...orderIds)', { orderIds })
        .execute();
    }

    if (userIds.length > 0 || orderIds.length > 0) {
      const auditDelete = auditLogRepository.createQueryBuilder().delete();

      if (userIds.length > 0 && orderIds.length > 0) {
        await auditDelete
          .where('actor_id IN (:...userIds)', { userIds })
          .orWhere('target_id IN (:...targetIds)', { targetIds: [...userIds, ...orderIds] })
          .execute();
      } else if (userIds.length > 0) {
        await auditDelete
          .where('actor_id IN (:...userIds)', { userIds })
          .orWhere('target_id IN (:...userIds)', { userIds })
          .execute();
      } else {
        await auditDelete.where('target_id IN (:...orderIds)', { orderIds }).execute();
      }
    }

    if (userIds.length > 0) {
      await userRepository
        .createQueryBuilder()
        .delete()
        .where('id IN (:...userIds)', { userIds })
        .execute();
    }

    await productRepository.delete(productId);

    console.log(`🧹 Stage validation cleanup namespace=${namespace}`);
    console.log(`   ✓ Deleted ${deletedPayments} validation payments`);
    console.log(`   ✓ Deleted ${orderIds.length} validation orders via user cascade`);
    console.log(`   ✓ Deleted ${userIds.length} validation users`);
    console.log(`   ✓ Deleted validation product ${productId}`);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

/** Executes the stage validation cleanup entrypoint and converts failures into a non-zero exit code. */
async function main(): Promise<void> {
  try {
    await cleanupStageValidationData();
  } catch (error) {
    console.error('Stage validation cleanup failed:', error);
    process.exit(1);
  }
}

void main();
