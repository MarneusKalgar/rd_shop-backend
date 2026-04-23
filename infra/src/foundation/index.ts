import { createFoundationEcr } from './ecr';
import { createFoundationNetwork } from './network';
import { createFoundationSecurityGroups } from './security-groups';

export { createFoundationEcr } from './ecr';
export { createFoundationNetwork } from './network';
export { createFoundationSecurityGroups } from './security-groups';

/**
 * Step 0.2-0.4 / foundation orchestration.
 * Accepts no arguments.
 * Creates the shared ECR repositories plus the base network and security-group topology, then returns the grouped foundation outputs consumed by later phases.
 */
export function createFoundation() {
  // Step 0.4 / shared foundation: create shared ECR repositories before any task definitions resolve image URIs.
  const ecr = createFoundationEcr();

  // Step 0.2 / foundation network: create VPC, subnets, NAT, and endpoints that every later phase depends on.
  const network = createFoundationNetwork();

  // Step 0.3 / foundation security: attach the base security-group topology to the new VPC.
  const securityGroups = createFoundationSecurityGroups({
    vpcId: network.vpcId,
  });

  return {
    ecr,
    network,
    securityGroups,
  };
}
