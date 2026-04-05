import { BasePostgresAdapter, DatabaseAdapterFactory } from '@app/common';

export class NeonAdapter extends BasePostgresAdapter {
  protected connectionUrl: string;

  constructor() {
    super();
    this.validateConfig();
    this.connectionUrl = process.env.DATABASE_URL!;
  }

  /**
   * Detection function for Neon database
   */
  static detect(this: void): boolean {
    const url = process.env.DATABASE_URL;
    return !!url && (url.includes('neon.tech') || url.includes('.neon.'));
  }

  getConnectionUrl(): string {
    return this.connectionUrl;
  }

  getProviderName(): string {
    return 'Neon Database';
  }

  validateConfig(): void {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required for Neon database connection');
    }
  }
}

// Auto-register the adapter
DatabaseAdapterFactory.register('neon', NeonAdapter, NeonAdapter.detect, 10);
