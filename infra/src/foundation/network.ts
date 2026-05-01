import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { commonTags, region, stackName } from '../bootstrap';
import {
  endpointServiceSuffixes,
  getFoundationAvailabilityZones,
  getFoundationNetworkConfig,
  resolveNatInstanceAmiId,
} from './network-config';
import { buildNatInstanceUserData } from './network-nat-user-data';
import {
  associateSubnetsWithRouteTable,
  createEndpointSecurityGroup,
  createInterfaceEndpoint,
  createNatSecurityGroup,
  createSubnets,
} from './network-resources';

/**
 * Step 0.2 / foundation network.
 * Accepts no arguments.
 * Creates the VPC, subnets, route tables, NAT instance, and AWS endpoints, then returns the network IDs every later step composes on top of.
 */
export function createFoundationNetwork() {
  const networkConfig = getFoundationNetworkConfig();
  const availabilityZones = getFoundationAvailabilityZones(
    networkConfig.requiredAvailabilityZoneCount,
  );
  const natInstanceAmiId = resolveNatInstanceAmiId(networkConfig);

  // Base network with DNS support enabled so later ECS/Cloud Map phases can resolve private names.
  const vpc = new aws.ec2.Vpc(stackName('vpc'), {
    cidrBlock: networkConfig.vpcCidr,
    enableDnsHostnames: true,
    enableDnsSupport: true,
    tags: {
      ...commonTags,
      Component: 'network',
      Name: stackName('vpc'),
      Scope: 'shared',
    },
  });

  const internetGateway = new aws.ec2.InternetGateway(stackName('igw'), {
    tags: {
      ...commonTags,
      Component: 'network',
      Name: stackName('igw'),
      Scope: 'public',
    },
    vpcId: vpc.id,
  });

  // Public route table serves internet-facing subnets and future ALB resources.
  const publicRouteTable = new aws.ec2.RouteTable(stackName('public-rt'), {
    tags: {
      ...commonTags,
      Component: 'network',
      Name: stackName('public-rt'),
      Scope: 'public',
    },
    vpcId: vpc.id,
  });

  new aws.ec2.Route(stackName('public-default-route'), {
    destinationCidrBlock: networkConfig.anyIpv4Cidr,
    gatewayId: internetGateway.id,
    routeTableId: publicRouteTable.id,
  });

  // Public tier: ingress points and NAT host live here.
  const publicSubnets = createSubnets({
    availabilityZones,
    cidrBlocks: networkConfig.publicSubnetCidrs,
    mapPublicIpOnLaunch: true,
    scope: 'public',
    subnetNamePrefix: 'public-subnet',
    vpcId: vpc.id,
  });

  associateSubnetsWithRouteTable({
    routeTableAssociationPrefix: 'public-rta',
    routeTableId: publicRouteTable.id,
    subnets: publicSubnets,
  });

  // NAT host bridges private subnets to internet without paying NAT Gateway cost in stage.
  const natSecurityGroup = createNatSecurityGroup({
    allTrafficPort: networkConfig.allTrafficPort,
    anyIpv4Cidr: networkConfig.anyIpv4Cidr,
    privateSubnetCidrs: networkConfig.privateSubnetCidrs,
    vpcId: vpc.id,
  });

  const natInstance = new aws.ec2.Instance(
    stackName('nat-instance'),
    {
      ami: natInstanceAmiId,
      associatePublicIpAddress: true,
      instanceType: networkConfig.natInstanceType,
      metadataOptions: {
        httpEndpoint: 'enabled',
        httpTokens: 'required',
      },
      sourceDestCheck: false,
      subnetId: publicSubnets[0].id,
      tags: {
        ...commonTags,
        Component: 'network',
        Name: stackName('nat-instance'),
        Scope: 'public',
      },
      userData: buildNatInstanceUserData(),
      userDataReplaceOnChange: true,
      vpcSecurityGroupIds: [natSecurityGroup.id],
    },
    {
      deleteBeforeReplace: true,
    },
  );

  const natElasticIp = new aws.ec2.Eip(stackName('nat-eip'), {
    domain: 'vpc',
    tags: {
      ...commonTags,
      Component: 'network',
      Name: stackName('nat-eip'),
      Scope: 'public',
    },
  });

  new aws.ec2.EipAssociation(stackName('nat-eip-association'), {
    allocationId: natElasticIp.id,
    instanceId: natInstance.id,
  });

  // Private route table sends default outbound traffic through NAT instance.
  const privateRouteTable = new aws.ec2.RouteTable(stackName('private-rt'), {
    tags: {
      ...commonTags,
      Component: 'network',
      Name: stackName('private-rt'),
      Scope: 'private',
    },
    vpcId: vpc.id,
  });

  new aws.ec2.Route(
    stackName('private-default-route'),
    {
      destinationCidrBlock: networkConfig.anyIpv4Cidr,
      networkInterfaceId: natInstance.primaryNetworkInterfaceId,
      routeTableId: privateRouteTable.id,
    },
    {
      deleteBeforeReplace: true,
      replaceOnChanges: ['networkInterfaceId'],
    },
  );

  // Private tier holds ECS, RDS, MQ, and other non-public resources in later phases.
  const privateSubnets = createSubnets({
    availabilityZones,
    cidrBlocks: networkConfig.privateSubnetCidrs,
    mapPublicIpOnLaunch: false,
    scope: 'private',
    subnetNamePrefix: 'private-subnet',
    vpcId: vpc.id,
  });

  associateSubnetsWithRouteTable({
    routeTableAssociationPrefix: 'private-rta',
    routeTableId: privateRouteTable.id,
    subnets: privateSubnets,
  });

  // Interface endpoints keep AWS control-plane traffic inside VPC where possible.
  const endpointSecurityGroup = createEndpointSecurityGroup({
    anyIpv4Cidr: networkConfig.anyIpv4Cidr,
    endpointHttpsPort: networkConfig.endpointHttpsPort,
    privateSubnetCidrs: networkConfig.privateSubnetCidrs,
    vpcId: vpc.id,
  });

  const privateSubnetIds = privateSubnets.map((subnet) => subnet.id);

  const interfaceEndpoints = {
    ecrApi: createInterfaceEndpoint({
      logicalName: 'vpce-ecr-api',
      securityGroupId: endpointSecurityGroup.id,
      serviceSuffix: endpointServiceSuffixes.ecrApi,
      subnetIds: privateSubnetIds,
      vpcId: vpc.id,
    }),
    ecrDkr: createInterfaceEndpoint({
      logicalName: 'vpce-ecr-dkr',
      securityGroupId: endpointSecurityGroup.id,
      serviceSuffix: endpointServiceSuffixes.ecrDkr,
      subnetIds: privateSubnetIds,
      vpcId: vpc.id,
    }),
    ecs: createInterfaceEndpoint({
      logicalName: 'vpce-ecs',
      securityGroupId: endpointSecurityGroup.id,
      serviceSuffix: endpointServiceSuffixes.ecs,
      subnetIds: privateSubnetIds,
      vpcId: vpc.id,
    }),
    ecsAgent: createInterfaceEndpoint({
      logicalName: 'vpce-ecs-agent',
      securityGroupId: endpointSecurityGroup.id,
      serviceSuffix: endpointServiceSuffixes.ecsAgent,
      subnetIds: privateSubnetIds,
      vpcId: vpc.id,
    }),
    ecsTelemetry: createInterfaceEndpoint({
      logicalName: 'vpce-ecs-telemetry',
      securityGroupId: endpointSecurityGroup.id,
      serviceSuffix: endpointServiceSuffixes.ecsTelemetry,
      subnetIds: privateSubnetIds,
      vpcId: vpc.id,
    }),
    logs: createInterfaceEndpoint({
      logicalName: 'vpce-logs',
      securityGroupId: endpointSecurityGroup.id,
      serviceSuffix: endpointServiceSuffixes.logs,
      subnetIds: privateSubnetIds,
      vpcId: vpc.id,
    }),
    secretsManager: createInterfaceEndpoint({
      logicalName: 'vpce-secretsmanager',
      securityGroupId: endpointSecurityGroup.id,
      serviceSuffix: endpointServiceSuffixes.secretsManager,
      subnetIds: privateSubnetIds,
      vpcId: vpc.id,
    }),
  };

  // S3 uses gateway endpoint instead of interface endpoints, so it attaches to private route table.
  const s3Endpoint = new aws.ec2.VpcEndpoint(stackName('vpce-s3'), {
    routeTableIds: [privateRouteTable.id],
    serviceName: `com.amazonaws.${region}.${endpointServiceSuffixes.s3}`,
    tags: {
      ...commonTags,
      Component: 'network',
      Name: stackName('vpce-s3'),
      Scope: 'private',
    },
    vpcEndpointType: 'Gateway',
    vpcId: vpc.id,
  });

  // Outputs intentionally expose network IDs now so next phases can compose on top without lookups.
  return {
    availabilityZones,
    natElasticIpAllocationId: natElasticIp.id,
    natInstanceId: natInstance.id,
    natInstanceType: networkConfig.natInstanceType,
    natPublicIp: natElasticIp.publicIp,
    privateRouteTableId: privateRouteTable.id,
    privateSubnetCidrs: networkConfig.privateSubnetCidrs,
    privateSubnetIds: pulumi.all(privateSubnetIds),
    publicRouteTableId: publicRouteTable.id,
    publicSubnetCidrs: networkConfig.publicSubnetCidrs,
    publicSubnetIds: pulumi.all(publicSubnets.map((subnet) => subnet.id)),
    vpcCidr: networkConfig.vpcCidr,
    vpcEndpointIds: {
      ecrApi: interfaceEndpoints.ecrApi.id,
      ecrDkr: interfaceEndpoints.ecrDkr.id,
      ecs: interfaceEndpoints.ecs.id,
      ecsAgent: interfaceEndpoints.ecsAgent.id,
      ecsTelemetry: interfaceEndpoints.ecsTelemetry.id,
      logs: interfaceEndpoints.logs.id,
      s3: s3Endpoint.id,
      secretsManager: interfaceEndpoints.secretsManager.id,
    },
    vpcId: vpc.id,
  };
}
