import {
  accountId,
  isSharedInfraOwner,
  projectPrefix,
  region,
  resourcePrefix,
  sharedInfraOwnerStack,
  stack,
} from './src/bootstrap';
import { createComputeEdge, createComputeServices, createFoundationCompute } from './src/compute';
import {
  createFoundationDatabases,
  createFoundationFileStorage,
  createFoundationRuntimeConfig,
  createFoundationSes,
} from './src/data';
import { createFoundation } from './src/foundation';
import { createMessageBroker } from './src/messaging';
import { createObservability } from './src/observability';

// Step 0.2-0.4 / foundation: create shared registries plus the base network and security topology.
const foundation = createFoundation();

// Step 1.1 / data layer: provision both PostgreSQL instances, subnet group, and parameter group.
const foundationDatabases = createFoundationDatabases({
  privateSubnetIds: foundation.network.privateSubnetIds,
  securityGroupIds: {
    rdsPayments: foundation.securityGroups.securityGroupIds.rdsPayments,
    rdsShop: foundation.securityGroups.securityGroupIds.rdsShop,
  },
});

// Step 1.2 / data layer: create the private S3 bucket used by the shop file flow.
const foundationFileStorage = createFoundationFileStorage();

// Step 3 / messaging: provision the dedicated RabbitMQ EC2 broker in private subnets.
const messageQueue = createMessageBroker({
  privateSubnetIds: foundation.network.privateSubnetIds,
  securityGroupId: foundation.securityGroups.securityGroupIds.mq,
});

// Step 2.4-2.5 / edge: create the public ALB path or CloudFront/custom-domain edge entrypoint.
const computeEdge = createComputeEdge({
  albSecurityGroupId: foundation.securityGroups.securityGroupIds.alb,
  publicSubnetIds: foundation.network.publicSubnetIds,
  vpcId: foundation.network.vpcId,
});

// Step 1.3-1.4 / runtime config: publish service secrets and SSM parameters after data and broker endpoints exist.
const foundationRuntimeConfig = createFoundationRuntimeConfig({
  databaseBackend: foundationDatabases.databaseBackend,
  databases: {
    payments: {
      databaseHost: foundationDatabases.paymentsDatabaseAddress,
      databaseName: foundationDatabases.paymentsDatabaseName,
      databasePort: foundationDatabases.paymentsDatabasePort,
      databaseUsername: foundationDatabases.paymentsDatabaseUsername,
      masterUserSecretArn: foundationDatabases.paymentsDatabaseMasterUserSecretArn,
    },
    shop: {
      databaseHost: foundationDatabases.shopDatabaseAddress,
      databaseName: foundationDatabases.shopDatabaseName,
      databasePort: foundationDatabases.shopDatabasePort,
      databaseUsername: foundationDatabases.shopDatabaseUsername,
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
  publicAppUrl: computeEdge?.publicEndpointUrl,
});

// Step 1.5 / mail: register the SES sender identity once runtime config is settled.
const foundationSes = createFoundationSes();

// Step 2.2 / compute: create the ECS cluster, EC2 capacity, and host bootstrap path.
const foundationCompute = createFoundationCompute({
  privateSubnetIds: foundation.network.privateSubnetIds,
  securityGroupId: foundation.securityGroups.securityGroupIds.ecs,
});

// Step 2.3-2.4 / compute services: create task definitions, Cloud Map, IAM roles, and ECS services.
const computeServices = createComputeServices({
  capacityProviderName: foundationCompute.ecsCapacityProviderName,
  clusterArn: foundationCompute.ecsClusterArn,
  ecr: {
    paymentsRepositoryUrl: foundation.ecr.paymentsRepositoryUrl,
    shopRepositoryUrl: foundation.ecr.shopRepositoryUrl,
  },
  edge: computeEdge
    ? {
        shopLoadBalancerDependency: computeEdge.shopLoadBalancerDependency,
        shopTargetGroupArn: computeEdge.shopTargetGroupArn,
      }
    : undefined,
  fileStorage: {
    filesBucketArn: foundationFileStorage.filesBucketArn,
  },
  network: {
    vpcId: foundation.network.vpcId,
  },
  runtimeConfig: {
    paymentsRuntimeParameterNames: foundationRuntimeConfig.paymentsRuntimeParameterNames,
    paymentsRuntimeSecretArn: foundationRuntimeConfig.paymentsRuntimeSecretArn,
    paymentsRuntimeSecretVersionId: foundationRuntimeConfig.paymentsRuntimeSecretVersionId,
    shopRuntimeParameterNames: foundationRuntimeConfig.shopRuntimeParameterNames,
    shopRuntimeSecretArn: foundationRuntimeConfig.shopRuntimeSecretArn,
    shopRuntimeSecretVersionId: foundationRuntimeConfig.shopRuntimeSecretVersionId,
  },
  ses: {
    shopSesIdentityArn: foundationSes.shopSesIdentityArn,
  },
});

const observability = createObservability({
  compute: {
    ecsClusterName: foundationCompute.ecsClusterName,
    paymentsLogGroupName: computeServices.paymentsLogGroupName,
    paymentsServiceName: computeServices.paymentsServiceName,
    shopLogGroupName: computeServices.shopLogGroupName,
    shopServiceName: computeServices.shopServiceName,
  },
  database: {
    databaseBackend: foundationDatabases.databaseBackend,
    databaseBootstrapInstanceId: foundationDatabases.databaseBootstrapInstanceId,
    paymentsDatabaseIdentifier: foundationDatabases.paymentsDatabaseIdentifier,
    shopDatabaseIdentifier: foundationDatabases.shopDatabaseIdentifier,
  },
  edge: computeEdge
    ? {
        publicAlbArnSuffix: computeEdge.publicAlbArnSuffix,
        publicEndpointUrl: computeEdge.publicEndpointUrl,
        shopTargetGroupArnSuffix: computeEdge.shopTargetGroupArnSuffix,
      }
    : undefined,
  messaging: {
    mqBrokerId: messageQueue.mqBrokerId,
  },
  network: {
    natInstanceId: foundation.network.natInstanceId,
  },
});

// Step 13 / exports: re-export stitched outputs so CI, later phases, and operators can consume one surface.
// Stack identity.
export const currentStack = stack;
export const project = projectPrefix;
export const resourceNamePrefix = resourcePrefix;
export const sharedInfraManagedByThisStack = isSharedInfraOwner;
export const sharedInfraOwner = sharedInfraOwnerStack;

// Foundation network: topology and routing.
export const availabilityZones = foundation.network.availabilityZones;
export const natElasticIpAllocationId = foundation.network.natElasticIpAllocationId;
export const natInstanceId = foundation.network.natInstanceId;
export const natInstanceType = foundation.network.natInstanceType;
export const natPublicIp = foundation.network.natPublicIp;
export const privateRouteTableId = foundation.network.privateRouteTableId;
export const privateSubnetCidrs = foundation.network.privateSubnetCidrs;
export const privateSubnetIds = foundation.network.privateSubnetIds;
export const publicRouteTableId = foundation.network.publicRouteTableId;
export const publicSubnetCidrs = foundation.network.publicSubnetCidrs;
export const publicSubnetIds = foundation.network.publicSubnetIds;
export const vpcCidr = foundation.network.vpcCidr;
export const vpcEndpointIds = foundation.network.vpcEndpointIds;
export const vpcId = foundation.network.vpcId;

// Foundation security groups.
export const securityGroupIds = foundation.securityGroups.securityGroupIds;
export const albSecurityGroupId = foundation.securityGroups.securityGroupIds.alb;
export const ecsSecurityGroupId = foundation.securityGroups.securityGroupIds.ecs;
export const mqSecurityGroupId = foundation.securityGroups.securityGroupIds.mq;
export const rdsPaymentsSecurityGroupId = foundation.securityGroups.securityGroupIds.rdsPayments;
export const rdsShopSecurityGroupId = foundation.securityGroups.securityGroupIds.rdsShop;

// Foundation ECR repositories.
export const createdSharedRepositories = foundation.ecr.createdSharedRepositories;
export const paymentsRepositoryArn = foundation.ecr.paymentsRepositoryArn;
export const paymentsRepositoryName = foundation.ecr.paymentsRepositoryName;
export const paymentsRepositoryUrl = foundation.ecr.paymentsRepositoryUrl;
export const shopRepositoryArn = foundation.ecr.shopRepositoryArn;
export const shopRepositoryName = foundation.ecr.shopRepositoryName;
export const shopRepositoryUrl = foundation.ecr.shopRepositoryUrl;

// Data layer: shared PostgreSQL resources.
export const databaseBackend = foundationDatabases.databaseBackend;
export const databaseBootstrapContainerName = foundationDatabases.databaseBootstrapContainerName;
export const databaseBootstrapInstanceId = foundationDatabases.databaseBootstrapInstanceId;
export const databaseParameterGroupName = foundationDatabases.databaseParameterGroupName;
export const databaseSubnetGroupName = foundationDatabases.databaseSubnetGroupName;

// Data layer: payments PostgreSQL instance.
export const paymentsDatabaseAddress = foundationDatabases.paymentsDatabaseAddress;
export const paymentsDatabaseEndpoint = foundationDatabases.paymentsDatabaseEndpoint;
export const paymentsDatabaseEngineVersion = foundationDatabases.paymentsDatabaseEngineVersion;
export const paymentsDatabaseIdentifier = foundationDatabases.paymentsDatabaseIdentifier;
export const paymentsDatabaseMasterUserSecretArn =
  foundationDatabases.paymentsDatabaseMasterUserSecretArn;
export const paymentsDatabaseName = foundationDatabases.paymentsDatabaseName;
export const paymentsDatabasePort = foundationDatabases.paymentsDatabasePort;
export const paymentsDatabaseUsername = foundationDatabases.paymentsDatabaseUsername;

// Data layer: shop PostgreSQL instance.
export const shopDatabaseAddress = foundationDatabases.shopDatabaseAddress;
export const shopDatabaseEndpoint = foundationDatabases.shopDatabaseEndpoint;
export const shopDatabaseEngineVersion = foundationDatabases.shopDatabaseEngineVersion;
export const shopDatabaseIdentifier = foundationDatabases.shopDatabaseIdentifier;
export const shopDatabaseMasterUserSecretArn = foundationDatabases.shopDatabaseMasterUserSecretArn;
export const shopDatabaseName = foundationDatabases.shopDatabaseName;
export const shopDatabasePort = foundationDatabases.shopDatabasePort;
export const shopDatabaseUsername = foundationDatabases.shopDatabaseUsername;

// Data layer: file storage.
export const filesBucketArn = foundationFileStorage.filesBucketArn;
export const filesBucketName = foundationFileStorage.filesBucketName;
export const filesBucketRegionalDomainName = foundationFileStorage.filesBucketRegionalDomainName;

// Runtime config: payments service inputs.
export const paymentsRuntimeParameterNames = foundationRuntimeConfig.paymentsRuntimeParameterNames;
export const paymentsRuntimeSecretArn = foundationRuntimeConfig.paymentsRuntimeSecretArn;
export const paymentsRuntimeSecretName = foundationRuntimeConfig.paymentsRuntimeSecretName;
export const paymentsRuntimeSecretVersionId =
  foundationRuntimeConfig.paymentsRuntimeSecretVersionId;

// Runtime config: shop service inputs.
export const shopRuntimeParameterNames = foundationRuntimeConfig.shopRuntimeParameterNames;
export const shopRuntimeSecretArn = foundationRuntimeConfig.shopRuntimeSecretArn;
export const shopRuntimeSecretName = foundationRuntimeConfig.shopRuntimeSecretName;
export const shopRuntimeSecretVersionId = foundationRuntimeConfig.shopRuntimeSecretVersionId;

// Mail: SES identity.
export const shopSesFromAddress = foundationSes.shopSesFromAddress;
export const shopSesIdentity = foundationSes.shopSesIdentity;
export const shopSesIdentityArn = foundationSes.shopSesIdentityArn;
export const shopSesIdentityType = foundationSes.shopSesIdentityType;
export const shopSesVerificationStatus = foundationSes.shopSesVerificationStatus;
export const shopSesVerifiedForSendingStatus = foundationSes.shopSesVerifiedForSendingStatus;

// Compute foundation: cluster and EC2 capacity.
export const ecsAutoScalingGroupArn = foundationCompute.ecsAutoScalingGroupArn;
export const ecsAutoScalingGroupName = foundationCompute.ecsAutoScalingGroupName;
export const ecsCapacityProviderArn = foundationCompute.ecsCapacityProviderArn;
export const ecsCapacityProviderName = foundationCompute.ecsCapacityProviderName;
export const ecsClusterArn = foundationCompute.ecsClusterArn;
export const ecsClusterName = foundationCompute.ecsClusterName;
export const ecsInstanceProfileArn = foundationCompute.ecsInstanceProfileArn;
export const ecsInstanceProfileName = foundationCompute.ecsInstanceProfileName;
export const ecsInstanceRoleArn = foundationCompute.ecsInstanceRoleArn;
export const ecsInstanceRoleName = foundationCompute.ecsInstanceRoleName;
export const ecsLaunchTemplateId = foundationCompute.ecsLaunchTemplateId;
export const ecsLaunchTemplateLatestVersion = foundationCompute.ecsLaunchTemplateLatestVersion;
export const ecsOptimizedAmiId = foundationCompute.ecsOptimizedAmiId;

// Compute services: shared IAM and discovery.
export const ecsTaskExecutionRoleArn = computeServices.ecsTaskExecutionRoleArn;
export const ecsTaskExecutionRoleName = computeServices.ecsTaskExecutionRoleName;
export const paymentsDiscoveryServiceArn = computeServices.paymentsDiscoveryServiceArn;
export const paymentsDiscoveryServiceId = computeServices.paymentsDiscoveryServiceId;
export const paymentsDiscoveryServiceName = computeServices.paymentsDiscoveryServiceName;
export const privateDnsNamespaceArn = computeServices.privateDnsNamespaceArn;
export const privateDnsNamespaceId = computeServices.privateDnsNamespaceId;
export const privateDnsNamespaceName = computeServices.privateDnsNamespaceName;

// Compute services: payments workload.
export const paymentsDesiredCount = computeServices.paymentsDesiredCount;
export const paymentsImageUri = computeServices.paymentsImageUri;
export const paymentsLogGroupName = computeServices.paymentsLogGroupName;
export const paymentsServiceArn = computeServices.paymentsServiceArn;
export const paymentsServiceDiscoveryHost = computeServices.paymentsServiceDiscoveryHost;
export const paymentsServiceName = computeServices.paymentsServiceName;
export const paymentsTaskDefinitionArn = computeServices.paymentsTaskDefinitionArn;
export const paymentsTaskRoleArn = computeServices.paymentsTaskRoleArn;
export const paymentsTaskRoleName = computeServices.paymentsTaskRoleName;

// Compute services: shop workload.
export const shopDesiredCount = computeServices.shopDesiredCount;
export const shopImageUri = computeServices.shopImageUri;
export const shopLogGroupName = computeServices.shopLogGroupName;
export const shopServiceArn = computeServices.shopServiceArn;
export const shopServiceName = computeServices.shopServiceName;
export const shopTaskDefinitionArn = computeServices.shopTaskDefinitionArn;
export const shopTaskRoleArn = computeServices.shopTaskRoleArn;
export const shopTaskRoleName = computeServices.shopTaskRoleName;

// Public edge: ALB, CloudFront, DNS, and certificates.
export const albAccessLogsBucketArn = computeEdge?.albAccessLogsBucketArn ?? null;
export const albAccessLogsBucketName = computeEdge?.albAccessLogsBucketName ?? null;
export const publicAlbArn = computeEdge?.publicAlbArn ?? null;
export const publicAlbArnSuffix = computeEdge?.publicAlbArnSuffix ?? null;
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
export const publicCloudFrontDistributionArn = computeEdge?.publicCloudFrontDistributionArn ?? null;
export const publicCloudFrontDistributionDomainName =
  computeEdge?.publicCloudFrontDistributionDomainName ?? null;
export const publicCloudFrontDistributionHostedZoneId =
  computeEdge?.publicCloudFrontDistributionHostedZoneId ?? null;
export const publicCloudFrontDistributionId = computeEdge?.publicCloudFrontDistributionId ?? null;
export const publicEdgeMode = computeEdge?.publicEdgeMode ?? 'disabled';
export const publicEndpointEnabled = computeEdge !== undefined;
export const publicEndpointUrl = computeEdge?.publicEndpointUrl ?? null;
export const publicHostedZoneId = computeEdge?.publicHostedZoneId ?? null;
export const publicHostedZoneName = computeEdge?.publicHostedZoneName ?? null;
export const publicHostedZoneNameServers = computeEdge?.publicHostedZoneNameServers ?? null;
export const shopTargetGroupArn = computeEdge?.shopTargetGroupArn ?? null;
export const shopTargetGroupArnSuffix = computeEdge?.shopTargetGroupArnSuffix ?? null;
export const shopTargetGroupName = computeEdge?.shopTargetGroupName ?? null;

// Messaging: dedicated RabbitMQ broker.
export const mqBrokerArn = messageQueue.mqBrokerArn;
export const mqBrokerConsoleUrl = messageQueue.mqBrokerConsoleUrl;
export const mqBrokerDeploymentMode = messageQueue.mqBrokerDeploymentMode;
export const mqBrokerEndpoint = messageQueue.mqBrokerEndpoint;
export const mqBrokerEngineVersion = messageQueue.mqBrokerEngineVersion;
export const mqBrokerHost = messageQueue.mqBrokerHost;
export const mqBrokerId = messageQueue.mqBrokerId;
export const mqBrokerName = messageQueue.mqBrokerName;
export const mqBrokerPort = messageQueue.mqBrokerPort;

// Observability: CloudWatch dashboard and alarm topic.
export const alarmEmailEndpointCount = observability.alarmEmailEndpointCount;
export const applicationMetricsNamespace = observability.applicationMetricsNamespace;
export const alarmTopicArn = observability.alarmTopicArn;
export const alarmTopicName = observability.alarmTopicName;
export const observabilityDashboardName = observability.observabilityDashboardName;

export { accountId, region };
