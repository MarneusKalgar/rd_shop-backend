import { config, stack } from '../bootstrap';

const defaultAllocatedStorageGiB = 20;
const defaultBackupRetentionDays = 7;
const defaultDatabaseEngine = 'postgres';
const defaultDatabaseEngineMajorVersion = '16';
const defaultDatabaseMultiAz = false;
const defaultDatabasePort = 5432;
const defaultDatabaseStorageType = 'gp3';
const defaultPaymentsDatabaseInstanceClass = 'db.t4g.micro';
const defaultPaymentsDatabaseName = 'rd_shop_payments';
const defaultPaymentsDatabaseUsername = 'payments';
const defaultShopDatabaseInstanceClass = 'db.t4g.micro';
const defaultShopDatabaseName = 'rd_shop';
const defaultShopDatabaseUsername = 'shop';
const minimumAllocatedStorageGiB = 20;

export interface FoundationDatabaseConfig {
  allocatedStorageGiB: number;
  applyImmediately: boolean;
  backupRetentionDays: number;
  deletionProtection: boolean;
  engine: string;
  engineMajorVersion: string;
  parameterGroupFamily: string;
  payments: ServiceDatabaseConfig;
  port: number;
  shop: ServiceDatabaseConfig;
  storageEncrypted: boolean;
  storageType: string;
}

export interface ServiceDatabaseConfig {
  dbName: string;
  instanceClass: string;
  multiAz: boolean;
  username: string;
}

export function getFoundationDatabaseConfig(): FoundationDatabaseConfig {
  const isProduction = stack === 'production';
  const engineMajorVersion =
    config.get('databaseEngineMajorVersion') ?? defaultDatabaseEngineMajorVersion;
  const allocatedStorageGiB =
    config.getNumber('databaseAllocatedStorageGiB') ?? defaultAllocatedStorageGiB;
  const backupRetentionDays =
    config.getNumber('databaseBackupRetentionDays') ?? defaultBackupRetentionDays;
  const databaseMultiAz = config.getBoolean('databaseMultiAz') ?? defaultDatabaseMultiAz;

  validateEngineMajorVersion(engineMajorVersion);
  validateAllocatedStorage(allocatedStorageGiB);
  validateBackupRetention(backupRetentionDays);

  return {
    allocatedStorageGiB,
    applyImmediately: !isProduction,
    backupRetentionDays,
    deletionProtection: isProduction,
    engine: defaultDatabaseEngine,
    engineMajorVersion,
    parameterGroupFamily: `postgres${engineMajorVersion}`,
    payments: {
      dbName: config.get('paymentsDatabaseName') ?? defaultPaymentsDatabaseName,
      instanceClass:
        config.get('paymentsDatabaseInstanceClass') ??
        (isProduction ? 'db.t4g.small' : defaultPaymentsDatabaseInstanceClass),
      multiAz: databaseMultiAz,
      username: config.get('paymentsDatabaseUsername') ?? defaultPaymentsDatabaseUsername,
    },
    port: defaultDatabasePort,
    shop: {
      dbName: config.get('shopDatabaseName') ?? defaultShopDatabaseName,
      instanceClass:
        config.get('shopDatabaseInstanceClass') ??
        (isProduction ? 'db.t4g.small' : defaultShopDatabaseInstanceClass),
      multiAz: databaseMultiAz,
      username: config.get('shopDatabaseUsername') ?? defaultShopDatabaseUsername,
    },
    storageEncrypted: true,
    storageType: defaultDatabaseStorageType,
  };
}

function validateAllocatedStorage(allocatedStorageGiB: number) {
  if (allocatedStorageGiB < minimumAllocatedStorageGiB) {
    throw new Error(
      `databaseAllocatedStorageGiB must be at least ${minimumAllocatedStorageGiB} GiB.`,
    );
  }
}

function validateBackupRetention(backupRetentionDays: number) {
  if (backupRetentionDays < 0) {
    throw new Error('databaseBackupRetentionDays cannot be negative.');
  }
}

function validateEngineMajorVersion(engineMajorVersion: string) {
  if (!/^\d+$/.test(engineMajorVersion)) {
    throw new Error('databaseEngineMajorVersion must be a major PostgreSQL version like "16".');
  }
}
