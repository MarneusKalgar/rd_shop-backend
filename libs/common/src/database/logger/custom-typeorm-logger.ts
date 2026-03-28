import { Logger } from '@nestjs/common';
import { Logger as TypeOrmLogger } from 'typeorm';

export class CustomTypeOrmLogger implements TypeOrmLogger {
  private readonly logger = new Logger('TypeORM');

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

  logMigration(message: string): void {
    this.logger.log(`Migration: ${message}`);
  }

  logQuery(query: string, parameters?: unknown[]): void {
    const sql = this.formatQuery(query, parameters);
    this.logger.debug(`Query: ${sql}`);
  }

  logQueryError(error: Error | string, query: string, parameters?: unknown[]): void {
    const sql = this.formatQuery(query, parameters);
    this.logger.error(`Query Failed: ${sql}`, error instanceof Error ? error.stack : error);
  }

  logQuerySlow(time: number, query: string, parameters?: unknown[]): void {
    const sql = this.formatQuery(query, parameters);
    this.logger.warn(`Slow Query (${time}ms): ${sql}`);
  }

  logSchemaBuild(message: string): void {
    this.logger.log(`Schema: ${message}`);
  }

  private formatQuery(query: string, parameters?: unknown[]): string {
    if (!parameters?.length) {
      return query;
    }

    return `${query} -- Parameters: ${JSON.stringify(parameters)}`;
  }
}
