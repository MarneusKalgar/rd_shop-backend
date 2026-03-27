import { BasePostgresAdapter } from './base';
import { DatabaseAdapterFactory } from './factory';

export class PostgresAdapter extends BasePostgresAdapter {
  protected connectionUrl: string;

  constructor() {
    super();
    this.validateConfig();
    this.connectionUrl = this.buildConnectionUrl();
  }

  static detect(this: void): boolean {
    const url = process.env.DATABASE_URL;

    if (!url) {
      return false;
    }

    const isLocalHostPattern =
      url.includes('localhost') ||
      url.includes('127.0.0.1') ||
      url.includes('@postgres:') ||
      url.includes('@postgresql:') ||
      url.includes('@db:');

    const isNotCloudProviderHost =
      !url.includes('neon.tech') &&
      !url.includes('.aws.') &&
      !url.includes('.supabase.') &&
      !url.includes('.railway.');

    return isLocalHostPattern && isNotCloudProviderHost;
  }

  getConnectionUrl(): string {
    return this.connectionUrl;
  }

  getProviderName(): string {
    return 'PostgreSQL (Local)';
  }

  validateConfig(): void {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required for PostgreSQL connection');
    }

    try {
      new URL(this.buildConnectionUrl());
    } catch (error) {
      throw new Error(`Invalid DATABASE_URL format: ${(error as Error).message}`);
    }
  }

  private buildConnectionUrl(): string {
    const url = process.env.DATABASE_URL;

    if (!url) {
      throw new Error('DATABASE_URL is not defined');
    }

    return url;
  }
}

DatabaseAdapterFactory.register('postgres', PostgresAdapter, PostgresAdapter.detect, 5);
