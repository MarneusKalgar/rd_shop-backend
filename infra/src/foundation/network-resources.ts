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

/**
 * Step 0.2 network helper.
 * Accepts the route table id, a logical prefix, and the subnets to attach.
 * Creates one route-table association per subnet and returns nothing.
 */
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

/**
 * Step 0.2 endpoint helper.
 * Accepts the VPC id, private subnet CIDRs, HTTPS port, and fallback CIDR.
 * Creates the shared security group that protects interface VPC endpoints.
 */
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

/**
 * Step 0.2 endpoint helper.
 * Accepts the logical name, target service suffix, private subnet ids, VPC id, and endpoint security group id.
 * Creates one interface VPC endpoint and returns the endpoint resource.
 */
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

/**
 * Step 0.2 NAT helper.
 * Accepts the VPC id, private subnet CIDRs, and the shared any-traffic defaults.
 * Creates the NAT-instance security group that allows private-tier egress through the NAT host.
 */
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

/**
 * Step 0.2 subnet helper.
 * Accepts the AZ list, CIDR blocks, subnet scope, public-IP behavior, and VPC id.
 * Creates one subnet per CIDR block and returns the subnet resources in declaration order.
 */
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
