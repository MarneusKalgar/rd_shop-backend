import {
  accountId,
  isSharedInfraOwner,
  projectPrefix,
  region,
  resourcePrefix,
  sharedInfraOwnerStack,
  stack,
} from './src/bootstrap';
import { createFoundationNetwork } from './src/foundation/network';

// Step 1: bootstrap/runtime context lives in src/bootstrap.ts.
// Step 2: phase modules own their resources under src/foundation/*.
// Step 3: index.ts stays thin and exports values other phases and CI need.
const foundationNetwork = createFoundationNetwork();

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
export const sharedInfraManagedByThisStack = isSharedInfraOwner;
export const sharedInfraOwner = sharedInfraOwnerStack;
export const vpcCidr = foundationNetwork.vpcCidr;
export const vpcEndpointIds = foundationNetwork.vpcEndpointIds;
export const vpcId = foundationNetwork.vpcId;

export {
  createdSharedRepositories,
  paymentsRepositoryArn,
  paymentsRepositoryName,
  paymentsRepositoryUrl,
  shopRepositoryArn,
  shopRepositoryName,
  shopRepositoryUrl,
} from './src/foundation/ecr';
export { accountId, region };
