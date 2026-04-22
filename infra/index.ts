import {
  accountId,
  isSharedInfraOwner,
  projectPrefix,
  region,
  resourcePrefix,
  sharedInfraOwnerStack,
  stack,
} from './src/bootstrap';
import { createFoundationCompute } from './src/compute/compute';
import { createComputeEdge } from './src/compute/edge';
import { createComputeServices } from './src/compute/services';
import { createFoundationDatabases } from './src/data/databases';
import { createFoundationFileStorage } from './src/data/file-storage';
import { createFoundationRuntimeConfig } from './src/data/runtime-config';
import { createFoundationSes } from './src/data/ses';
import { createFoundationEcr } from './src/foundation/ecr';
import { createFoundationNetwork } from './src/foundation/network';
import { createFoundationSecurityGroups } from './src/foundation/security-groups';
import { createMessageQueue } from './src/messaging/mq';

// Step 1: bootstrap/runtime context lives in src/bootstrap.ts.
// Step 2: foundation network owns Phase 0.2 resources.
// Step 3: foundation security owns Phase 0.3 resources.
// Step 4: foundation ECR owns Phase 0.4 shared registries.
// Step 5: data module owns Phase 1.1 RDS resources.
// Step 6: data module owns Phase 1.2 S3 resources.
// Step 7: data module owns Phase 1.3/1.4 secrets and parameters.
// Step 8: data module owns Phase 1.5 sender identity resources.
// Step 9: messaging module owns Phase 3 AmazonMQ broker resources.
// Step 10: compute module owns Phase 2.2 ECS cluster and EC2 capacity.
// Step 11: compute module owns Phase 2.3/2.4 ECS task definitions and services.
// Step 12: compute module owns Phase 2.4/2.5 public ALB, ACM, and Route 53 wiring.
// Step 13: index.ts stays thin and exports values other phases and CI need.
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
const messageQueue = createMessageQueue({
  privateSubnetIds: foundationNetwork.privateSubnetIds,
  securityGroupId: foundationSecurityGroups.securityGroupIds.mq,
});
const foundationRuntimeConfig = createFoundationRuntimeConfig({
  databases: {
    payments: {
      databaseName: foundationDatabases.paymentsDatabaseName,
      masterUserSecretArn: foundationDatabases.paymentsDatabaseMasterUserSecretArn,
    },
    shop: {
      databaseName: foundationDatabases.shopDatabaseName,
      masterUserSecretArn: foundationDatabases.shopDatabaseMasterUserSecretArn,
    },
  },
  fileStorage: {
    filesBucketName: foundationFileStorage.filesBucketName,
  },
  messageQueue: {
    host: messageQueue.mqBrokerHost,
    port: messageQueue.mqBrokerPort,
  },
});
const foundationSes = createFoundationSes();
const foundationCompute = createFoundationCompute({
  privateSubnetIds: foundationNetwork.privateSubnetIds,
  securityGroupId: foundationSecurityGroups.securityGroupIds.ecs,
});
const computeEdge = createComputeEdge({
  albSecurityGroupId: foundationSecurityGroups.securityGroupIds.alb,
  publicSubnetIds: foundationNetwork.publicSubnetIds,
  vpcId: foundationNetwork.vpcId,
});
const computeServices = createComputeServices({
  capacityProviderName: foundationCompute.ecsCapacityProviderName,
  clusterArn: foundationCompute.ecsClusterArn,
  ecr: {
    paymentsRepositoryUrl: foundationEcr.paymentsRepositoryUrl,
    shopRepositoryUrl: foundationEcr.shopRepositoryUrl,
  },
  edge: computeEdge
    ? {
        shopTargetGroupArn: computeEdge.shopTargetGroupArn,
      }
    : undefined,
  fileStorage: {
    filesBucketArn: foundationFileStorage.filesBucketArn,
  },
  network: {
    vpcId: foundationNetwork.vpcId,
  },
  runtimeConfig: {
    paymentsRuntimeParameterNames: foundationRuntimeConfig.paymentsRuntimeParameterNames,
    paymentsRuntimeSecretArn: foundationRuntimeConfig.paymentsRuntimeSecretArn,
    shopRuntimeParameterNames: foundationRuntimeConfig.shopRuntimeParameterNames,
    shopRuntimeSecretArn: foundationRuntimeConfig.shopRuntimeSecretArn,
  },
  ses: {
    shopSesIdentityArn: foundationSes.shopSesIdentityArn,
  },
});

export const availabilityZones = foundationNetwork.availabilityZones;
export const currentStack = stack;
export const databaseParameterGroupName = foundationDatabases.databaseParameterGroupName;
export const databaseSubnetGroupName = foundationDatabases.databaseSubnetGroupName;
export const ecsAutoScalingGroupArn = foundationCompute.ecsAutoScalingGroupArn;
export const ecsAutoScalingGroupName = foundationCompute.ecsAutoScalingGroupName;
export const ecsCapacityProviderArn = foundationCompute.ecsCapacityProviderArn;
export const ecsCapacityProviderName = foundationCompute.ecsCapacityProviderName;
export const ecsClusterArn = foundationCompute.ecsClusterArn;
export const ecsClusterName = foundationCompute.ecsClusterName;
export const filesBucketArn = foundationFileStorage.filesBucketArn;
export const filesBucketName = foundationFileStorage.filesBucketName;
export const filesBucketRegionalDomainName = foundationFileStorage.filesBucketRegionalDomainName;
export const ecsInstanceProfileArn = foundationCompute.ecsInstanceProfileArn;
export const ecsInstanceProfileName = foundationCompute.ecsInstanceProfileName;
export const ecsInstanceRoleArn = foundationCompute.ecsInstanceRoleArn;
export const ecsInstanceRoleName = foundationCompute.ecsInstanceRoleName;
export const ecsLaunchTemplateId = foundationCompute.ecsLaunchTemplateId;
export const ecsLaunchTemplateLatestVersion = foundationCompute.ecsLaunchTemplateLatestVersion;
export const ecsOptimizedAmiId = foundationCompute.ecsOptimizedAmiId;
export const ecsTaskExecutionRoleArn = computeServices.ecsTaskExecutionRoleArn;
export const ecsTaskExecutionRoleName = computeServices.ecsTaskExecutionRoleName;
export const natElasticIpAllocationId = foundationNetwork.natElasticIpAllocationId;
export const natInstanceId = foundationNetwork.natInstanceId;
export const natInstanceType = foundationNetwork.natInstanceType;
export const natPublicIp = foundationNetwork.natPublicIp;
export const publicAlbArn = computeEdge?.publicAlbArn ?? null;
export const publicAlbDnsName = computeEdge?.publicAlbDnsName ?? null;
export const publicAlbHttpListenerArn = computeEdge?.publicAlbHttpListenerArn ?? null;
export const publicAlbHttpsListenerArn = computeEdge?.publicAlbHttpsListenerArn ?? null;
export const publicAlbName = computeEdge?.publicAlbName ?? null;
export const publicAlbZoneId = computeEdge?.publicAlbZoneId ?? null;
export const publicApiAliasRecordFqdn = computeEdge?.publicApiAliasRecordFqdn ?? null;
export const publicApiDomainName = computeEdge?.publicApiDomainName ?? null;
export const publicCertificateArn = computeEdge?.publicCertificateArn ?? null;
export const publicCertificateDomainName = computeEdge?.publicCertificateDomainName ?? null;
export const publicCertificateValidationRecordFqdn =
  computeEdge?.publicCertificateValidationRecordFqdn ?? null;
export const publicEndpointEnabled = computeEdge !== undefined;
export const publicHostedZoneId = computeEdge?.publicHostedZoneId ?? null;
export const publicHostedZoneName = computeEdge?.publicHostedZoneName ?? null;
export const publicHostedZoneNameServers = computeEdge?.publicHostedZoneNameServers ?? null;
export const paymentsDiscoveryServiceArn = computeServices.paymentsDiscoveryServiceArn;
export const paymentsDiscoveryServiceId = computeServices.paymentsDiscoveryServiceId;
export const paymentsDiscoveryServiceName = computeServices.paymentsDiscoveryServiceName;
export const privateRouteTableId = foundationNetwork.privateRouteTableId;
export const privateDnsNamespaceArn = computeServices.privateDnsNamespaceArn;
export const privateDnsNamespaceId = computeServices.privateDnsNamespaceId;
export const privateDnsNamespaceName = computeServices.privateDnsNamespaceName;
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
export const paymentsRuntimeParameterNames = foundationRuntimeConfig.paymentsRuntimeParameterNames;
export const paymentsRuntimeSecretArn = foundationRuntimeConfig.paymentsRuntimeSecretArn;
export const paymentsRuntimeSecretName = foundationRuntimeConfig.paymentsRuntimeSecretName;
export const paymentsImageUri = computeServices.paymentsImageUri;
export const paymentsLogGroupName = computeServices.paymentsLogGroupName;
export const paymentsServiceArn = computeServices.paymentsServiceArn;
export const paymentsServiceDiscoveryHost = computeServices.paymentsServiceDiscoveryHost;
export const paymentsServiceName = computeServices.paymentsServiceName;
export const paymentsTaskDefinitionArn = computeServices.paymentsTaskDefinitionArn;
export const paymentsTaskRoleArn = computeServices.paymentsTaskRoleArn;
export const paymentsTaskRoleName = computeServices.paymentsTaskRoleName;
export const resourceNamePrefix = resourcePrefix;
export const shopDatabaseAddress = foundationDatabases.shopDatabaseAddress;
export const shopDatabaseEndpoint = foundationDatabases.shopDatabaseEndpoint;
export const shopDatabaseEngineVersion = foundationDatabases.shopDatabaseEngineVersion;
export const shopDatabaseIdentifier = foundationDatabases.shopDatabaseIdentifier;
export const shopDatabaseMasterUserSecretArn = foundationDatabases.shopDatabaseMasterUserSecretArn;
export const shopDatabaseName = foundationDatabases.shopDatabaseName;
export const shopDatabasePort = foundationDatabases.shopDatabasePort;
export const shopDatabaseUsername = foundationDatabases.shopDatabaseUsername;
export const shopRuntimeParameterNames = foundationRuntimeConfig.shopRuntimeParameterNames;
export const shopRuntimeSecretArn = foundationRuntimeConfig.shopRuntimeSecretArn;
export const shopRuntimeSecretName = foundationRuntimeConfig.shopRuntimeSecretName;
export const shopImageUri = computeServices.shopImageUri;
export const shopLogGroupName = computeServices.shopLogGroupName;
export const shopSesFromAddress = foundationSes.shopSesFromAddress;
export const shopSesIdentity = foundationSes.shopSesIdentity;
export const shopSesIdentityArn = foundationSes.shopSesIdentityArn;
export const shopSesIdentityType = foundationSes.shopSesIdentityType;
export const shopSesVerificationStatus = foundationSes.shopSesVerificationStatus;
export const shopSesVerifiedForSendingStatus = foundationSes.shopSesVerifiedForSendingStatus;
export const shopServiceArn = computeServices.shopServiceArn;
export const shopServiceName = computeServices.shopServiceName;
export const shopTaskDefinitionArn = computeServices.shopTaskDefinitionArn;
export const shopTaskRoleArn = computeServices.shopTaskRoleArn;
export const shopTaskRoleName = computeServices.shopTaskRoleName;
export const shopTargetGroupArn = computeEdge?.shopTargetGroupArn ?? null;
export const shopTargetGroupName = computeEdge?.shopTargetGroupName ?? null;
export const securityGroupIds = foundationSecurityGroups.securityGroupIds;
export const sharedInfraManagedByThisStack = isSharedInfraOwner;
export const sharedInfraOwner = sharedInfraOwnerStack;
export const createdSharedRepositories = foundationEcr.createdSharedRepositories;
export const albSecurityGroupId = foundationSecurityGroups.securityGroupIds.alb;
export const albAccessLogsBucketArn = computeEdge?.albAccessLogsBucketArn ?? null;
export const albAccessLogsBucketName = computeEdge?.albAccessLogsBucketName ?? null;
export const ecsSecurityGroupId = foundationSecurityGroups.securityGroupIds.ecs;
export const mqSecurityGroupId = foundationSecurityGroups.securityGroupIds.mq;
export const mqBrokerArn = messageQueue.mqBrokerArn;
export const mqBrokerConsoleUrl = messageQueue.mqBrokerConsoleUrl;
export const mqBrokerDeploymentMode = messageQueue.mqBrokerDeploymentMode;
export const mqBrokerEndpoint = messageQueue.mqBrokerEndpoint;
export const mqBrokerEngineVersion = messageQueue.mqBrokerEngineVersion;
export const mqBrokerHost = messageQueue.mqBrokerHost;
export const mqBrokerId = messageQueue.mqBrokerId;
export const mqBrokerName = messageQueue.mqBrokerName;
export const mqBrokerPort = messageQueue.mqBrokerPort;
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
