/* eslint-disable perfectionist/sort-modules */

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import {
  commonTags,
  projectPrefix,
  region,
  stack,
  config as stackConfig,
  stackName,
} from '../bootstrap';
import {
  FoundationDatabaseBackend,
  FoundationDatabaseConfig,
  getFoundationDatabaseConfig,
  ServiceDatabaseConfig,
} from './database-config';
import { buildDatabaseHostUserData } from './database-user-data';

const amazonLinuxAmiSsmParameterName =
  '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64';
const databaseBootstrapSecretName = `${projectPrefix}/postgres/${stack}/bootstrap`;
const ssmManagedInstanceCorePolicyArn = 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore';

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

interface FoundationDatabaseOutputs {
  databaseBackend: FoundationDatabaseBackend;
  databaseBootstrapContainerName: pulumi.Input<null | string>;
  databaseBootstrapInstanceId: pulumi.Input<null | string>;
  databaseParameterGroupName: pulumi.Input<null | string>;
  databaseSubnetGroupName: pulumi.Input<null | string>;
  paymentsDatabaseAddress: pulumi.Input<string>;
  paymentsDatabaseEndpoint: pulumi.Input<string>;
  paymentsDatabaseEngineVersion: pulumi.Input<string>;
  paymentsDatabaseIdentifier: pulumi.Input<string>;
  paymentsDatabaseMasterUserSecretArn: pulumi.Input<null | string>;
  paymentsDatabaseName: pulumi.Input<string>;
  paymentsDatabasePort: pulumi.Input<number>;
  paymentsDatabaseUsername: pulumi.Input<string>;
  shopDatabaseAddress: pulumi.Input<string>;
  shopDatabaseEndpoint: pulumi.Input<string>;
  shopDatabaseEngineVersion: pulumi.Input<string>;
  shopDatabaseIdentifier: pulumi.Input<string>;
  shopDatabaseMasterUserSecretArn: pulumi.Input<null | string>;
  shopDatabaseName: pulumi.Input<string>;
  shopDatabasePort: pulumi.Input<number>;
  shopDatabaseUsername: pulumi.Input<string>;
}

/**
 * Step 1.1 / data layer.
 * Accepts the private subnet ids plus the shop and payments RDS security-group ids.
 * Creates the shared subnet group, PostgreSQL parameter group, and both service RDS instances, then returns the connection metadata later steps consume.
 */
export function createFoundationDatabases({
  privateSubnetIds,
  securityGroupIds,
}: CreateFoundationDatabasesArgs) {
  const databaseConfig = getFoundationDatabaseConfig();

  return databaseConfig.backend === 'ec2-postgres'
    ? createEc2FoundationDatabases({
        config: databaseConfig,
        privateSubnetIds,
        securityGroupIds,
      })
    : createRdsFoundationDatabases({
        config: databaseConfig,
        privateSubnetIds,
        securityGroupIds,
      });
}

/**
 * Step 1.1 / data layer.
 * Accepts the normalized database config plus the private subnet ids and existing database security-group ids.
 * Creates the shared subnet group, PostgreSQL parameter group, and both service RDS instances, then returns the connection metadata later steps consume.
 */
function createRdsFoundationDatabases({
  config,
  privateSubnetIds,
  securityGroupIds,
}: CreateFoundationDatabasesArgs & {
  config: FoundationDatabaseConfig;
}): FoundationDatabaseOutputs {
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
    family: config.parameterGroupFamily,
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
    config,
    logicalName: 'shop-db',
    parameterGroupName: parameterGroup.name,
    securityGroupId: securityGroupIds.rdsShop,
    serviceConfig: config.shop,
    subnetGroupName: subnetGroup.name,
  });

  const paymentsDatabase = createDatabaseInstance({
    config,
    logicalName: 'payments-db',
    parameterGroupName: parameterGroup.name,
    securityGroupId: securityGroupIds.rdsPayments,
    serviceConfig: config.payments,
    subnetGroupName: subnetGroup.name,
  });

  return {
    databaseBackend: config.backend,
    databaseBootstrapContainerName: null,
    databaseBootstrapInstanceId: null,
    databaseParameterGroupName: parameterGroup.name,
    databaseSubnetGroupName: subnetGroup.name,
    paymentsDatabaseAddress: paymentsDatabase.address,
    paymentsDatabaseEndpoint: paymentsDatabase.endpoint,
    paymentsDatabaseEngineVersion: paymentsDatabase.engineVersion,
    paymentsDatabaseIdentifier: paymentsDatabase.identifier,
    paymentsDatabaseMasterUserSecretArn: paymentsDatabase.masterUserSecrets.apply(
      (secrets) => secrets[0]?.secretArn ?? null,
    ),
    paymentsDatabaseName: config.payments.dbName,
    paymentsDatabasePort: paymentsDatabase.port,
    paymentsDatabaseUsername: config.payments.username,
    shopDatabaseAddress: shopDatabase.address,
    shopDatabaseEndpoint: shopDatabase.endpoint,
    shopDatabaseEngineVersion: shopDatabase.engineVersion,
    shopDatabaseIdentifier: shopDatabase.identifier,
    shopDatabaseMasterUserSecretArn: shopDatabase.masterUserSecrets.apply(
      (secrets) => secrets[0]?.secretArn ?? null,
    ),
    shopDatabaseName: config.shop.dbName,
    shopDatabasePort: shopDatabase.port,
    shopDatabaseUsername: config.shop.username,
  };
}

/**
 * Step 1.1 / data layer.
 * Accepts the normalized database config plus the private subnet ids and existing database security-group ids.
 * Creates one private EC2 PostgreSQL host for stage, compatible per-service database secrets, and returns the same runtime connection surface used by the rest of the stack.
 */
function createEc2FoundationDatabases({
  config,
  privateSubnetIds,
  securityGroupIds,
}: CreateFoundationDatabasesArgs & {
  config: FoundationDatabaseConfig;
}): FoundationDatabaseOutputs {
  const selectedSubnetId = pulumi.output(privateSubnetIds).apply((subnetIds) => {
    if (subnetIds.length === 0) {
      throw new Error('EC2 PostgreSQL host requires at least one private subnet.');
    }

    return subnetIds[0];
  });
  const databaseHostAmiId =
    config.host.amiId ??
    aws.ssm.getParameterOutput({
      name: amazonLinuxAmiSsmParameterName,
    }).value;
  const databaseSubnet = aws.ec2.getSubnetOutput({ id: selectedSubnetId });
  const databaseHostContainerName = stackName('postgres-host');
  const postgresAdminPassword = stackConfig.requireSecret('databaseHostAdminPassword');
  const shopDatabasePassword = stackConfig.requireSecret('shopDatabasePassword');
  const paymentsDatabasePassword = stackConfig.requireSecret('paymentsDatabasePassword');

  const databaseBootstrapSecret = new aws.secretsmanager.Secret(stackName('postgres-bootstrap'), {
    description: 'Bootstrap secret for the stage EC2 PostgreSQL host.',
    name: databaseBootstrapSecretName,
    recoveryWindowInDays: config.host.bootstrapSecretRecoveryWindowInDays,
    tags: {
      ...commonTags,
      Component: 'database',
      Name: databaseBootstrapSecretName,
      Scope: 'private',
    },
  });

  const databaseBootstrapSecretVersion = new aws.secretsmanager.SecretVersion(
    stackName('postgres-bootstrap-version'),
    {
      secretId: databaseBootstrapSecret.id,
      secretString: pulumi.secret(
        pulumi
          .all([postgresAdminPassword, shopDatabasePassword, paymentsDatabasePassword])
          .apply(([adminPassword, shopPassword, paymentsPassword]) =>
            JSON.stringify({
              PAYMENTS_DB_NAME: config.payments.dbName,
              PAYMENTS_DB_PASSWORD: paymentsPassword,
              PAYMENTS_DB_USER: config.payments.username,
              POSTGRES_PASSWORD: adminPassword,
              SHOP_DB_NAME: config.shop.dbName,
              SHOP_DB_PASSWORD: shopPassword,
              SHOP_DB_USER: config.shop.username,
            }),
          ),
      ),
    },
  );

  const databaseHostInstanceRole = new aws.iam.Role(stackName('postgres-host-instance-role'), {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: 'ec2.amazonaws.com',
    }),
    name: stackName('postgres-host-instance-role'),
    tags: {
      ...commonTags,
      Component: 'database',
      Name: stackName('postgres-host-instance-role'),
      Scope: 'private',
    },
  });

  new aws.iam.RolePolicyAttachment(stackName('postgres-host-ssm-managed-policy'), {
    policyArn: ssmManagedInstanceCorePolicyArn,
    role: databaseHostInstanceRole.name,
  });

  new aws.iam.RolePolicy(stackName('postgres-host-bootstrap-policy'), {
    name: stackName('postgres-host-bootstrap-policy'),
    policy: pulumi.jsonStringify({
      Statement: [
        {
          Action: ['secretsmanager:GetSecretValue'],
          Effect: 'Allow',
          Resource: [databaseBootstrapSecret.arn],
        },
      ],
      Version: '2012-10-17',
    }),
    role: databaseHostInstanceRole.name,
  });

  const databaseHostInstanceProfile = new aws.iam.InstanceProfile(
    stackName('postgres-host-instance-profile'),
    {
      name: stackName('postgres-host-instance-profile'),
      role: databaseHostInstanceRole.name,
      tags: {
        ...commonTags,
        Component: 'database',
        Name: stackName('postgres-host-instance-profile'),
        Scope: 'private',
      },
    },
  );

  const databaseDataVolume = new aws.ebs.Volume(stackName('postgres-data-volume'), {
    availabilityZone: databaseSubnet.availabilityZone,
    encrypted: config.storageEncrypted,
    size: config.allocatedStorageGiB,
    tags: {
      ...commonTags,
      Component: 'database',
      Name: stackName('postgres-data-volume'),
      Scope: 'private',
    },
    type: config.storageType,
  });

  const databaseHost = new aws.ec2.Instance(stackName('postgres-host'), {
    ami: databaseHostAmiId,
    associatePublicIpAddress: false,
    iamInstanceProfile: databaseHostInstanceProfile.name,
    instanceType: config.host.instanceType,
    metadataOptions: {
      httpEndpoint: 'enabled',
      httpTokens: 'required',
    },
    subnetId: selectedSubnetId,
    tags: {
      ...commonTags,
      Component: 'database',
      Name: stackName('postgres-host'),
      Scope: 'private',
    },
    userData: pulumi
      .all([
        databaseBootstrapSecret.arn,
        databaseBootstrapSecretVersion.versionId,
        databaseDataVolume.id,
      ])
      .apply(([bootstrapSecretArn, , dataVolumeId]) =>
        buildDatabaseHostUserData({
          bootstrapSecretArn,
          containerName: databaseHostContainerName,
          dataVolumeDeviceName: config.host.dataVolumeDeviceName,
          dataVolumeId,
          dataVolumeMountPath: config.host.dataVolumeMountPath,
          image: config.host.image,
          port: config.port,
          region,
        }),
      ),
    userDataReplaceOnChange: true,
    vpcSecurityGroupIds: [securityGroupIds.rdsShop, securityGroupIds.rdsPayments],
  });

  new aws.ec2.VolumeAttachment(
    stackName('postgres-data-volume-attachment'),
    {
      deviceName: config.host.dataVolumeDeviceName,
      instanceId: databaseHost.id,
      stopInstanceBeforeDetaching: true,
      volumeId: databaseDataVolume.id,
    },
    {
      deleteBeforeReplace: true,
    },
  );

  const shopDatabaseSecret = createEc2DatabaseAccessSecret({
    config,
    databaseHost,
    databaseName: config.shop.dbName,
    logicalName: 'shop-db-access',
    password: shopDatabasePassword,
    service: 'shop',
    username: config.shop.username,
  });
  const paymentsDatabaseSecret = createEc2DatabaseAccessSecret({
    config,
    databaseHost,
    databaseName: config.payments.dbName,
    logicalName: 'payments-db-access',
    password: paymentsDatabasePassword,
    service: 'payments',
    username: config.payments.username,
  });

  return {
    databaseBackend: config.backend,
    databaseBootstrapContainerName: databaseHostContainerName,
    databaseBootstrapInstanceId: databaseHost.id,
    databaseParameterGroupName: null,
    databaseSubnetGroupName: null,
    paymentsDatabaseAddress: databaseHost.privateIp,
    paymentsDatabaseEndpoint: pulumi.interpolate`${databaseHost.privateIp}:${config.port}`,
    paymentsDatabaseEngineVersion: config.engineMajorVersion,
    paymentsDatabaseIdentifier: pulumi.interpolate`${databaseHost.id}:${config.payments.dbName}`,
    paymentsDatabaseMasterUserSecretArn: paymentsDatabaseSecret.secretArn,
    paymentsDatabaseName: config.payments.dbName,
    paymentsDatabasePort: config.port,
    paymentsDatabaseUsername: config.payments.username,
    shopDatabaseAddress: databaseHost.privateIp,
    shopDatabaseEndpoint: pulumi.interpolate`${databaseHost.privateIp}:${config.port}`,
    shopDatabaseEngineVersion: config.engineMajorVersion,
    shopDatabaseIdentifier: pulumi.interpolate`${databaseHost.id}:${config.shop.dbName}`,
    shopDatabaseMasterUserSecretArn: shopDatabaseSecret.secretArn,
    shopDatabaseName: config.shop.dbName,
    shopDatabasePort: config.port,
    shopDatabaseUsername: config.shop.username,
  };
}

/**
 * Step 1.1 database secret helper.
 * Accepts the stage EC2 PostgreSQL host plus the per-service credentials.
 * Creates one Secrets Manager secret whose payload matches the runtime-config expectations for database access resolution.
 */
function createEc2DatabaseAccessSecret({
  config,
  databaseHost,
  databaseName,
  logicalName,
  password,
  service,
  username,
}: {
  config: FoundationDatabaseConfig;
  databaseHost: aws.ec2.Instance;
  databaseName: string;
  logicalName: string;
  password: pulumi.Input<string>;
  service: 'payments' | 'shop';
  username: string;
}) {
  const secretName = `${projectPrefix}/${service}/${stack}/database`;
  const secret = new aws.secretsmanager.Secret(stackName(logicalName), {
    description: `${service} database access secret for the stage EC2 PostgreSQL host.`,
    name: secretName,
    recoveryWindowInDays: config.host.bootstrapSecretRecoveryWindowInDays,
    tags: {
      ...commonTags,
      Component: 'database',
      Name: secretName,
      Scope: 'private',
      Service: service,
    },
  });

  const secretVersion = new aws.secretsmanager.SecretVersion(stackName(`${logicalName}-version`), {
    secretId: secret.id,
    secretString: pulumi.secret(
      pulumi.all([databaseHost.privateIp, password]).apply(([host, resolvedPassword]) =>
        JSON.stringify({
          database: databaseName,
          host,
          password: resolvedPassword,
          port: config.port,
          username,
        }),
      ),
    ),
  });

  return {
    secretArn: pulumi.all([secret.arn, secretVersion.versionId]).apply(([arn]) => arn),
  };
}

/**
 * Step 1.1 database helper.
 * Accepts the normalized database config, per-service config, subnet group, parameter group, and target security group id.
 * Creates one RDS instance for either `shop` or `payments` and returns the instance resource.
 */
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
