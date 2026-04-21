import {
  accountId,
  isSharedInfraOwner,
  projectPrefix,
  region,
  resourcePrefix,
  sharedInfraOwnerStack,
  stack,
} from './src/bootstrap';
import { createFoundationEcr } from './src/foundation/ecr';
import { createFoundationNetwork } from './src/foundation/network';
import { createFoundationSecurityGroups } from './src/foundation/security-groups';

// Step 1: bootstrap/runtime context lives in src/bootstrap.ts.
// Step 2: foundation network owns Phase 0.2 resources.
// Step 3: foundation security owns Phase 0.3 resources.
// Step 4: foundation ECR owns Phase 0.4 shared registries.
// Step 5: index.ts stays thin and exports values other phases and CI need.
const foundationEcr = createFoundationEcr();
const foundationNetwork = createFoundationNetwork();
const foundationSecurityGroups = createFoundationSecurityGroups({
  vpcId: foundationNetwork.vpcId,
});

export const availabilityZones = foundationNetwork.availabilityZones;
export const currentStack = stack;
export const natElasticIpAllocationId = foundationNetwork.natElasticIpAllocationId;
export const natInstanceId = foundationNetwork.natInstanceId;
export const natInstanceType = foundationNetwork.natInstanceType;
export const natPublicIp = foundationNetwork.natPublicIp;
export const privateRouteTableId = foundationNetwork.privateRouteTableId;
export const privateSubnetCidrs = foundationNetwork.privateSubnetCidrs;
export const privateSubnetIds = foundationNetwork.privateSubnetIds;
export const project = projectPrefix;
export const publicRouteTableId = foundationNetwork.publicRouteTableId;
export const publicSubnetCidrs = foundationNetwork.publicSubnetCidrs;
export const publicSubnetIds = foundationNetwork.publicSubnetIds;
export const resourceNamePrefix = resourcePrefix;
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
