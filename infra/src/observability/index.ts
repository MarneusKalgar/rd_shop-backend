import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

import { commonTags, config, region, stack, stackName } from '../bootstrap';

const applicationMetricsNamespace = 'RdShop/Application';
const applicationMetricsPeriodSeconds = 300;
const applicationMetricsTenMinutePeriodSeconds = 600;
const applicationServiceName = 'shop';
const dlqAlarmThreshold = 1;
const cloudWatchDashboardHeight = 6;
const cloudWatchDashboardWidth = 12;
const dashboardHeaderHeight = 3;
const ecsUtilizationAlarmThresholdPercent = 80;
const grpcClientErrorRateAlarmMinimumRequestCount = 20;
const grpcClientErrorRateAlarmThresholdPercent = 5;
const grpcClientLatencyAlarmThresholdMilliseconds = 500;
const grpcPeerServiceName = 'payments';
const healthyHostCountAlarmThreshold = 1;
const http5xxRateAlarmMinimumRequestCount = 50;
const http5xxRateAlarmThresholdPercent = 5;
const httpLatencyAlarmThresholdMilliseconds = 1500;
const lbTargetLatencyAlarmThresholdSeconds = 2;
const orderDlqQueueName = 'orders.dlq';
const rdsConnectionsAlarmThreshold = 40;
const orderProcessQueueName = 'order.process';
const statusCheckFailedAlarmThreshold = 1;

interface BaseMetricAlarmArgs {
  alarmTopicArn: pulumi.Input<string>;
  comparisonOperator?: pulumi.Input<string>;
  datapointsToAlarm?: number;
  dimensions: Record<string, pulumi.Input<string>>;
  evaluationPeriods?: number;
  logicalName: string;
  metricName: string;
  statistic: pulumi.Input<string>;
  threshold: number;
  treatMissingData?: string;
}

interface BuildMetricSearchExpressionArgs {
  dimensions: Record<string, string>;
  metricName: string;
  period?: number;
  schemaDimensions: string[];
  stat: string;
}

interface CreateEc2StatusAlarmArgs {
  alarmTopicArn: pulumi.Input<string>;
  instanceId: pulumi.Input<string>;
  logicalName: string;
}

interface CreateMetricAlarmArgs extends BaseMetricAlarmArgs {
  extendedStatistic?: pulumi.Input<string>;
  namespace: string;
  period?: number;
}

interface CreateMetricMathAlarmArgs {
  alarmTopicArn: pulumi.Input<string>;
  comparisonOperator?: pulumi.Input<string>;
  datapointsToAlarm?: number;
  evaluationPeriods: number;
  logicalName: string;
  metricQueries: pulumi.Input<pulumi.Input<aws.types.input.cloudwatch.MetricAlarmMetricQuery>[]>;
  threshold: number;
  treatMissingData?: string;
}

interface CreateObservabilityArgs {
  compute: {
    ecsClusterName: pulumi.Input<string>;
    paymentsLogGroupName: pulumi.Input<string>;
    paymentsServiceName: pulumi.Input<string>;
    shopLogGroupName: pulumi.Input<string>;
    shopServiceName: pulumi.Input<string>;
  };
  database: {
    databaseBackend: string;
    databaseBootstrapInstanceId: pulumi.Input<null | string>;
    paymentsDatabaseIdentifier: pulumi.Input<string>;
    shopDatabaseIdentifier: pulumi.Input<string>;
  };
  edge?: {
    publicAlbArnSuffix: pulumi.Input<string>;
    publicEndpointUrl: pulumi.Input<string>;
    shopTargetGroupArnSuffix: pulumi.Input<string>;
  };
  messaging: {
    mqBrokerId: pulumi.Input<string>;
  };
  network: {
    natInstanceId: pulumi.Input<string>;
  };
}

interface DashboardWidget {
  height: number;
  properties: Record<string, unknown>;
  type: 'metric' | 'text';
  width: number;
  x?: number;
  y?: number;
}

export function createObservability({
  compute,
  database,
  edge,
  messaging,
  network,
}: CreateObservabilityArgs) {
  const alarmEmailEndpoints = config.getObject<string[]>('alarmEmailEndpoints') ?? [];
  const shouldCreateApplicationObservability = stack === 'production';

  const alarmTopic = new aws.sns.Topic(stackName('alarms'), {
    displayName: stackName('alarms'),
    name: stackName('alarms'),
    tags: {
      ...commonTags,
      Component: 'observability',
      Name: stackName('alarms'),
      Scope: 'private',
    },
  });

  alarmEmailEndpoints.forEach((endpoint, index) => {
    new aws.sns.TopicSubscription(stackName(`alarms-email-${index + 1}`), {
      endpoint,
      protocol: 'email',
      topic: alarmTopic.arn,
    });
  });

  const dashboard = new aws.cloudwatch.Dashboard(stackName('observability-dashboard'), {
    dashboardBody: pulumi.jsonStringify({
      periodOverride: 'inherit',
      widgets: buildDashboardWidgets({ compute, database, edge, messaging, network }),
    }),
    dashboardName: stackName('observability-dashboard'),
  });

  if (edge) {
    createApplicationLoadBalancerAlarm({
      alarmTopicArn: alarmTopic.arn,
      dimensions: {
        LoadBalancer: edge.publicAlbArnSuffix,
        TargetGroup: edge.shopTargetGroupArnSuffix,
      },
      logicalName: 'alb-target-5xx-alarm',
      metricName: 'HTTPCode_Target_5XX_Count',
      statistic: 'Sum',
      threshold: 0,
    });

    createApplicationLoadBalancerAlarm({
      alarmTopicArn: alarmTopic.arn,
      comparisonOperator: 'GreaterThanThreshold',
      dimensions: {
        LoadBalancer: edge.publicAlbArnSuffix,
        TargetGroup: edge.shopTargetGroupArnSuffix,
      },
      evaluationPeriods: 3,
      logicalName: 'alb-target-latency-alarm',
      metricName: 'TargetResponseTime',
      statistic: 'Average',
      threshold: lbTargetLatencyAlarmThresholdSeconds,
    });

    createApplicationLoadBalancerAlarm({
      alarmTopicArn: alarmTopic.arn,
      comparisonOperator: 'LessThanThreshold',
      datapointsToAlarm: 3,
      dimensions: {
        LoadBalancer: edge.publicAlbArnSuffix,
        TargetGroup: edge.shopTargetGroupArnSuffix,
      },
      evaluationPeriods: 3,
      logicalName: 'alb-healthy-host-count-alarm',
      metricName: 'HealthyHostCount',
      statistic: 'Minimum',
      threshold: healthyHostCountAlarmThreshold,
      treatMissingData: 'notBreaching',
    });
  }

  createMetricAlarm({
    alarmTopicArn: alarmTopic.arn,
    dimensions: {
      ClusterName: compute.ecsClusterName,
      ServiceName: compute.shopServiceName,
    },
    evaluationPeriods: 3,
    logicalName: 'shop-ecs-cpu-alarm',
    metricName: 'CPUUtilization',
    namespace: 'AWS/ECS',
    statistic: 'Average',
    threshold: ecsUtilizationAlarmThresholdPercent,
  });

  createMetricAlarm({
    alarmTopicArn: alarmTopic.arn,
    dimensions: {
      ClusterName: compute.ecsClusterName,
      ServiceName: compute.shopServiceName,
    },
    evaluationPeriods: 3,
    logicalName: 'shop-ecs-memory-alarm',
    metricName: 'MemoryUtilization',
    namespace: 'AWS/ECS',
    statistic: 'Average',
    threshold: ecsUtilizationAlarmThresholdPercent,
  });

  createMetricAlarm({
    alarmTopicArn: alarmTopic.arn,
    dimensions: {
      ClusterName: compute.ecsClusterName,
      ServiceName: compute.paymentsServiceName,
    },
    evaluationPeriods: 3,
    logicalName: 'payments-ecs-cpu-alarm',
    metricName: 'CPUUtilization',
    namespace: 'AWS/ECS',
    statistic: 'Average',
    threshold: ecsUtilizationAlarmThresholdPercent,
  });

  createMetricAlarm({
    alarmTopicArn: alarmTopic.arn,
    dimensions: {
      ClusterName: compute.ecsClusterName,
      ServiceName: compute.paymentsServiceName,
    },
    evaluationPeriods: 3,
    logicalName: 'payments-ecs-memory-alarm',
    metricName: 'MemoryUtilization',
    namespace: 'AWS/ECS',
    statistic: 'Average',
    threshold: ecsUtilizationAlarmThresholdPercent,
  });

  if (database.databaseBackend !== 'ec2-postgres') {
    createMetricAlarm({
      alarmTopicArn: alarmTopic.arn,
      dimensions: {
        DBInstanceIdentifier: database.shopDatabaseIdentifier,
      },
      evaluationPeriods: 3,
      logicalName: 'shop-rds-connections-alarm',
      metricName: 'DatabaseConnections',
      namespace: 'AWS/RDS',
      statistic: 'Maximum',
      threshold: rdsConnectionsAlarmThreshold,
    });

    createMetricAlarm({
      alarmTopicArn: alarmTopic.arn,
      dimensions: {
        DBInstanceIdentifier: database.paymentsDatabaseIdentifier,
      },
      evaluationPeriods: 3,
      logicalName: 'payments-rds-connections-alarm',
      metricName: 'DatabaseConnections',
      namespace: 'AWS/RDS',
      statistic: 'Maximum',
      threshold: rdsConnectionsAlarmThreshold,
    });
  }

  createEc2StatusAlarm({
    alarmTopicArn: alarmTopic.arn,
    instanceId: messaging.mqBrokerId,
    logicalName: 'rabbitmq-status-check-alarm',
  });

  createEc2StatusAlarm({
    alarmTopicArn: alarmTopic.arn,
    instanceId: network.natInstanceId,
    logicalName: 'nat-status-check-alarm',
  });

  if (database.databaseBackend === 'ec2-postgres') {
    createEc2StatusAlarm({
      alarmTopicArn: alarmTopic.arn,
      instanceId: database.databaseBootstrapInstanceId as pulumi.Input<string>,
      logicalName: 'stage-postgres-status-check-alarm',
    });
  }

  if (shouldCreateApplicationObservability) {
    createMetricMathAlarm({
      alarmTopicArn: alarmTopic.arn,
      comparisonOperator: 'GreaterThanThreshold',
      evaluationPeriods: 1,
      logicalName: 'app-http-5xx-rate-alarm',
      metricQueries: [
        {
          expression: buildMetricSearchExpression({
            dimensions: {
              Environment: stack,
              Service: applicationServiceName,
            },
            metricName: 'HttpRequestCount',
            period: applicationMetricsPeriodSeconds,
            schemaDimensions: ['Environment', 'Method', 'Route', 'Service', 'StatusClass'],
            stat: 'Sum',
          }),
          id: 'totalRequests',
          label: 'HTTP total requests',
          returnData: false,
        },
        {
          expression: buildMetricSearchExpression({
            dimensions: {
              Environment: stack,
              Service: applicationServiceName,
              StatusClass: '5xx',
            },
            metricName: 'HttpRequestCount',
            period: applicationMetricsPeriodSeconds,
            schemaDimensions: ['Environment', 'Method', 'Route', 'Service', 'StatusClass'],
            stat: 'Sum',
          }),
          id: 'errorRequests',
          label: 'HTTP 5xx requests',
          returnData: false,
        },
        {
          expression: `IF(totalRequests >= ${http5xxRateAlarmMinimumRequestCount}, (errorRequests / totalRequests) * 100, 0)`,
          id: 'http5xxRate',
          label: 'HTTP 5xx rate',
          returnData: true,
        },
      ],
      threshold: http5xxRateAlarmThresholdPercent,
    });

    createMetricMathAlarm({
      alarmTopicArn: alarmTopic.arn,
      comparisonOperator: 'GreaterThanThreshold',
      evaluationPeriods: 3,
      logicalName: 'app-http-latency-p95-alarm',
      metricQueries: [
        {
          expression: `MAX(${buildMetricSearchQuery({
            dimensions: {
              Environment: stack,
              Service: applicationServiceName,
            },
            metricName: 'HttpRequestDurationMs',
            period: applicationMetricsPeriodSeconds,
            schemaDimensions: ['Environment', 'Method', 'Route', 'Service'],
            stat: 'p95',
          })})`,
          id: 'httpLatencyP95',
          label: 'HTTP latency p95',
          returnData: true,
        },
      ],
      threshold: httpLatencyAlarmThresholdMilliseconds,
    });

    createMetricMathAlarm({
      alarmTopicArn: alarmTopic.arn,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      evaluationPeriods: 1,
      logicalName: 'app-worker-dlq-alarm',
      metricQueries: [
        {
          expression: buildMetricSearchExpression({
            dimensions: {
              Environment: stack,
              Result: 'dlq',
              Service: applicationServiceName,
            },
            metricName: 'OrderWorkerMessageCount',
            period: applicationMetricsTenMinutePeriodSeconds,
            schemaDimensions: ['Environment', 'Queue', 'Result', 'Service'],
            stat: 'Sum',
          }),
          id: 'dlqMessages',
          label: 'Worker DLQ messages',
          returnData: true,
        },
      ],
      threshold: dlqAlarmThreshold,
    });

    createMetricMathAlarm({
      alarmTopicArn: alarmTopic.arn,
      comparisonOperator: 'GreaterThanThreshold',
      evaluationPeriods: 1,
      logicalName: 'app-grpc-client-error-rate-alarm',
      metricQueries: [
        {
          expression: buildMetricSearchExpression({
            dimensions: {
              Environment: stack,
              PeerService: grpcPeerServiceName,
              Service: applicationServiceName,
            },
            metricName: 'GrpcClientRequestCount',
            period: applicationMetricsPeriodSeconds,
            schemaDimensions: ['Environment', 'Method', 'Outcome', 'PeerService', 'Service'],
            stat: 'Sum',
          }),
          id: 'grpcTotalRequests',
          label: 'gRPC total requests',
          returnData: false,
        },
        {
          expression: buildMetricSearchExpression({
            dimensions: {
              Environment: stack,
              Outcome: 'error',
              PeerService: grpcPeerServiceName,
              Service: applicationServiceName,
            },
            metricName: 'GrpcClientRequestCount',
            period: applicationMetricsPeriodSeconds,
            schemaDimensions: ['Environment', 'Method', 'Outcome', 'PeerService', 'Service'],
            stat: 'Sum',
          }),
          id: 'grpcErrorRequests',
          label: 'gRPC error requests',
          returnData: false,
        },
        {
          expression: `IF(grpcTotalRequests >= ${grpcClientErrorRateAlarmMinimumRequestCount}, (grpcErrorRequests / grpcTotalRequests) * 100, 0)`,
          id: 'grpcErrorRate',
          label: 'gRPC client error rate',
          returnData: true,
        },
      ],
      threshold: grpcClientErrorRateAlarmThresholdPercent,
    });

    createMetricMathAlarm({
      alarmTopicArn: alarmTopic.arn,
      comparisonOperator: 'GreaterThanThreshold',
      evaluationPeriods: 2,
      logicalName: 'app-grpc-client-authorize-latency-alarm',
      metricQueries: [
        {
          expression: `MAX(${buildMetricSearchQuery({
            dimensions: {
              Environment: stack,
              Method: 'authorize',
              PeerService: grpcPeerServiceName,
              Service: applicationServiceName,
            },
            metricName: 'GrpcClientDurationMs',
            period: applicationMetricsPeriodSeconds,
            schemaDimensions: ['Environment', 'Method', 'PeerService', 'Service'],
            stat: 'p95',
          })})`,
          id: 'grpcAuthorizeLatencyP95',
          label: 'gRPC authorize latency p95',
          returnData: true,
        },
      ],
      threshold: grpcClientLatencyAlarmThresholdMilliseconds,
    });
  }

  return {
    alarmEmailEndpointCount: alarmEmailEndpoints.length,
    alarmTopicArn: alarmTopic.arn,
    alarmTopicName: alarmTopic.name,
    applicationMetricsNamespace,
    observabilityDashboardName: dashboard.dashboardName,
  };
}

function buildDashboardWidgets({
  compute,
  database,
  edge,
  messaging,
  network,
}: CreateObservabilityArgs) {
  const metricWidgets: DashboardWidget[] = [];
  const shouldCreateApplicationObservability = stack === 'production';

  metricWidgets.push({
    height: dashboardHeaderHeight,
    properties: {
      markdown: edge
        ? pulumi.interpolate`# ${stackName('observability-dashboard')}\nPublic endpoint: ${edge.publicEndpointUrl}\nLogs: ${compute.shopLogGroupName}, ${compute.paymentsLogGroupName}`
        : pulumi.interpolate`# ${stackName('observability-dashboard')}\nPrivate stack observability dashboard.\nLogs: ${compute.shopLogGroupName}, ${compute.paymentsLogGroupName}`,
    },
    type: 'text',
    width: 24,
    x: 0,
    y: 0,
  });

  if (edge) {
    metricWidgets.push({
      height: cloudWatchDashboardHeight,
      properties: {
        metrics: [
          [
            'AWS/ApplicationELB',
            'RequestCount',
            'LoadBalancer',
            edge.publicAlbArnSuffix,
            'TargetGroup',
            edge.shopTargetGroupArnSuffix,
            { label: 'Request count', stat: 'Sum' },
          ],
          [
            '.',
            'HTTPCode_Target_5XX_Count',
            '.',
            '.',
            '.',
            '.',
            { label: 'Target 5xx', stat: 'Sum' },
          ],
          [
            '.',
            'HealthyHostCount',
            '.',
            '.',
            '.',
            '.',
            { label: 'Healthy hosts', stat: 'Minimum' },
          ],
        ],
        region,
        stacked: false,
        title: 'Public API edge',
        view: 'timeSeries',
      },
      type: 'metric',
      width: cloudWatchDashboardWidth,
    });

    metricWidgets.push({
      height: cloudWatchDashboardHeight,
      properties: {
        metrics: [
          [
            'AWS/ApplicationELB',
            'TargetResponseTime',
            'LoadBalancer',
            edge.publicAlbArnSuffix,
            'TargetGroup',
            edge.shopTargetGroupArnSuffix,
            { label: 'Target response time', stat: 'Average' },
          ],
        ],
        region,
        stacked: false,
        title: 'Public API latency',
        view: 'timeSeries',
      },
      type: 'metric',
      width: cloudWatchDashboardWidth,
    });
  }

  metricWidgets.push({
    height: cloudWatchDashboardHeight,
    properties: {
      metrics: [
        [
          'AWS/ECS',
          'CPUUtilization',
          'ClusterName',
          compute.ecsClusterName,
          'ServiceName',
          compute.shopServiceName,
          { label: 'shop CPU', stat: 'Average' },
        ],
        ['.', 'MemoryUtilization', '.', '.', '.', '.', { label: 'shop memory', stat: 'Average' }],
        [
          'AWS/ECS',
          'CPUUtilization',
          'ClusterName',
          compute.ecsClusterName,
          'ServiceName',
          compute.paymentsServiceName,
          { label: 'payments CPU', stat: 'Average' },
        ],
        [
          '.',
          'MemoryUtilization',
          '.',
          '.',
          '.',
          '.',
          { label: 'payments memory', stat: 'Average' },
        ],
      ],
      region,
      stacked: false,
      title: 'ECS services',
      view: 'timeSeries',
    },
    type: 'metric',
    width: cloudWatchDashboardWidth,
  });

  metricWidgets.push({
    height: cloudWatchDashboardHeight,
    properties: {
      metrics: [
        [
          'ECS/ContainerInsights',
          'ContainerInstanceCount',
          'ClusterName',
          compute.ecsClusterName,
          { label: 'Container instances', stat: 'Average' },
        ],
        [
          '.',
          'RunningTaskCount',
          '.',
          '.',
          'ServiceName',
          compute.shopServiceName,
          { label: 'Shop running tasks', stat: 'Average' },
        ],
        [
          '.',
          'RunningTaskCount',
          '.',
          '.',
          'ServiceName',
          compute.paymentsServiceName,
          { label: 'Payments running tasks', stat: 'Average' },
        ],
        ['.', 'ServiceCount', '.', '.', { label: 'Services', stat: 'Average' }],
      ],
      region,
      stacked: false,
      title: 'ECS cluster capacity',
      view: 'timeSeries',
    },
    type: 'metric',
    width: cloudWatchDashboardWidth,
  });

  if (database.databaseBackend !== 'ec2-postgres') {
    metricWidgets.push({
      height: cloudWatchDashboardHeight,
      properties: {
        metrics: [
          [
            'AWS/RDS',
            'CPUUtilization',
            'DBInstanceIdentifier',
            database.shopDatabaseIdentifier,
            { label: 'shop DB CPU', stat: 'Average' },
          ],
          ['.', 'DatabaseConnections', '.', '.', { label: 'shop DB connections', stat: 'Maximum' }],
          ['.', 'FreeStorageSpace', '.', '.', { label: 'shop free storage', stat: 'Minimum' }],
          [
            'AWS/RDS',
            'CPUUtilization',
            'DBInstanceIdentifier',
            database.paymentsDatabaseIdentifier,
            { label: 'payments DB CPU', stat: 'Average' },
          ],
          [
            '.',
            'DatabaseConnections',
            '.',
            '.',
            { label: 'payments DB connections', stat: 'Maximum' },
          ],
          ['.', 'FreeStorageSpace', '.', '.', { label: 'payments free storage', stat: 'Minimum' }],
        ],
        region,
        stacked: false,
        title: 'Databases',
        view: 'timeSeries',
      },
      type: 'metric',
      width: cloudWatchDashboardWidth,
    });
  }

  const ec2CpuMetrics: (pulumi.Input<string> | { label: string; stat: string })[][] = [
    [
      'AWS/EC2',
      'CPUUtilization',
      'InstanceId',
      messaging.mqBrokerId,
      { label: 'RabbitMQ CPU', stat: 'Average' },
    ],
    [
      'AWS/EC2',
      'CPUUtilization',
      'InstanceId',
      network.natInstanceId,
      { label: 'NAT CPU', stat: 'Average' },
    ],
  ];

  const ec2NetworkMetrics: (pulumi.Input<string> | { label: string; stat: string })[][] = [
    [
      'AWS/EC2',
      'NetworkIn',
      'InstanceId',
      messaging.mqBrokerId,
      { label: 'RabbitMQ net in', stat: 'Average' },
    ],
    ['.', 'NetworkOut', '.', '.', { label: 'RabbitMQ net out', stat: 'Average' }],
    [
      'AWS/EC2',
      'NetworkIn',
      'InstanceId',
      network.natInstanceId,
      { label: 'NAT net in', stat: 'Average' },
    ],
    ['.', 'NetworkOut', '.', '.', { label: 'NAT net out', stat: 'Average' }],
  ];

  const ec2StatusMetrics: (pulumi.Input<string> | { label: string; stat: string })[][] = [
    [
      'AWS/EC2',
      'StatusCheckFailed',
      'InstanceId',
      messaging.mqBrokerId,
      { label: 'RabbitMQ status', stat: 'Maximum' },
    ],
    [
      'AWS/EC2',
      'StatusCheckFailed',
      'InstanceId',
      network.natInstanceId,
      { label: 'NAT status', stat: 'Maximum' },
    ],
  ];

  if (database.databaseBackend === 'ec2-postgres') {
    ec2CpuMetrics.push([
      'AWS/EC2',
      'CPUUtilization',
      'InstanceId',
      database.databaseBootstrapInstanceId as pulumi.Input<string>,
      { label: 'Stage PostgreSQL CPU', stat: 'Average' },
    ]);

    ec2NetworkMetrics.push([
      'AWS/EC2',
      'NetworkIn',
      'InstanceId',
      database.databaseBootstrapInstanceId as pulumi.Input<string>,
      { label: 'Stage PostgreSQL net in', stat: 'Average' },
    ]);
    ec2NetworkMetrics.push([
      '.',
      'NetworkOut',
      '.',
      '.',
      { label: 'Stage PostgreSQL net out', stat: 'Average' },
    ]);

    ec2StatusMetrics.push([
      'AWS/EC2',
      'StatusCheckFailed',
      'InstanceId',
      database.databaseBootstrapInstanceId as pulumi.Input<string>,
      { label: 'Stage PostgreSQL host status', stat: 'Maximum' },
    ]);
  }

  metricWidgets.push({
    height: cloudWatchDashboardHeight,
    properties: {
      metrics: ec2CpuMetrics,
      region,
      stacked: false,
      title: 'Stateful EC2 CPU',
      view: 'timeSeries',
    },
    type: 'metric',
    width: cloudWatchDashboardWidth,
  });

  metricWidgets.push({
    height: cloudWatchDashboardHeight,
    properties: {
      metrics: ec2NetworkMetrics,
      region,
      stacked: false,
      title: 'Stateful EC2 network',
      view: 'timeSeries',
    },
    type: 'metric',
    width: cloudWatchDashboardWidth,
  });

  metricWidgets.push({
    height: cloudWatchDashboardHeight,
    properties: {
      metrics: ec2StatusMetrics,
      region,
      stacked: false,
      title: 'Stateful EC2 hosts',
      view: 'timeSeries',
    },
    type: 'metric',
    width: cloudWatchDashboardWidth,
  });

  if (shouldCreateApplicationObservability) {
    metricWidgets.push({
      height: cloudWatchDashboardHeight,
      properties: {
        metrics: [
          [
            {
              expression: buildMetricSearchExpression({
                dimensions: {
                  Environment: stack,
                  Service: applicationServiceName,
                },
                metricName: 'HttpRequestCount',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Method', 'Route', 'Service', 'StatusClass'],
                stat: 'Sum',
              }),
              id: 'httpTotalRequests',
              label: 'HTTP total requests',
              region,
            },
          ],
          [
            {
              expression: buildMetricSearchExpression({
                dimensions: {
                  Environment: stack,
                  Service: applicationServiceName,
                  StatusClass: '4xx',
                },
                metricName: 'HttpRequestCount',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Method', 'Route', 'Service', 'StatusClass'],
                stat: 'Sum',
              }),
              id: 'http4xxRequests',
              label: 'HTTP 4xx',
              region,
            },
          ],
          [
            {
              expression: buildMetricSearchExpression({
                dimensions: {
                  Environment: stack,
                  Service: applicationServiceName,
                  StatusClass: '5xx',
                },
                metricName: 'HttpRequestCount',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Method', 'Route', 'Service', 'StatusClass'],
                stat: 'Sum',
              }),
              id: 'http5xxRequests',
              label: 'HTTP 5xx',
              region,
            },
          ],
        ],
        region,
        stacked: false,
        title: 'App HTTP volume',
        view: 'timeSeries',
      },
      type: 'metric',
      width: cloudWatchDashboardWidth,
    });

    metricWidgets.push({
      height: cloudWatchDashboardHeight,
      properties: {
        metrics: [
          [
            {
              expression: buildMetricSearchQuery({
                dimensions: {
                  Environment: stack,
                  Service: applicationServiceName,
                },
                metricName: 'HttpRequestDurationMs',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Method', 'Route', 'Service'],
                stat: 'p95',
              }),
              id: 'httpRouteLatency',
              label: 'HTTP p95 by route',
              region,
            },
          ],
        ],
        region,
        stacked: false,
        title: 'App HTTP latency by route',
        view: 'timeSeries',
      },
      type: 'metric',
      width: cloudWatchDashboardWidth,
    });

    metricWidgets.push({
      height: cloudWatchDashboardHeight,
      properties: {
        metrics: [
          [
            {
              expression: buildMetricSearchExpression({
                dimensions: {
                  Environment: stack,
                  Service: applicationServiceName,
                },
                metricName: 'OrderCreatedCount',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'InitialStatus', 'Service'],
                stat: 'Sum',
              }),
              id: 'orderCreatedCount',
              label: 'Orders created',
              region,
            },
          ],
          [
            {
              expression: buildMetricSearchExpression({
                dimensions: {
                  Environment: stack,
                  FinalStatus: 'PAID',
                  Service: applicationServiceName,
                },
                metricName: 'OrderCompletionCount',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'FinalStatus', 'Service'],
                stat: 'Sum',
              }),
              id: 'orderPaidCount',
              label: 'Orders paid',
              region,
            },
          ],
          [
            {
              expression: buildMetricSearchExpression({
                dimensions: {
                  Environment: stack,
                  FinalStatus: 'CANCELLED',
                  Service: applicationServiceName,
                },
                metricName: 'OrderCompletionCount',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'FinalStatus', 'Service'],
                stat: 'Sum',
              }),
              id: 'orderCancelledCount',
              label: 'Orders cancelled',
              region,
            },
          ],
        ],
        region,
        stacked: false,
        title: 'Order lifecycle',
        view: 'timeSeries',
      },
      type: 'metric',
      width: cloudWatchDashboardWidth,
    });

    metricWidgets.push({
      height: cloudWatchDashboardHeight,
      properties: {
        metrics: [
          [
            {
              expression: buildMetricSearchExpression({
                dimensions: {
                  Environment: stack,
                  Queue: orderProcessQueueName,
                  Result: 'success',
                  Service: applicationServiceName,
                },
                metricName: 'OrderWorkerMessageCount',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Queue', 'Result', 'Service'],
                stat: 'Sum',
              }),
              id: 'workerSuccessCount',
              label: 'Worker success',
              region,
            },
          ],
          [
            {
              expression: buildMetricSearchExpression({
                dimensions: {
                  Environment: stack,
                  Queue: orderProcessQueueName,
                  Result: 'retry',
                  Service: applicationServiceName,
                },
                metricName: 'OrderWorkerMessageCount',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Queue', 'Result', 'Service'],
                stat: 'Sum',
              }),
              id: 'workerRetryCount',
              label: 'Worker retry',
              region,
            },
          ],
          [
            {
              expression: buildMetricSearchExpression({
                dimensions: {
                  Environment: stack,
                  Result: 'dlq',
                  Service: applicationServiceName,
                },
                metricName: 'OrderWorkerMessageCount',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Queue', 'Result', 'Service'],
                stat: 'Sum',
              }),
              id: 'workerDlqCount',
              label: 'Worker DLQ',
              region,
            },
          ],
          [
            {
              expression: buildMetricSearchExpression({
                dimensions: {
                  Environment: stack,
                  Queue: orderProcessQueueName,
                  Service: applicationServiceName,
                },
                metricName: 'RabbitMqPublishCount',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Queue', 'Service'],
                stat: 'Sum',
              }),
              id: 'orderQueuePublishCount',
              label: 'order.process publishes',
              region,
            },
          ],
          [
            {
              expression: buildMetricSearchExpression({
                dimensions: {
                  Environment: stack,
                  Queue: orderDlqQueueName,
                  Service: applicationServiceName,
                },
                metricName: 'RabbitMqPublishCount',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Queue', 'Service'],
                stat: 'Sum',
              }),
              id: 'dlqPublishCount',
              label: 'orders.dlq publishes',
              region,
            },
          ],
        ],
        region,
        stacked: false,
        title: 'Worker throughput and queue volume',
        view: 'timeSeries',
      },
      type: 'metric',
      width: cloudWatchDashboardWidth,
    });

    metricWidgets.push({
      height: cloudWatchDashboardHeight,
      properties: {
        metrics: [
          [
            {
              expression: buildMetricSearchQuery({
                dimensions: {
                  Environment: stack,
                  PeerService: grpcPeerServiceName,
                  Service: applicationServiceName,
                },
                metricName: 'GrpcClientRequestCount',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Method', 'Outcome', 'PeerService', 'Service'],
                stat: 'Sum',
              }),
              id: 'grpcClientCounts',
              label: 'gRPC requests by method/outcome',
              region,
            },
          ],
        ],
        region,
        stacked: false,
        title: 'gRPC client outcomes',
        view: 'timeSeries',
      },
      type: 'metric',
      width: cloudWatchDashboardWidth,
    });

    metricWidgets.push({
      height: cloudWatchDashboardHeight,
      properties: {
        metrics: [
          [
            {
              expression: `MAX(${buildMetricSearchQuery({
                dimensions: {
                  Environment: stack,
                  Method: 'authorize',
                  PeerService: grpcPeerServiceName,
                  Service: applicationServiceName,
                },
                metricName: 'GrpcClientDurationMs',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Method', 'PeerService', 'Service'],
                stat: 'p95',
              })})`,
              id: 'grpcAuthorizeP95',
              label: 'authorize p95',
              region,
            },
          ],
          [
            {
              expression: `MAX(${buildMetricSearchQuery({
                dimensions: {
                  Environment: stack,
                  Method: 'getPaymentStatus',
                  PeerService: grpcPeerServiceName,
                  Service: applicationServiceName,
                },
                metricName: 'GrpcClientDurationMs',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Method', 'PeerService', 'Service'],
                stat: 'p95',
              })})`,
              id: 'grpcStatusP95',
              label: 'getPaymentStatus p95',
              region,
            },
          ],
        ],
        region,
        stacked: false,
        title: 'gRPC client latency',
        view: 'timeSeries',
      },
      type: 'metric',
      width: cloudWatchDashboardWidth,
    });

    metricWidgets.push({
      height: cloudWatchDashboardHeight,
      properties: {
        metrics: [
          [
            {
              expression: `MAX(${buildMetricSearchQuery({
                dimensions: {
                  Environment: stack,
                  Service: applicationServiceName,
                },
                metricName: 'DbQueriesPerRequest',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Route', 'Service'],
                stat: 'p95',
              })})`,
              id: 'dbQueriesPerRequestP95',
              label: 'DB queries/request p95',
              region,
            },
          ],
          [
            {
              expression: `MAX(${buildMetricSearchQuery({
                dimensions: {
                  Environment: stack,
                  Service: applicationServiceName,
                },
                metricName: 'OrderProcessingDurationMs',
                period: applicationMetricsPeriodSeconds,
                schemaDimensions: ['Environment', 'Result', 'Service'],
                stat: 'p95',
              })})`,
              id: 'orderProcessingDurationP95',
              label: 'Order processing p95',
              region,
            },
          ],
        ],
        region,
        stacked: false,
        title: 'DB and async latency',
        view: 'timeSeries',
      },
      type: 'metric',
      width: cloudWatchDashboardWidth,
    });
  }

  return metricWidgets.map((widget, index) => {
    if (index === 0) {
      return widget;
    }

    const gridIndex = index - 1;

    return {
      ...widget,
      x: (gridIndex % 2) * cloudWatchDashboardWidth,
      y: dashboardHeaderHeight + Math.floor(gridIndex / 2) * cloudWatchDashboardHeight,
    };
  });
}

function buildMetricSearchExpression({
  dimensions,
  metricName,
  period = applicationMetricsPeriodSeconds,
  schemaDimensions,
  stat,
}: BuildMetricSearchExpressionArgs): string {
  return `SUM(${buildMetricSearchQuery({ dimensions, metricName, period, schemaDimensions, stat })})`;
}

function buildMetricSearchQuery({
  dimensions,
  metricName,
  period = applicationMetricsPeriodSeconds,
  schemaDimensions,
  stat,
}: BuildMetricSearchExpressionArgs): string {
  const dimensionFilters = Object.entries(dimensions)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');
  const schema = [applicationMetricsNamespace, ...schemaDimensions].join(',');

  return `SEARCH('{${schema}} MetricName="${metricName}" ${dimensionFilters}', '${stat}', ${period})`;
}

function createApplicationLoadBalancerAlarm({
  alarmTopicArn,
  comparisonOperator = 'GreaterThanThreshold',
  datapointsToAlarm,
  dimensions,
  evaluationPeriods = 1,
  logicalName,
  metricName,
  statistic,
  threshold,
  treatMissingData = 'notBreaching',
}: BaseMetricAlarmArgs) {
  return createMetricAlarm({
    alarmTopicArn,
    comparisonOperator,
    datapointsToAlarm,
    dimensions,
    evaluationPeriods,
    logicalName,
    metricName,
    namespace: 'AWS/ApplicationELB',
    statistic,
    threshold,
    treatMissingData,
  });
}

function createEc2StatusAlarm({
  alarmTopicArn,
  instanceId,
  logicalName,
}: CreateEc2StatusAlarmArgs) {
  return createMetricAlarm({
    alarmTopicArn,
    comparisonOperator: 'GreaterThanOrEqualToThreshold',
    dimensions: {
      InstanceId: instanceId,
    },
    evaluationPeriods: 2,
    logicalName,
    metricName: 'StatusCheckFailed',
    namespace: 'AWS/EC2',
    statistic: 'Maximum',
    threshold: statusCheckFailedAlarmThreshold,
  });
}

function createMetricAlarm({
  alarmTopicArn,
  comparisonOperator = 'GreaterThanThreshold',
  datapointsToAlarm,
  dimensions,
  evaluationPeriods = 1,
  extendedStatistic,
  logicalName,
  metricName,
  namespace,
  period = 300,
  statistic,
  threshold,
  treatMissingData = 'notBreaching',
}: CreateMetricAlarmArgs) {
  return new aws.cloudwatch.MetricAlarm(stackName(logicalName), {
    actionsEnabled: true,
    alarmActions: [alarmTopicArn],
    alarmDescription: `${stackName(logicalName)} threshold crossed.`,
    comparisonOperator,
    datapointsToAlarm,
    dimensions,
    evaluationPeriods,
    extendedStatistic,
    metricName,
    name: stackName(logicalName),
    namespace,
    period,
    statistic,
    tags: {
      ...commonTags,
      Component: 'observability',
      Name: stackName(logicalName),
      Scope: 'private',
    },
    threshold,
    treatMissingData,
  });
}

function createMetricMathAlarm({
  alarmTopicArn,
  comparisonOperator = 'GreaterThanThreshold',
  datapointsToAlarm,
  evaluationPeriods,
  logicalName,
  metricQueries,
  threshold,
  treatMissingData = 'notBreaching',
}: CreateMetricMathAlarmArgs) {
  return new aws.cloudwatch.MetricAlarm(stackName(logicalName), {
    actionsEnabled: true,
    alarmActions: [alarmTopicArn],
    alarmDescription: `${stackName(logicalName)} threshold crossed.`,
    comparisonOperator,
    datapointsToAlarm,
    evaluationPeriods,
    metricQueries,
    name: stackName(logicalName),
    tags: {
      ...commonTags,
      Component: 'observability',
      Name: stackName(logicalName),
      Scope: 'private',
    },
    threshold,
    treatMissingData,
  });
}
