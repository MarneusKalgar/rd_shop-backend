# rd_shop — AWS Infrastructure

## Current deployment model

Stage and production are Pulumi-managed AWS stacks.
GitHub Actions builds immutable ECR images, writes the selected image URIs into the target Pulumi stack config, then applies the stack with `pulumi up`.
The active deploy path is AWS OIDC + Pulumi + ECS; the older SSH-to-VM Docker Compose flow is no longer the deployed architecture.

## Shared topology

```text
Internet
  -> CloudFront
  -> public ALB
  -> ECS service: shop (HTTP REST + GraphQL + RabbitMQ consumer)
  -> Cloud Map DNS
  -> ECS service: payments (internal gRPC)

Supporting services
  -> PostgreSQL backend per stack
  -> dedicated RabbitMQ EC2 broker
  -> private S3 bucket
  -> SES sender identity
  -> Secrets Manager + SSM Parameter Store
  -> CloudWatch logs, dashboards, alarms
  -> VPC with public/private subnets and a NAT instance
```

## Core AWS building blocks

| Concern                    | AWS implementation                                  | Notes                                                                      |
| -------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| Container registry         | ECR repositories `rd-shop/shop`, `rd-shop/payments` | Built by `build-and-push.yml`; shared across stacks                        |
| Compute                    | ECS on EC2                                          | Shop and payments run as separate ECS services on shared cluster capacity  |
| Public ingress             | CloudFront + public ALB                             | Current stack config uses `publicEdgeMode: cloudfront`                     |
| Internal service discovery | Cloud Map                                           | Shop reaches payments over private DNS/gRPC                                |
| Files                      | Private S3 bucket                                   | Shop uses presigned upload/download flow                                   |
| Messaging                  | Dedicated RabbitMQ EC2 host                         | Private-only broker; management UI not public                              |
| Secrets and runtime config | Secrets Manager + SSM Parameter Store               | Pulumi publishes service secrets and parameter names consumed by ECS tasks |
| Alerts and dashboards      | CloudWatch + SNS                                    | Infra alarms on both stacks; app-level custom metrics only in production   |

## Stage vs production

| Concern                | Stage                                                                                            | Production                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Stack config file      | `infra/Pulumi.stage.yaml`                                                                        | `infra/Pulumi.production.yaml`                                                          |
| Database backend       | `ec2-postgres` bootstrap host in private subnet                                                  | Managed RDS PostgreSQL                                                                  |
| Deploy trigger         | Automatic after successful `Build and Push` on `development`                                     | Manual `workflow_dispatch` with production environment approval                         |
| Image selection        | Image URIs injected by `deploy-stage.yml` from release manifest                                  | Explicit image URIs required before apply; current stack file pins the deployed release |
| Post-deploy validation | `stage-validation.yml` seeds namespaced data, runs `npm run test:e2e:shop:stage`, then cleans up | No equivalent full e2e validation workflow today; deploy workflow runs smoke checks     |
| Observability          | Infrastructure-only dashboard/alarm set                                                          | Infrastructure dashboard/alarm set plus application custom metrics/widgets/alarms       |
| Database operations    | Cheapest option, but more operational surface                                                    | Less manual DB ops, but still single-AZ today for budget reasons                        |

## Observability split

- Every stack creates an SNS alarm topic and a CloudWatch dashboard.
- Both stacks get infrastructure monitoring for ALB health/latency, ECS CPU and memory, NAT instance status, RabbitMQ broker status, and database health appropriate to the selected backend.
- Production additionally creates `RdShop/Application` widgets and alarms for HTTP, gRPC client, worker, and queue-processing metrics.
- Runtime emission of custom application metrics is gated by both `OBSERVABILITY_METRICS_ENABLED=true` and `DEPLOYMENT_ENVIRONMENT=production`.
- Stage intentionally skips custom application metrics to avoid duplicate CloudWatch cardinality cost and alarm noise.

## Operational tradeoffs

- ECS runs on EC2 for cost control and direct host access, but the current single-host footprint means deploy workflows quiesce services to desired count `0` before apply and DB init. Result: brief downtime during deployments.
- Stage uses containerized PostgreSQL on an EC2 bootstrap host because it is the cheapest environment to rebuild and validate. Production moves the same logical shape to RDS to reduce DB babysitting.
- RabbitMQ stays on a dedicated EC2 instance instead of Amazon MQ. That keeps cost and control predictable at this scale, but it also means broker upgrades, disk lifecycle, and management access stay in-house.
- CloudFront default-domain mode gives viewer-side HTTPS without custom-domain setup, but CloudFront to ALB remains HTTP in this mode. End-to-end TLS needs custom-domain mode with an ACM-backed HTTPS listener.
- The NAT AMI is pinned in stack config to prevent surprise preview drift. ECS host AMI rollout is still controlled intentionally through the configured SSM parameter path.

## Management access

- RabbitMQ management stays private. Operators reach it with AWS SSM port forwarding to the broker host, not by exposing `15672` publicly.
- Stage PostgreSQL host diagnostics and readiness checks also go through SSM because the host lives in a private subnet.
- Useful Pulumi outputs for operators include `publicEndpointUrl`, `observabilityDashboardName`, `alarmTopicName`, `applicationMetricsNamespace`, and `mqBrokerConsoleUrl`.
