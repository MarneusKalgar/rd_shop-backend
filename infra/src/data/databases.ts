import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { commonTags, stackName } from '../bootstrap';
import {
  FoundationDatabaseConfig,
  getFoundationDatabaseConfig,
  ServiceDatabaseConfig,
} from './database-config';

interface CreateDatabaseInstanceArgs {
  config: FoundationDatabaseConfig;
  logicalName: string;
  parameterGroupName: pulumi.Input<string>;
  securityGroupId: pulumi.Input<string>;
  serviceConfig: ServiceDatabaseConfig;
  subnetGroupName: pulumi.Input<string>;
}

interface CreateFoundationDatabasesArgs {
  privateSubnetIds: pulumi.Input<pulumi.Input<string>[]>;
  securityGroupIds: {
    rdsPayments: pulumi.Input<string>;
    rdsShop: pulumi.Input<string>;
  };
}

export function createFoundationDatabases({
  privateSubnetIds,
  securityGroupIds,
}: CreateFoundationDatabasesArgs) {
  const databaseConfig = getFoundationDatabaseConfig();

  const subnetGroup = new aws.rds.SubnetGroup(stackName('db-subnet-group'), {
    description: 'Private subnet group for RDS instances.',
    name: stackName('db-subnet-group'),
    subnetIds: privateSubnetIds,
    tags: {
      ...commonTags,
      Component: 'database',
      Name: stackName('db-subnet-group'),
      Scope: 'private',
    },
  });

  const parameterGroup = new aws.rds.ParameterGroup(stackName('postgres-parameter-group'), {
    description: 'PostgreSQL parameter group with SSL enforced.',
    family: databaseConfig.parameterGroupFamily,
    name: stackName('postgres-parameter-group'),
    parameters: [
      {
        applyMethod: 'pending-reboot',
        name: 'rds.force_ssl',
        value: '1',
      },
    ],
    tags: {
      ...commonTags,
      Component: 'database',
      Name: stackName('postgres-parameter-group'),
      Scope: 'shared',
    },
  });

  const shopDatabase = createDatabaseInstance({
    config: databaseConfig,
    logicalName: 'shop-db',
    parameterGroupName: parameterGroup.name,
    securityGroupId: securityGroupIds.rdsShop,
    serviceConfig: databaseConfig.shop,
    subnetGroupName: subnetGroup.name,
  });

  const paymentsDatabase = createDatabaseInstance({
    config: databaseConfig,
    logicalName: 'payments-db',
    parameterGroupName: parameterGroup.name,
    securityGroupId: securityGroupIds.rdsPayments,
    serviceConfig: databaseConfig.payments,
    subnetGroupName: subnetGroup.name,
  });

  return {
    databaseParameterGroupName: parameterGroup.name,
    databaseSubnetGroupName: subnetGroup.name,
    paymentsDatabaseAddress: paymentsDatabase.address,
    paymentsDatabaseEndpoint: paymentsDatabase.endpoint,
    paymentsDatabaseEngineVersion: paymentsDatabase.engineVersion,
    paymentsDatabaseIdentifier: paymentsDatabase.identifier,
    paymentsDatabaseMasterUserSecretArn: paymentsDatabase.masterUserSecrets.apply(
      (secrets) => secrets[0]?.secretArn ?? null,
    ),
    paymentsDatabaseName: databaseConfig.payments.dbName,
    paymentsDatabasePort: paymentsDatabase.port,
    paymentsDatabaseUsername: databaseConfig.payments.username,
    shopDatabaseAddress: shopDatabase.address,
    shopDatabaseEndpoint: shopDatabase.endpoint,
    shopDatabaseEngineVersion: shopDatabase.engineVersion,
    shopDatabaseIdentifier: shopDatabase.identifier,
    shopDatabaseMasterUserSecretArn: shopDatabase.masterUserSecrets.apply(
      (secrets) => secrets[0]?.secretArn ?? null,
    ),
    shopDatabaseName: databaseConfig.shop.dbName,
    shopDatabasePort: shopDatabase.port,
    shopDatabaseUsername: databaseConfig.shop.username,
  };
}

function createDatabaseInstance({
  config,
  logicalName,
  parameterGroupName,
  securityGroupId,
  serviceConfig,
  subnetGroupName,
}: CreateDatabaseInstanceArgs) {
  const resolvedEngineVersion = aws.rds.getEngineVersionOutput({
    engine: config.engine,
    latest: true,
    parameterGroupFamily: config.parameterGroupFamily,
    version: config.engineMajorVersion,
  });

  const orderableInstance = aws.rds.getOrderableDbInstanceOutput({
    engine: config.engine,
    engineLatestVersion: true,
    engineVersion: resolvedEngineVersion.versionActual,
    preferredInstanceClasses: [serviceConfig.instanceClass],
    storageType: config.storageType,
    supportsMultiAz: serviceConfig.multiAz ? true : undefined,
    supportsStorageEncryption: config.storageEncrypted,
    vpc: true,
  });

  return new aws.rds.Instance(stackName(logicalName), {
    allocatedStorage: config.allocatedStorageGiB,
    applyImmediately: config.applyImmediately,
    autoMinorVersionUpgrade: true,
    backupRetentionPeriod: config.backupRetentionDays,
    copyTagsToSnapshot: true,
    dbName: serviceConfig.dbName,
    dbSubnetGroupName: subnetGroupName,
    deletionProtection: config.deletionProtection,
    engine: config.engine,
    engineVersion: orderableInstance.engineVersion,
    finalSnapshotIdentifier: config.deletionProtection
      ? stackName(`${logicalName}-final-snapshot`)
      : undefined,
    identifier: stackName(logicalName),
    instanceClass: serviceConfig.instanceClass,
    manageMasterUserPassword: true,
    multiAz: serviceConfig.multiAz,
    parameterGroupName,
    port: config.port,
    publiclyAccessible: false,
    skipFinalSnapshot: !config.deletionProtection,
    storageEncrypted: config.storageEncrypted,
    storageType: config.storageType,
    tags: {
      ...commonTags,
      Component: 'database',
      Name: stackName(logicalName),
      Scope: 'private',
      Service: logicalName.startsWith('shop') ? 'shop' : 'payments',
    },
    username: serviceConfig.username,
    vpcSecurityGroupIds: [securityGroupId],
  });
}
