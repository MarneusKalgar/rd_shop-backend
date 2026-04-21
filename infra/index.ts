import {
  accountId,
  isSharedInfraOwner,
  projectPrefix,
  region,
  resourcePrefix,
  sharedInfraOwnerStack,
  stack,
} from './src/bootstrap';
import { createFoundationDatabases } from './src/foundation/databases';
import { createFoundationEcr } from './src/foundation/ecr';
import { createFoundationFileStorage } from './src/foundation/file-storage';
import { createFoundationNetwork } from './src/foundation/network';
import { createFoundationSecurityGroups } from './src/foundation/security-groups';

// Step 1: bootstrap/runtime context lives in src/bootstrap.ts.
// Step 2: foundation network owns Phase 0.2 resources.
// Step 3: foundation security owns Phase 0.3 resources.
// Step 4: foundation ECR owns Phase 0.4 shared registries.
// Step 5: foundation databases own Phase 1.1 RDS resources.
// Step 6: foundation file storage owns Phase 1.2 S3 resources.
// Step 7: index.ts stays thin and exports values other phases and CI need.
const foundationEcr = createFoundationEcr();
const foundationNetwork = createFoundationNetwork();
const foundationSecurityGroups = createFoundationSecurityGroups({
  vpcId: foundationNetwork.vpcId,
});
const foundationDatabases = createFoundationDatabases({
  privateSubnetIds: foundationNetwork.privateSubnetIds,
  securityGroupIds: {
    rdsPayments: foundationSecurityGroups.securityGroupIds.rdsPayments,
    rdsShop: foundationSecurityGroups.securityGroupIds.rdsShop,
  },
});
const foundationFileStorage = createFoundationFileStorage();

export const availabilityZones = foundationNetwork.availabilityZones;
export const currentStack = stack;
export const databaseParameterGroupName = foundationDatabases.databaseParameterGroupName;
export const databaseSubnetGroupName = foundationDatabases.databaseSubnetGroupName;
export const filesBucketArn = foundationFileStorage.filesBucketArn;
export const filesBucketName = foundationFileStorage.filesBucketName;
export const filesBucketRegionalDomainName = foundationFileStorage.filesBucketRegionalDomainName;
export const natElasticIpAllocationId = foundationNetwork.natElasticIpAllocationId;
export const natInstanceId = foundationNetwork.natInstanceId;
export const natInstanceType = foundationNetwork.natInstanceType;
export const natPublicIp = foundationNetwork.natPublicIp;
export const privateRouteTableId = foundationNetwork.privateRouteTableId;
export const privateSubnetCidrs = foundationNetwork.privateSubnetCidrs;
export const privateSubnetIds = foundationNetwork.privateSubnetIds;
export const paymentsDatabaseAddress = foundationDatabases.paymentsDatabaseAddress;
export const paymentsDatabaseEndpoint = foundationDatabases.paymentsDatabaseEndpoint;
export const paymentsDatabaseEngineVersion = foundationDatabases.paymentsDatabaseEngineVersion;
export const paymentsDatabaseIdentifier = foundationDatabases.paymentsDatabaseIdentifier;
export const paymentsDatabaseMasterUserSecretArn =
  foundationDatabases.paymentsDatabaseMasterUserSecretArn;
export const paymentsDatabaseName = foundationDatabases.paymentsDatabaseName;
export const paymentsDatabasePort = foundationDatabases.paymentsDatabasePort;
export const paymentsDatabaseUsername = foundationDatabases.paymentsDatabaseUsername;
export const project = projectPrefix;
export const publicRouteTableId = foundationNetwork.publicRouteTableId;
export const publicSubnetCidrs = foundationNetwork.publicSubnetCidrs;
export const publicSubnetIds = foundationNetwork.publicSubnetIds;
export const resourceNamePrefix = resourcePrefix;
export const shopDatabaseAddress = foundationDatabases.shopDatabaseAddress;
export const shopDatabaseEndpoint = foundationDatabases.shopDatabaseEndpoint;
export const shopDatabaseEngineVersion = foundationDatabases.shopDatabaseEngineVersion;
export const shopDatabaseIdentifier = foundationDatabases.shopDatabaseIdentifier;
export const shopDatabaseMasterUserSecretArn = foundationDatabases.shopDatabaseMasterUserSecretArn;
export const shopDatabaseName = foundationDatabases.shopDatabaseName;
export const shopDatabasePort = foundationDatabases.shopDatabasePort;
export const shopDatabaseUsername = foundationDatabases.shopDatabaseUsername;
export const securityGroupIds = foundationSecurityGroups.securityGroupIds;
export const sharedInfraManagedByThisStack = isSharedInfraOwner;
export const sharedInfraOwner = sharedInfraOwnerStack;
export const createdSharedRepositories = foundationEcr.createdSharedRepositories;
export const albSecurityGroupId = foundationSecurityGroups.securityGroupIds.alb;
export const ecsSecurityGroupId = foundationSecurityGroups.securityGroupIds.ecs;
export const mqSecurityGroupId = foundationSecurityGroups.securityGroupIds.mq;
export const paymentsRepositoryArn = foundationEcr.paymentsRepositoryArn;
export const paymentsRepositoryName = foundationEcr.paymentsRepositoryName;
export const paymentsRepositoryUrl = foundationEcr.paymentsRepositoryUrl;
export const rdsPaymentsSecurityGroupId = foundationSecurityGroups.securityGroupIds.rdsPayments;
export const rdsShopSecurityGroupId = foundationSecurityGroups.securityGroupIds.rdsShop;
export const shopRepositoryArn = foundationEcr.shopRepositoryArn;
export const shopRepositoryName = foundationEcr.shopRepositoryName;
export const shopRepositoryUrl = foundationEcr.shopRepositoryUrl;
export const vpcCidr = foundationNetwork.vpcCidr;
export const vpcEndpointIds = foundationNetwork.vpcEndpointIds;
export const vpcId = foundationNetwork.vpcId;

export { accountId, region };
