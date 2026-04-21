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

// Resolves region AZs and enforces Phase 0.2 rule: exactly two subnets per tier, one per AZ.
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

// Centralizes stack overrides and defaults so network.ts stays orchestration-only.
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

// Uses a vanilla Amazon Linux 2023 AMI for NAT bootstrap until ECS/compute phase adds dedicated images.
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
