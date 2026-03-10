import { IDatabaseAdapter } from './interfaces';

type AdapterConstructor = new () => IDatabaseAdapter;

interface AdapterRegistration {
  adapter: AdapterConstructor;
  detectionFn: () => boolean;
  priority: number; // Higher priority = checked first
}

export class DatabaseAdapterFactory {
  private static registry = new Map<string, AdapterRegistration>();

  /**
   * Clear all registered adapters (useful for testing)
   */
  static clearRegistry(): void {
    this.registry.clear();
  }

  /**
   * Create a database adapter instance
   */
  static create(providerName?: string): IDatabaseAdapter {
    if (providerName) {
      const registration = this.registry.get(providerName);
      if (!registration) {
        throw new Error(
          `Unknown database provider: ${providerName}. Available providers: ${Array.from(this.registry.keys()).join(', ')}`,
        );
      }
      console.log(`🔌 Using database provider: ${providerName} (explicit)`);
      return new registration.adapter();
    }

    // Auto-detect provider based on environment
    const detected = this.detectProvider();
    if (detected) {
      console.log(`🔌 Using database provider: ${detected.name} (auto-detected)`);
      return new detected.registration.adapter();
    }

    throw new Error(
      'Could not auto-detect database provider. Please set DATABASE_PROVIDER environment variable.\n' +
        `Available providers: ${Array.from(this.registry.keys()).join(', ')}`,
    );
  }

  /**
   * Get list of registered adapters
   */
  static getRegisteredAdapters(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * Register a database adapter with detection logic
   */
  static register(
    name: string,
    adapter: AdapterConstructor,
    detectionFn: () => boolean,
    priority = 0,
  ): void {
    this.registry.set(name, { adapter, detectionFn, priority });
  }

  /**
   * Auto-detect which database provider to use
   */
  private static detectProvider(): null | { name: string; registration: AdapterRegistration } {
    // Check explicit DATABASE_PROVIDER env var first
    const explicitProvider = process.env.DATABASE_PROVIDER;
    if (explicitProvider) {
      const registration = this.registry.get(explicitProvider);
      if (registration) {
        return { name: explicitProvider, registration };
      }
      console.warn(`⚠️  DATABASE_PROVIDER="${explicitProvider}" not found, trying auto-detection`);
    }

    const sorted = Array.from(this.registry.entries()).sort(
      ([, a], [, b]) => b.priority - a.priority,
    );

    for (const [name, registration] of sorted) {
      try {
        if (registration.detectionFn()) {
          return { name, registration };
        }
      } catch (error) {
        console.warn(
          `⚠️  Detection function for ${name} threw an error: ${(error as Error).message}`,
        );
        continue;
      }
    }

    return null;
  }
}
