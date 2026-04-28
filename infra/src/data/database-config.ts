import { config, stack } from '../bootstrap';

const defaultAllocatedStorageGiB = 20;
const defaultDatabaseBackend = stack === 'stage' ? 'ec2-postgres' : 'rds';
const defaultNonProductionBackupRetentionDays = 1;
const defaultProductionBackupRetentionDays = 7;
const defaultDatabaseEngine = 'postgres';
const defaultDatabaseEngineMajorVersion = '16';
const defaultDatabaseHostDataVolumeDeviceName = '/dev/xvdf';
const defaultDatabaseHostDataVolumeMountPath = '/var/lib/rd-shop-postgres';
const defaultDatabaseHostInstanceType = 't3.micro';
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

export interface DatabaseHostConfig {
  bootstrapSecretRecoveryWindowInDays: number;
  dataVolumeDeviceName: string;
  dataVolumeMountPath: string;
  image: string;
  instanceType: string;
}

export type FoundationDatabaseBackend = 'ec2-postgres' | 'rds';

export interface FoundationDatabaseConfig {
  allocatedStorageGiB: number;
  applyImmediately: boolean;
  backend: FoundationDatabaseBackend;
  backupRetentionDays: number;
  deletionProtection: boolean;
  engine: string;
  engineMajorVersion: string;
  host: DatabaseHostConfig;
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

/**
 * Step 1.1 database config helper.
 * Accepts no arguments.
 * Resolves the RDS defaults and stack overrides for both services, then returns the normalized database configuration used by provisioning.
 */
export function getFoundationDatabaseConfig(): FoundationDatabaseConfig {
  const isProduction = stack === 'production';
  const backend =
    (config.get('databaseBackend') as FoundationDatabaseBackend | undefined) ??
    defaultDatabaseBackend;
  const engineMajorVersion =
    config.get('databaseEngineMajorVersion') ?? defaultDatabaseEngineMajorVersion;
  const allocatedStorageGiB =
    config.getNumber('databaseAllocatedStorageGiB') ?? defaultAllocatedStorageGiB;
  const backupRetentionDays =
    config.getNumber('databaseBackupRetentionDays') ??
    (isProduction ? defaultProductionBackupRetentionDays : defaultNonProductionBackupRetentionDays);
  const databaseMultiAz = config.getBoolean('databaseMultiAz') ?? defaultDatabaseMultiAz;
  const databaseHostImage =
    config.get('databaseHostImage') ??
    `public.ecr.aws/docker/library/postgres:${engineMajorVersion}-alpine`;

  validateBackend(backend);
  validateEngineMajorVersion(engineMajorVersion);
  validateAllocatedStorage(allocatedStorageGiB);
  validateBackupRetention(backupRetentionDays);

  return {
    allocatedStorageGiB,
    applyImmediately: !isProduction,
    backend,
    backupRetentionDays,
    deletionProtection: isProduction,
    engine: defaultDatabaseEngine,
    engineMajorVersion,
    host: {
      bootstrapSecretRecoveryWindowInDays: isProduction ? 30 : 0,
      dataVolumeDeviceName:
        config.get('databaseHostDataVolumeDeviceName') ?? defaultDatabaseHostDataVolumeDeviceName,
      dataVolumeMountPath:
        config.get('databaseHostDataVolumeMountPath') ?? defaultDatabaseHostDataVolumeMountPath,
      image: databaseHostImage,
      instanceType: config.get('databaseHostInstanceType') ?? defaultDatabaseHostInstanceType,
    },
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

/**
 * Step 1.1 validation helper.
 * Accepts the configured allocated storage size in GiB.
 * Throws when the storage value is below the minimum supported RDS size for this stack.
 */
function validateAllocatedStorage(allocatedStorageGiB: number) {
  if (allocatedStorageGiB < minimumAllocatedStorageGiB) {
    throw new Error(
      `databaseAllocatedStorageGiB must be at least ${minimumAllocatedStorageGiB} GiB.`,
    );
  }
}

/**
 * Step 1.1 validation helper.
 * Accepts the configured database backend.
 * Throws when the backend is not supported by this stack.
 */
function validateBackend(backend: FoundationDatabaseBackend) {
  if (backend !== 'ec2-postgres' && backend !== 'rds') {
    throw new Error('databaseBackend must be either "rds" or "ec2-postgres".');
  }
}

/**
 * Step 1.1 validation helper.
 * Accepts the configured backup retention in days.
 * Throws when the retention value is negative.
 */
function validateBackupRetention(backupRetentionDays: number) {
  if (backupRetentionDays < 0) {
    throw new Error('databaseBackupRetentionDays cannot be negative.');
  }
}

/**
 * Step 1.1 validation helper.
 * Accepts the configured PostgreSQL major version string.
 * Throws when the version does not look like a numeric PostgreSQL major version.
 */
function validateEngineMajorVersion(engineMajorVersion: string) {
  if (!/^\d+$/.test(engineMajorVersion)) {
    throw new Error('databaseEngineMajorVersion must be a major PostgreSQL version like "16".');
  }
}
