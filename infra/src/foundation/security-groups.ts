import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { commonTags, stackName } from '../bootstrap';
import { getFoundationSecurityGroupConfig } from './security-group-config';

const rabbitmqAmqpPort = 5672;

interface CreateCidrRuleArgs extends CreateSecurityGroupRuleArgs {
  cidrBlocks: string[];
}

interface CreateFoundationSecurityGroupsArgs {
  vpcId: pulumi.Input<string>;
}

interface CreateSecurityGroupArgs {
  description: string;
  logicalName: string;
  scope: 'private' | 'public';
  vpcId: pulumi.Input<string>;
}

interface CreateSecurityGroupRuleArgs {
  description: string;
  fromPort: number;
  logicalName: string;
  protocol: string;
  securityGroupId: pulumi.Input<string>;
  toPort: number;
  type: 'egress' | 'ingress';
}

interface CreateSourceSecurityGroupRuleArgs extends CreateSecurityGroupRuleArgs {
  sourceSecurityGroupId: pulumi.Input<string>;
}

/**
 * Step 0.3 / foundation security.
 * Accepts the VPC id that owns the security boundaries.
 * Creates the ALB, ECS, RDS, and RabbitMQ security groups plus their explicit ingress and egress rules.
 */
export function createFoundationSecurityGroups({ vpcId }: CreateFoundationSecurityGroupsArgs) {
  const securityGroupConfig = getFoundationSecurityGroupConfig();

  const albSecurityGroup = createSecurityGroup({
    description: 'Public ALB security group.',
    logicalName: 'sg-alb',
    scope: 'public',
    vpcId,
  });

  const ecsSecurityGroup = createSecurityGroup({
    description: 'Shared ECS host security group for shop and payments tasks.',
    logicalName: 'sg-ecs',
    scope: 'private',
    vpcId,
  });

  const rdsShopSecurityGroup = createSecurityGroup({
    description: 'Shop database security group.',
    logicalName: 'sg-rds-shop',
    scope: 'private',
    vpcId,
  });

  const rdsPaymentsSecurityGroup = createSecurityGroup({
    description: 'Payments database security group.',
    logicalName: 'sg-rds-payments',
    scope: 'private',
    vpcId,
  });

  const mqSecurityGroup = createSecurityGroup({
    description: 'Dedicated RabbitMQ broker security group.',
    logicalName: 'sg-mq',
    scope: 'private',
    vpcId,
  });

  // ALB accepts public HTTP/HTTPS only.
  createCidrRule({
    cidrBlocks: securityGroupConfig.publicIngressIpv4Cidrs,
    description: 'Allow public HTTP traffic to ALB.',
    fromPort: securityGroupConfig.ports.albHttp,
    logicalName: 'sg-alb-ingress-http-public',
    protocol: securityGroupConfig.tcpProtocol,
    securityGroupId: albSecurityGroup.id,
    toPort: securityGroupConfig.ports.albHttp,
    type: 'ingress',
  });

  createCidrRule({
    cidrBlocks: securityGroupConfig.publicIngressIpv4Cidrs,
    description: 'Allow public HTTPS traffic to ALB.',
    fromPort: securityGroupConfig.ports.albHttps,
    logicalName: 'sg-alb-ingress-https-public',
    protocol: securityGroupConfig.tcpProtocol,
    securityGroupId: albSecurityGroup.id,
    toPort: securityGroupConfig.ports.albHttps,
    type: 'ingress',
  });

  // ECS instances accept app traffic from ALB and east-west task traffic from themselves.
  createSourceSecurityGroupRule({
    description: 'Allow ALB traffic to ECS dynamic host ports for shop tasks.',
    fromPort: securityGroupConfig.ports.ecsDynamicHostPortRangeStart,
    logicalName: 'sg-ecs-ingress-shop-from-alb',
    protocol: securityGroupConfig.tcpProtocol,
    securityGroupId: ecsSecurityGroup.id,
    sourceSecurityGroupId: albSecurityGroup.id,
    toPort: securityGroupConfig.ports.ecsDynamicHostPortRangeEnd,
    type: 'ingress',
  });

  createSelfRule({
    description: 'Allow ECS self traffic on payments gRPC port.',
    fromPort: securityGroupConfig.ports.ecsPaymentsGrpc,
    logicalName: 'sg-ecs-ingress-payments-self',
    protocol: securityGroupConfig.tcpProtocol,
    securityGroupId: ecsSecurityGroup.id,
    toPort: securityGroupConfig.ports.ecsPaymentsGrpc,
    type: 'ingress',
  });

  createSelfRule({
    description: 'Allow ECS self traffic on shop HTTP port.',
    fromPort: securityGroupConfig.ports.ecsShopHttp,
    logicalName: 'sg-ecs-ingress-shop-self',
    protocol: securityGroupConfig.tcpProtocol,
    securityGroupId: ecsSecurityGroup.id,
    toPort: securityGroupConfig.ports.ecsShopHttp,
    type: 'ingress',
  });

  // Data-plane services trust ECS only.
  createSourceSecurityGroupRule({
    description: 'Allow ECS access to shop Postgres.',
    fromPort: securityGroupConfig.ports.postgres,
    logicalName: 'sg-rds-shop-ingress-postgres-from-ecs',
    protocol: securityGroupConfig.tcpProtocol,
    securityGroupId: rdsShopSecurityGroup.id,
    sourceSecurityGroupId: ecsSecurityGroup.id,
    toPort: securityGroupConfig.ports.postgres,
    type: 'ingress',
  });

  createSourceSecurityGroupRule({
    description: 'Allow ECS access to payments Postgres.',
    fromPort: securityGroupConfig.ports.postgres,
    logicalName: 'sg-rds-payments-ingress-postgres-from-ecs',
    protocol: securityGroupConfig.tcpProtocol,
    securityGroupId: rdsPaymentsSecurityGroup.id,
    sourceSecurityGroupId: ecsSecurityGroup.id,
    toPort: securityGroupConfig.ports.postgres,
    type: 'ingress',
  });

  createSourceSecurityGroupRule({
    description: 'Allow ECS access to dedicated RabbitMQ over AMQP.',
    fromPort: rabbitmqAmqpPort,
    logicalName: 'sg-mq-ingress-amqp-from-ecs',
    protocol: securityGroupConfig.tcpProtocol,
    securityGroupId: mqSecurityGroup.id,
    sourceSecurityGroupId: ecsSecurityGroup.id,
    toPort: rabbitmqAmqpPort,
    type: 'ingress',
  });

  // Explicit egress keeps preview/diff obvious and avoids relying on AWS defaults.
  const securityGroups = [
    ['sg-alb-egress-all', albSecurityGroup.id],
    ['sg-ecs-egress-all', ecsSecurityGroup.id],
    ['sg-rds-shop-egress-all', rdsShopSecurityGroup.id],
    ['sg-rds-payments-egress-all', rdsPaymentsSecurityGroup.id],
    ['sg-mq-egress-all', mqSecurityGroup.id],
  ] as const;

  for (const [logicalName, securityGroupId] of securityGroups) {
    createCidrRule({
      cidrBlocks: [securityGroupConfig.anyIpv4Cidr],
      description: 'Allow outbound traffic to internet and VPC dependencies.',
      fromPort: securityGroupConfig.allTrafficPort,
      logicalName,
      protocol: securityGroupConfig.allProtocols,
      securityGroupId,
      toPort: securityGroupConfig.allTrafficPort,
      type: 'egress',
    });
  }

  return {
    securityGroupIds: {
      alb: albSecurityGroup.id,
      ecs: ecsSecurityGroup.id,
      mq: mqSecurityGroup.id,
      rdsPayments: rdsPaymentsSecurityGroup.id,
      rdsShop: rdsShopSecurityGroup.id,
    },
  };
}

/**
 * Step 0.3 rule helper.
 * Accepts the target security group id, CIDR blocks, port range, protocol, and rule metadata.
 * Creates one CIDR-based security-group rule resource.
 */
function createCidrRule({
  cidrBlocks,
  description,
  fromPort,
  logicalName,
  protocol,
  securityGroupId,
  toPort,
  type,
}: CreateCidrRuleArgs) {
  return new aws.ec2.SecurityGroupRule(stackName(logicalName), {
    cidrBlocks,
    description,
    fromPort,
    protocol,
    securityGroupId,
    toPort,
    type,
  });
}

/**
 * Step 0.3 group helper.
 * Accepts the VPC id, logical name, description, and scope tag.
 * Creates one security-group shell that later helper calls attach rules to.
 */
function createSecurityGroup({ description, logicalName, scope, vpcId }: CreateSecurityGroupArgs) {
  return new aws.ec2.SecurityGroup(stackName(logicalName), {
    description,
    name: stackName(logicalName),
    tags: {
      ...commonTags,
      Component: 'security',
      Name: stackName(logicalName),
      Scope: scope,
    },
    vpcId,
  });
}

/**
 * Step 0.3 rule helper.
 * Accepts the target security group id plus the port range, protocol, and metadata.
 * Creates one self-referencing ingress or egress rule.
 */
function createSelfRule({
  description,
  fromPort,
  logicalName,
  protocol,
  securityGroupId,
  toPort,
  type,
}: CreateSecurityGroupRuleArgs) {
  return new aws.ec2.SecurityGroupRule(stackName(logicalName), {
    description,
    fromPort,
    protocol,
    securityGroupId,
    self: true,
    toPort,
    type,
  });
}

/**
 * Step 0.3 rule helper.
 * Accepts the target security group id, source security group id, port range, protocol, and metadata.
 * Creates one security-group-to-security-group rule resource.
 */
function createSourceSecurityGroupRule({
  description,
  fromPort,
  logicalName,
  protocol,
  securityGroupId,
  sourceSecurityGroupId,
  toPort,
  type,
}: CreateSourceSecurityGroupRuleArgs) {
  return new aws.ec2.SecurityGroupRule(stackName(logicalName), {
    description,
    fromPort,
    protocol,
    securityGroupId,
    sourceSecurityGroupId,
    toPort,
    type,
  });
}
