import * as aws from '@pulumi/aws';

import { config } from '../bootstrap';

const defaultPrivateSubnetCidrs = ['10.42.10.0/24', '10.42.11.0/24'];
const defaultPublicSubnetCidrs = ['10.42.0.0/24', '10.42.1.0/24'];
const defaultVpcCidr = '10.42.0.0/16';

const defaultNatInstanceType = 't3.micro';
const defaultRequiredAvailabilityZoneCount = 2;
const defaultAnyIpv4Cidr = '0.0.0.0/0';
const defaultEndpointHttpsPort = 443;
const defaultAllTrafficPort = 0;

const amazonLinuxOwnerId = '137112412989';
const natAmiArchitecture = 'x86_64';
const natAmiNamePattern = 'al2023-ami-2023*-x86_64';
const natAmiRootDeviceType = 'ebs';
const natAmiVirtualizationType = 'hvm';

export const endpointServiceSuffixes = {
  ecrApi: 'ecr.api',
  ecrDkr: 'ecr.dkr',
  ecs: 'ecs',
  ecsAgent: 'ecs-agent',
  ecsTelemetry: 'ecs-telemetry',
  logs: 'logs',
  s3: 's3',
  secretsManager: 'secretsmanager',
} as const;

export interface FoundationNetworkConfig {
  allTrafficPort: number;
  anyIpv4Cidr: string;
  endpointHttpsPort: number;
  natInstanceType: string;
  privateSubnetCidrs: string[];
  publicSubnetCidrs: string[];
  requiredAvailabilityZoneCount: number;
  vpcCidr: string;
}

/**
 * Step 0.2 config helper.
 * Accepts the number of availability zones the network layout requires.
 * Returns the first available AZ names after verifying the region can satisfy the subnet layout.
 */
export function getFoundationAvailabilityZones(requiredAvailabilityZoneCount: number) {
  return aws
    .getAvailabilityZonesOutput({
      state: 'available',
    })
    .names.apply((names) => {
      if (names.length < requiredAvailabilityZoneCount) {
        throw new Error(
          `Phase 0.2 requires at least ${requiredAvailabilityZoneCount} availability zones.`,
        );
      }

      return names.slice(0, requiredAvailabilityZoneCount);
    });
}

/**
 * Step 0.2 config helper.
 * Accepts no arguments.
 * Resolves the network defaults and stack overrides that `createFoundationNetwork` uses to build the VPC topology.
 */
export function getFoundationNetworkConfig(): FoundationNetworkConfig {
  const requiredAvailabilityZoneCount = defaultRequiredAvailabilityZoneCount;
  const privateSubnetCidrs =
    config.getObject<string[]>('privateSubnetCidrs') ?? defaultPrivateSubnetCidrs;
  const publicSubnetCidrs =
    config.getObject<string[]>('publicSubnetCidrs') ?? defaultPublicSubnetCidrs;

  validateSubnetCidrs('privateSubnetCidrs', privateSubnetCidrs, requiredAvailabilityZoneCount);
  validateSubnetCidrs('publicSubnetCidrs', publicSubnetCidrs, requiredAvailabilityZoneCount);

  return {
    allTrafficPort: defaultAllTrafficPort,
    anyIpv4Cidr: defaultAnyIpv4Cidr,
    endpointHttpsPort: defaultEndpointHttpsPort,
    natInstanceType: config.get('natInstanceType') ?? defaultNatInstanceType,
    privateSubnetCidrs,
    publicSubnetCidrs,
    requiredAvailabilityZoneCount,
    vpcCidr: config.get('vpcCidr') ?? defaultVpcCidr,
  };
}

/**
 * Step 0.2 AMI helper.
 * Accepts no arguments.
 * Returns the most recent Amazon Linux 2023 AMI used to bootstrap the NAT instance.
 */
export function getNatInstanceAmi() {
  return aws.ec2.getAmiOutput({
    filters: [
      {
        name: 'architecture',
        values: [natAmiArchitecture],
      },
      {
        name: 'name',
        values: [natAmiNamePattern],
      },
      {
        name: 'root-device-type',
        values: [natAmiRootDeviceType],
      },
      {
        name: 'virtualization-type',
        values: [natAmiVirtualizationType],
      },
    ],
    mostRecent: true,
    owners: [amazonLinuxOwnerId],
  });
}

/**
 * Step 0.2 validation helper.
 * Accepts the config label, configured subnet CIDRs, and required AZ count.
 * Throws when the subnet list cannot map one subnet per required availability zone.
 */
function validateSubnetCidrs(
  label: string,
  subnetCidrs: string[],
  requiredAvailabilityZoneCount: number,
) {
  if (subnetCidrs.length !== requiredAvailabilityZoneCount) {
    throw new Error(
      `${label} must contain exactly ${requiredAvailabilityZoneCount} CIDR blocks for Phase 0.2.`,
    );
  }
}
