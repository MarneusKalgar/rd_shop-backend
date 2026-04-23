import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { accountId, commonTags, isSharedInfraOwner, stack, stackName } from '../bootstrap';
import { getComputeEdgeConfig } from './edge-config';
import { shopServiceDefaults } from './service-definitions';

interface CreateComputeEdgeArgs {
  albSecurityGroupId: pulumi.Input<string>;
  publicSubnetIds: pulumi.Input<pulumi.Input<string>[]>;
  vpcId: pulumi.Input<string>;
}

const albAccessLogsAcl = 'bucket-owner-full-control';
const cloudFrontAlbOriginId = 'shop-public-alb-origin';
const cloudFrontAllViewerOriginRequestPolicyName = 'Managed-AllViewer';
const cloudFrontCachingDisabledPolicyName = 'Managed-CachingDisabled';
const cloudFrontPriceClass = 'PriceClass_100';
const dnsValidationTtlSeconds = 60;
const shopTargetGroupResourceName = `${stack}-shop-tg`;
const shopTargetGroupHealthCheckIntervalSeconds = 30;
const shopTargetGroupHealthCheckTimeoutSeconds = 5;
const shopTargetGroupHealthyThresholdCount = 2;
const shopTargetGroupPort = shopServiceDefaults.containerPort;
const shopTargetGroupUnhealthyThresholdCount = 3;

/**
 * Step 2.4-2.5 / public edge.
 * Accepts the ALB security-group id, public subnet ids, and VPC id.
 * Creates the ALB logging bucket, ALB, target group, and either the custom-domain path or the CloudFront path, then returns the public ingress metadata for exports and ECS wiring.
 */
export function createComputeEdge({
  albSecurityGroupId,
  publicSubnetIds,
  vpcId,
}: CreateComputeEdgeArgs) {
  const edgeConfig = getComputeEdgeConfig();

  if (!edgeConfig) {
    return undefined;
  }

  const albLogsBucket = new aws.s3.Bucket(stackName('alb-logs-bucket'), {
    bucket: edgeConfig.albAccessLogsBucketName,
    forceDestroy: stack !== 'production',
    tags: {
      ...commonTags,
      Component: 'edge',
      Name: edgeConfig.albAccessLogsBucketName,
      Scope: 'private',
    },
  });

  new aws.s3.BucketPublicAccessBlock(stackName('alb-logs-bucket-public-access-block'), {
    blockPublicAcls: true,
    blockPublicPolicy: true,
    bucket: albLogsBucket.id,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });

  new aws.s3.BucketOwnershipControls(stackName('alb-logs-bucket-ownership-controls'), {
    bucket: albLogsBucket.id,
    rule: {
      objectOwnership: 'BucketOwnerPreferred',
    },
  });

  new aws.s3.BucketServerSideEncryptionConfiguration(stackName('alb-logs-bucket-encryption'), {
    bucket: albLogsBucket.id,
    rules: [
      {
        applyServerSideEncryptionByDefault: {
          sseAlgorithm: 'AES256',
        },
      },
    ],
  });

  const elbServiceAccount = aws.elb.getServiceAccountOutput({});

  new aws.s3.BucketPolicy(stackName('alb-logs-bucket-policy'), {
    bucket: albLogsBucket.id,
    policy: pulumi.jsonStringify({
      Statement: [
        {
          Action: ['s3:GetBucketAcl'],
          Effect: 'Allow',
          Principal: {
            AWS: elbServiceAccount.arn,
          },
          Resource: albLogsBucket.arn,
          Sid: 'AllowAlbLogDeliveryAclCheck',
        },
        {
          Action: ['s3:PutObject'],
          Condition: {
            StringEquals: {
              's3:x-amz-acl': albAccessLogsAcl,
            },
          },
          Effect: 'Allow',
          Principal: {
            AWS: elbServiceAccount.arn,
          },
          Resource: pulumi.interpolate`${albLogsBucket.arn}/${edgeConfig.albAccessLogsPrefix}/AWSLogs/${accountId}/*`,
          Sid: 'AllowAlbLogDeliveryWrite',
        },
      ],
      Version: '2012-10-17',
    }),
  });

  const publicAlb = new aws.lb.LoadBalancer(stackName('public-alb'), {
    accessLogs: {
      bucket: albLogsBucket.bucket,
      enabled: true,
      prefix: edgeConfig.albAccessLogsPrefix,
    },
    enableDeletionProtection: edgeConfig.enableDeletionProtection,
    idleTimeout: edgeConfig.idleTimeoutSeconds,
    internal: false,
    loadBalancerType: 'application',
    securityGroups: [albSecurityGroupId],
    subnets: publicSubnetIds,
    tags: {
      ...commonTags,
      Component: 'edge',
      Name: stackName('public-alb'),
      Scope: 'public',
    },
  });

  const shopTargetGroup = new aws.lb.TargetGroup(stackName('shop-target-group'), {
    deregistrationDelay: edgeConfig.shopTargetGroupDeregistrationDelaySeconds,
    healthCheck: {
      enabled: true,
      healthyThreshold: shopTargetGroupHealthyThresholdCount,
      interval: shopTargetGroupHealthCheckIntervalSeconds,
      matcher: edgeConfig.shopTargetGroupHealthCheckMatcher,
      path: edgeConfig.shopTargetGroupHealthCheckPath,
      port: 'traffic-port',
      protocol: 'HTTP',
      timeout: shopTargetGroupHealthCheckTimeoutSeconds,
      unhealthyThreshold: shopTargetGroupUnhealthyThresholdCount,
    },
    name: shopTargetGroupResourceName,
    port: shopTargetGroupPort,
    protocol: 'HTTP',
    tags: {
      ...commonTags,
      Component: 'edge',
      Name: stackName('shop-target-group'),
      Scope: 'public',
      Service: 'shop',
    },
    targetType: 'instance',
    vpcId,
  });

  if (edgeConfig.publicEdgeMode === 'custom-domain') {
    const hostedZone = resolveHostedZone(edgeConfig.rootDomainName!, edgeConfig.hostedZoneId);

    const certificate = new aws.acm.Certificate(stackName('shop-certificate'), {
      domainName: edgeConfig.apiDomainName!,
      tags: {
        ...commonTags,
        Component: 'edge',
        Name: edgeConfig.apiDomainName!,
        Scope: 'public',
        Service: 'shop',
      },
      validationMethod: 'DNS',
    });

    const certificateValidationRecord = new aws.route53.Record(
      stackName('shop-certificate-validation-record'),
      {
        allowOverwrite: true,
        name: certificate.domainValidationOptions.apply(
          (options) => options[0]?.resourceRecordName ?? edgeConfig.apiDomainName!,
        ),
        records: [
          certificate.domainValidationOptions.apply(
            (options) => options[0]?.resourceRecordValue ?? edgeConfig.apiDomainName!,
          ),
        ],
        ttl: dnsValidationTtlSeconds,
        type: certificate.domainValidationOptions.apply(
          (options) => options[0]?.resourceRecordType ?? 'CNAME',
        ),
        zoneId: hostedZone.zoneId,
      },
    );

    const certificateValidation = new aws.acm.CertificateValidation(
      stackName('shop-certificate-validation'),
      {
        certificateArn: certificate.arn,
        validationRecordFqdns: [certificateValidationRecord.fqdn],
      },
    );

    const httpsListener = new aws.lb.Listener(
      stackName('public-alb-https-listener'),
      {
        certificateArn: certificateValidation.certificateArn,
        defaultActions: [
          {
            targetGroupArn: shopTargetGroup.arn,
            type: 'forward',
          },
        ],
        loadBalancerArn: publicAlb.arn,
        port: 443,
        protocol: 'HTTPS',
        sslPolicy: edgeConfig.sslPolicy,
      },
      {
        dependsOn: [certificateValidation],
      },
    );

    const httpListener = new aws.lb.Listener(stackName('public-alb-http-listener'), {
      defaultActions: [
        {
          redirect: {
            port: '443',
            protocol: 'HTTPS',
            statusCode: 'HTTP_301',
          },
          type: 'redirect',
        },
      ],
      loadBalancerArn: publicAlb.arn,
      port: 80,
      protocol: 'HTTP',
    });

    const apiAliasRecord = new aws.route53.Record(stackName('shop-api-alias-record'), {
      aliases: [
        {
          evaluateTargetHealth: true,
          name: publicAlb.dnsName,
          zoneId: publicAlb.zoneId,
        },
      ],
      name: edgeConfig.apiDomainName!,
      type: 'A',
      zoneId: hostedZone.zoneId,
    });

    return {
      albAccessLogsBucketArn: albLogsBucket.arn,
      albAccessLogsBucketName: albLogsBucket.bucket,
      publicAlbArn: publicAlb.arn,
      publicAlbDnsName: publicAlb.dnsName,
      publicAlbHttpListenerArn: httpListener.arn,
      publicAlbHttpsListenerArn: httpsListener.arn,
      publicAlbName: publicAlb.name,
      publicAlbZoneId: publicAlb.zoneId,
      publicApiAliasRecordFqdn: apiAliasRecord.fqdn,
      publicApiDomainName: edgeConfig.apiDomainName,
      publicCertificateArn: certificate.arn,
      publicCertificateDomainName: certificate.domainName,
      publicCertificateValidationRecordFqdn: certificateValidationRecord.fqdn,
      publicCloudFrontDistributionArn: null,
      publicCloudFrontDistributionDomainName: null,
      publicCloudFrontDistributionHostedZoneId: null,
      publicCloudFrontDistributionId: null,
      publicEdgeMode: edgeConfig.publicEdgeMode,
      publicEndpointUrl: pulumi.interpolate`https://${edgeConfig.apiDomainName}`,
      publicHostedZoneId: hostedZone.zoneId,
      publicHostedZoneName: hostedZone.name,
      publicHostedZoneNameServers: hostedZone.nameServers,
      shopLoadBalancerDependency: httpsListener,
      shopTargetGroupArn: shopTargetGroup.arn,
      shopTargetGroupName: shopTargetGroup.name,
    };
  }

  const cachePolicy = aws.cloudfront.getCachePolicyOutput({
    name: cloudFrontCachingDisabledPolicyName,
  });
  const originRequestPolicy = aws.cloudfront.getOriginRequestPolicyOutput({
    name: cloudFrontAllViewerOriginRequestPolicyName,
  });
  const cachePolicyId = cachePolicy.apply((policy) => {
    if (!policy.id) {
      throw new Error('Managed CloudFront caching-disabled policy lookup did not return an id.');
    }

    return policy.id;
  });
  const originRequestPolicyId = originRequestPolicy.apply((policy) => {
    if (!policy.id) {
      throw new Error('Managed CloudFront origin request policy lookup did not return an id.');
    }

    return policy.id;
  });

  const httpListener = new aws.lb.Listener(stackName('public-alb-http-listener'), {
    defaultActions: [
      {
        targetGroupArn: shopTargetGroup.arn,
        type: 'forward',
      },
    ],
    loadBalancerArn: publicAlb.arn,
    port: 80,
    protocol: 'HTTP',
  });

  const distribution = new aws.cloudfront.Distribution(stackName('shop-api-cloudfront'), {
    comment: 'Public HTTPS entrypoint for the shop API using the default CloudFront domain.',
    defaultCacheBehavior: {
      allowedMethods: ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
      cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
      cachePolicyId,
      compress: true,
      originRequestPolicyId,
      targetOriginId: cloudFrontAlbOriginId,
      viewerProtocolPolicy: 'redirect-to-https',
    },
    enabled: true,
    isIpv6Enabled: true,
    origins: [
      {
        customOriginConfig: {
          httpPort: 80,
          httpsPort: 443,
          // Default-domain CloudFront mode is a budget/stage tradeoff: viewer leg is HTTPS,
          // but the CloudFront -> ALB hop stays HTTP until custom-domain mode enables ALB HTTPS.
          originProtocolPolicy: 'http-only',
          originSslProtocols: ['TLSv1.2'],
        },
        domainName: publicAlb.dnsName,
        originId: cloudFrontAlbOriginId,
      },
    ],
    priceClass: cloudFrontPriceClass,
    restrictions: {
      geoRestriction: {
        restrictionType: 'none',
      },
    },
    tags: {
      ...commonTags,
      Component: 'edge',
      Name: stackName('shop-api-cloudfront'),
      Scope: 'public',
      Service: 'shop',
    },
    viewerCertificate: {
      cloudfrontDefaultCertificate: true,
    },
    waitForDeployment: false,
  });

  return {
    albAccessLogsBucketArn: albLogsBucket.arn,
    albAccessLogsBucketName: albLogsBucket.bucket,
    publicAlbArn: publicAlb.arn,
    publicAlbDnsName: publicAlb.dnsName,
    publicAlbHttpListenerArn: httpListener.arn,
    publicAlbHttpsListenerArn: null,
    publicAlbName: publicAlb.name,
    publicAlbZoneId: publicAlb.zoneId,
    publicApiAliasRecordFqdn: null,
    publicApiDomainName: null,
    publicCertificateArn: null,
    publicCertificateDomainName: null,
    publicCertificateValidationRecordFqdn: null,
    publicCloudFrontDistributionArn: distribution.arn,
    publicCloudFrontDistributionDomainName: distribution.domainName,
    publicCloudFrontDistributionHostedZoneId: distribution.hostedZoneId,
    publicCloudFrontDistributionId: distribution.id,
    publicEdgeMode: edgeConfig.publicEdgeMode,
    publicEndpointUrl: pulumi.interpolate`https://${distribution.domainName}`,
    publicHostedZoneId: null,
    publicHostedZoneName: null,
    publicHostedZoneNameServers: null,
    shopLoadBalancerDependency: httpListener,
    shopTargetGroupArn: shopTargetGroup.arn,
    shopTargetGroupName: shopTargetGroup.name,
  };
}

/**
 * Step 2.4-2.5 hosted-zone helper.
 * Accepts the root domain name and an optional explicit hosted zone id.
 * Resolves the public Route 53 hosted zone by id or name, creating it on the shared-infra owner stack when necessary.
 */
function resolveHostedZone(rootDomainName: string, hostedZoneId?: string) {
  if (hostedZoneId) {
    const zone = aws.route53.getZoneOutput({
      privateZone: false,
      zoneId: hostedZoneId,
    });

    return {
      name: zone.name,
      nameServers: zone.nameServers,
      zoneId: zone.zoneId,
    };
  }

  if (isSharedInfraOwner) {
    const zone = new aws.route53.Zone(stackName('public-hosted-zone'), {
      comment: 'Public hosted zone for rd_shop API endpoints.',
      name: rootDomainName,
      tags: {
        ...commonTags,
        Component: 'edge',
        Name: rootDomainName,
        Scope: 'shared',
      },
    });

    return {
      name: zone.name,
      nameServers: zone.nameServers,
      zoneId: zone.zoneId,
    };
  }

  const zone = aws.route53.getZoneOutput({
    name: rootDomainName,
    privateZone: false,
  });

  return {
    name: zone.name,
    nameServers: zone.nameServers,
    zoneId: zone.zoneId,
  };
}
