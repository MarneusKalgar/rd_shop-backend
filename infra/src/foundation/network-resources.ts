import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { commonTags, region, stackName } from '../bootstrap';

interface AssociateSubnetsWithRouteTableArgs {
  routeTableAssociationPrefix: string;
  routeTableId: pulumi.Input<string>;
  subnets: aws.ec2.Subnet[];
}

interface CreateEndpointSecurityGroupArgs {
  anyIpv4Cidr: string;
  endpointHttpsPort: number;
  privateSubnetCidrs: string[];
  vpcId: pulumi.Input<string>;
}

interface CreateInterfaceEndpointArgs {
  logicalName: string;
  securityGroupId: pulumi.Input<string>;
  serviceSuffix: string;
  subnetIds: pulumi.Input<string>[];
  vpcId: pulumi.Input<string>;
}

interface CreateNatSecurityGroupArgs {
  allTrafficPort: number;
  anyIpv4Cidr: string;
  privateSubnetCidrs: string[];
  vpcId: pulumi.Input<string>;
}

interface CreateSubnetsArgs {
  availabilityZones: pulumi.Output<string[]>;
  cidrBlocks: string[];
  mapPublicIpOnLaunch: boolean;
  scope: 'private' | 'public';
  subnetNamePrefix: string;
  vpcId: pulumi.Input<string>;
}

// Uses for...of intentionally so resource side effects stay explicit and easy to follow.
export function associateSubnetsWithRouteTable({
  routeTableAssociationPrefix,
  routeTableId,
  subnets,
}: AssociateSubnetsWithRouteTableArgs) {
  for (const [index, subnet] of subnets.entries()) {
    new aws.ec2.RouteTableAssociation(stackName(`${routeTableAssociationPrefix}-${index + 1}`), {
      routeTableId,
      subnetId: subnet.id,
    });
  }
}

// Interface endpoints expose AWS APIs inside private subnets over HTTPS only.
export function createEndpointSecurityGroup({
  anyIpv4Cidr,
  endpointHttpsPort,
  privateSubnetCidrs,
  vpcId,
}: CreateEndpointSecurityGroupArgs) {
  return new aws.ec2.SecurityGroup(stackName('endpoint-sg'), {
    description: 'Allow private subnets to reach interface VPC endpoints over HTTPS.',
    egress: [
      {
        cidrBlocks: [anyIpv4Cidr],
        description: 'Allow endpoint responses.',
        fromPort: 0,
        protocol: '-1',
        toPort: 0,
      },
    ],
    ingress: [
      {
        cidrBlocks: privateSubnetCidrs,
        description: 'Allow HTTPS from private subnets.',
        fromPort: endpointHttpsPort,
        protocol: 'tcp',
        toPort: endpointHttpsPort,
      },
    ],
    tags: {
      ...commonTags,
      Component: 'network',
      Name: stackName('endpoint-sg'),
      Scope: 'private',
    },
    vpcId,
  });
}

// Wraps repetitive VPC endpoint creation so each call site only declares which AWS service it needs.
export function createInterfaceEndpoint({
  logicalName,
  securityGroupId,
  serviceSuffix,
  subnetIds,
  vpcId,
}: CreateInterfaceEndpointArgs) {
  return new aws.ec2.VpcEndpoint(stackName(logicalName), {
    privateDnsEnabled: true,
    securityGroupIds: [securityGroupId],
    serviceName: `com.amazonaws.${region}.${serviceSuffix}`,
    subnetIds,
    tags: {
      ...commonTags,
      Component: 'network',
      Name: stackName(logicalName),
      Scope: 'private',
    },
    vpcEndpointType: 'Interface',
    vpcId,
  });
}

// NAT SG accepts traffic only from private subnet CIDRs, then forwards it to internet.
export function createNatSecurityGroup({
  allTrafficPort,
  anyIpv4Cidr,
  privateSubnetCidrs,
  vpcId,
}: CreateNatSecurityGroupArgs) {
  return new aws.ec2.SecurityGroup(stackName('nat-sg'), {
    description: 'Allow private subnets to use NAT instance for outbound traffic.',
    egress: [
      {
        cidrBlocks: [anyIpv4Cidr],
        description: 'Allow NAT outbound internet access.',
        fromPort: allTrafficPort,
        protocol: '-1',
        toPort: allTrafficPort,
      },
    ],
    ingress: [
      {
        cidrBlocks: privateSubnetCidrs,
        description: 'Allow private subnets to forward outbound traffic through NAT.',
        fromPort: allTrafficPort,
        protocol: '-1',
        toPort: allTrafficPort,
      },
    ],
    tags: {
      ...commonTags,
      Component: 'network',
      Name: stackName('nat-sg'),
      Scope: 'public',
    },
    vpcId,
  });
}

// Creates one subnet per CIDR block and aligns each one with the matching AZ index.
export function createSubnets({
  availabilityZones,
  cidrBlocks,
  mapPublicIpOnLaunch,
  scope,
  subnetNamePrefix,
  vpcId,
}: CreateSubnetsArgs) {
  return cidrBlocks.map((cidrBlock, index) => {
    const logicalName = `${subnetNamePrefix}-${index + 1}`;

    return new aws.ec2.Subnet(stackName(logicalName), {
      availabilityZone: availabilityZones.apply((names) => names[index]),
      cidrBlock,
      mapPublicIpOnLaunch,
      tags: {
        ...commonTags,
        Component: 'network',
        Name: stackName(logicalName),
        Scope: scope,
      },
      vpcId,
    });
  });
}
