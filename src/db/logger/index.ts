import { Logger } from '@nestjs/common';
import { Logger as TypeOrmLogger } from 'typeorm';

import { incrementQueryCount } from '@/core/async-storage';

export class CustomTypeOrmLogger implements TypeOrmLogger {
  private readonly logger = new Logger('TypeORM');

  /**
   * Performs logging of the given log.
   */
  log(level: 'info' | 'log' | 'warn', message: string): void {
    switch (level) {
      case 'info':
      case 'log':
        this.logger.log(message);
        break;
      case 'warn':
        this.logger.warn(message);
        break;
    }
  }

  /**
   * Logs migration execution
   */
  logMigration(message: string): void {
    this.logger.log(`Migration: ${message}`);
  }

  /**
   * Logs query and increments the query count in the request context
   */
  logQuery(query: string, parameters?: unknown[]): void {
    incrementQueryCount();
    const sql = this.formatQuery(query, parameters);
    this.logger.debug(`Query: ${sql}`);
  }

  /**
   * Logs query error
   */
  logQueryError(error: Error | string, query: string, parameters?: unknown[]): void {
    const sql = this.formatQuery(query, parameters);
    this.logger.error(`Query Failed: ${sql}`, error instanceof Error ? error.stack : error);
  }

  /**
   * Logs slow query
   */
  logQuerySlow(time: number, query: string, parameters?: unknown[]): void {
    const sql = this.formatQuery(query, parameters);
    this.logger.warn(`Slow Query (${time}ms): ${sql}`);
  }

  /**
   * Logs schema build
   */
  logSchemaBuild(message: string): void {
    this.logger.log(`Schema: ${message}`);
  }

  /**
   * Formats query with parameters for better readability
   */
  private formatQuery(query: string, parameters?: unknown[]): string {
    if (!parameters?.length) {
      return query;
    }

    return `${query} -- Parameters: ${JSON.stringify(parameters)}`;
  }
}
