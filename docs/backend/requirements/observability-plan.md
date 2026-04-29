# Observability & Reliability — Implementation Plan

> Each phase carries **Priority** (business urgency), **Severity** (risk if absent), and **Complexity** (implementation effort) rated 1–5.
>
> **Phases 1–2** (Pino structured logging + HTTP security hardening) have been **moved to `security-hardening-plan.md`** — they are prerequisites for security hardening and are implemented in that scope.

## Current state

- `shop` uses `nestjs-pino` structured JSON logging
- `payments` still uses NestJS default logger with configurable log levels (`APP_LOG_LEVEL`)
- `RequestIdMiddleware`: generates/propagates `X-Request-ID` per request
- `QueryLoggerMiddleware`: counts SQL queries per request via AsyncLocalStorage (GraphQL only)
- `AsyncLocalStorage` for request-scoped context (`queryCount`)
- Health checks: `/health` (liveness), `/ready` (postgres + rabbitmq + minio), `/status` (+ payments gRPC)
- Graceful shutdown implemented
- ECS task definitions already ship both services' stdout/stderr to CloudWatch Logs via `awslogs`
- No CloudWatch dashboards, alarms, or SNS notification wiring yet
- No application-level CloudWatch metrics (EMF / metric filters / custom namespace metrics) yet
- No distributed tracing

---

## Target stack (AWS-native)

The production observability backend is **AWS CloudWatch** (Logs, Metrics, Dashboards, Alarms) + **AWS X-Ray** (tracing). No self-hosted Prometheus, Grafana, or Jaeger in production.

**Why not Prometheus + Grafana?**

| Concern                             | Problem                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **t3.micro (1GB RAM)**              | Shop (400MB) + Payments (300MB) + OS (300MB) = full. Zero room for sidecar containers.               |
| **Separate observability instance** | Doubles cost, eats free tier hours, doubles ops overhead.                                            |
| **CloudWatch already included**     | Logs ingestion free up to 5GB/mo, basic Metrics free, X-Ray free up to 100K traces/mo.               |
| **Vendor lock-in**                  | Acceptable — entire stack is AWS. EMF metric format is a thin logging convention, not deep coupling. |

**Local dev:** Prometheus + Grafana remain available as **optional** Docker Compose services for metrics visualization during development. They are not part of the production stack.

---

## Phase 1 — Minimal Valid CloudWatch Monitoring

> **Priority: 2 | Severity: 2 | Complexity: 1**
>
> **Goal:** close the current “no real monitoring tool” gap with the smallest safe AWS-native change set.
>
> **No application-code changes required.** This phase is IaC-first, stage-first.

### Why this phase comes first

| Reason                         | Effect                                                                      |
| ------------------------------ | --------------------------------------------------------------------------- |
| Uses built-in AWS metrics only | No EMF, no sidecars, no app instrumentation                                 |
| Minimal AWS UI work            | Only SNS email subscription confirmation if email notifications are enabled |
| Lowest debug risk              | Threshold tuning only; no runtime behavior changes                          |
| Enough for the requirement     | Dashboard + alarms + logs = real monitoring tool                            |

### Scope

- CloudWatch Logs retention for ECS service log groups
- One CloudWatch dashboard per environment
- One SNS topic per environment for alarm notifications
- A small alarm set built only from built-in AWS metrics
- Stage-first rollout, then production reuse through the same Pulumi definitions

### Metrics to use in the first dashboard

| Area               | Metric source      | Initial metrics                                                                                  |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------------ |
| Public API edge    | ALB / target group | `RequestCount`, `TargetResponseTime`, `HTTPCode_Target_5XX_Count`, `HealthyHostCount`            |
| ECS services       | ECS service        | `CPUUtilization`, `MemoryUtilization`                                                            |
| Databases          | RDS                | `CPUUtilization`, `DatabaseConnections`, `FreeStorageSpace`                                      |
| Stateful EC2 hosts | EC2                | `StatusCheckFailed` for RabbitMQ host, NAT instances, and the stage PostgreSQL host when present |

**Do not block this phase on Container Insights.** Standard ECS / ALB / RDS / EC2 metrics are enough for the first valid dashboard and alarm set. Container Insights is an enhancement, not a prerequisite.

### Initial dashboards

| Dashboard        | Widgets                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Overview**     | ALB request count, target response time, target 5xx, healthy host count, shop ECS CPU/memory, payments ECS CPU/memory |
| **Data**         | shop RDS CPU/connections/storage, payments RDS CPU/connections/storage, stage PostgreSQL host status where applicable |
| **Stateful EC2** | RabbitMQ EC2 status checks, NAT EC2 status checks, stage PostgreSQL EC2 status checks                                 |

Dashboards are defined as JSON in the Pulumi `infra/` project — same IaC pipeline, version-controlled, reproducible per environment.

### Initial alarms

| Alarm                      | Metric source               | Condition                            | Action      |
| -------------------------- | --------------------------- | ------------------------------------ | ----------- |
| ALB target 5xx             | `HTTPCode_Target_5XX_Count` | > 0 for 5 minutes                    | SNS → email |
| ALB latency high           | `TargetResponseTime`        | above agreed threshold for 5 minutes | SNS → email |
| Target group unhealthy     | `HealthyHostCount`          | below expected count for 2 periods   | SNS → email |
| Shop ECS CPU high          | ECS `CPUUtilization`        | > 80% for 5 minutes                  | SNS → email |
| Shop ECS memory high       | ECS `MemoryUtilization`     | > 80% for 5 minutes                  | SNS → email |
| Payments ECS CPU high      | ECS `CPUUtilization`        | > 80% for 5 minutes                  | SNS → email |
| Payments ECS memory high   | ECS `MemoryUtilization`     | > 80% for 5 minutes                  | SNS → email |
| RDS connections high       | `DatabaseConnections`       | > 80% of chosen ceiling              | SNS → email |
| Stateful EC2 status failed | EC2 `StatusCheckFailed`     | >= 1 for 2 periods                   | SNS → email |

### Manual AWS work

- Confirm SNS email subscription(s)
- Optionally capture dashboard and alarm screenshots for evidence
- No dashboard or alarm resources should be hand-created in the AWS console if Pulumi owns them

### Pulumi scope

- Set log-group retention days per environment
- Create SNS topics and subscriptions
- Create CloudWatch dashboard JSON definitions
- Create CloudWatch alarms referencing existing ECS, ALB, RDS, and EC2 resources / outputs
- Keep Container Insights explicitly out of scope for this first cut

### Exact Pulumi work packages

#### Recommended module placement

1. Add a dedicated observability module under `infra/src/observability/`.
2. Keep CloudWatch log-group ownership in `infra/src/compute/services.ts`, because ECS service log groups are already created there.
3. Wire the new observability module from `infra/index.ts` after foundation, data, messaging, edge, and compute resources already exist.

#### Existing anchors to reuse

Use current stack outputs / resource metadata instead of discovering resources ad hoc:

- ECS cluster: `ecsClusterName`
- ECS services: `shopServiceName`, `paymentsServiceName`
- ECS log groups: `shopLogGroupName`, `paymentsLogGroupName`
- ALB edge: `publicAlbArn`, `publicAlbName`, `shopTargetGroupArn`, `shopTargetGroupName`, `publicEndpointUrl`
- Databases: `databaseBackend`, `shopDatabaseIdentifier`, `paymentsDatabaseIdentifier`, `databaseBootstrapInstanceId`
- Stateful EC2 hosts: `mqBrokerId`, `natInstanceId`

One implementation nuance matters:

- CloudWatch ALB / target-group metrics use **ALB / target-group ARN suffix dimensions**, not only friendly names.
- Current edge exports expose `publicAlbArn` / `shopTargetGroupArn`, but not explicit ARN suffix outputs.
- Before creating target-group widgets and alarms, either:
  - expose `publicAlbArnSuffix` and `shopTargetGroupArnSuffix` from `infra/src/compute/edge.ts`, or
  - create the ALB / target-group dashboard metrics inside the edge module while raw Pulumi resources are still in scope.

#### Concrete resource checklist

- [ ] Update `createLogGroup(...)` in `infra/src/compute/services.ts` to set `retentionInDays` by stack:
  - stage: `30`
  - production: `90`
- [ ] Add `createObservability(...)` in `infra/src/observability/`.
- [ ] Create one `aws.sns.Topic` per environment:
  - `rd-shop-stage-alarms`
  - `rd-shop-production-alarms`
- [ ] Create one `aws.sns.TopicSubscription` per environment for the chosen email receiver.
- [ ] Create one `aws.cloudwatch.Dashboard` per environment for the initial widgets.
- [ ] Create `aws.cloudwatch.MetricAlarm` resources for:
  - ALB target 5xx
  - ALB latency
  - target-group healthy-host count
  - shop ECS CPU
  - shop ECS memory
  - payments ECS CPU
  - payments ECS memory
  - RDS connections / free storage only when `databaseBackend != 'ec2-postgres'`
  - EC2 `StatusCheckFailed` for `mqBrokerId`, `natInstanceId`, and `databaseBootstrapInstanceId` when present
- [ ] Export dashboard names and SNS topic ARNs from `infra/index.ts` so CI / operators can link to them later.

#### Exact environment behavior

- **Stage**
  - Use ALB, ECS, RabbitMQ EC2, NAT EC2, and stage PostgreSQL EC2 metrics.
  - Skip RDS widgets / alarms when `databaseBackend == 'ec2-postgres'`.
- **Production**
  - Use ALB, ECS, RabbitMQ EC2, NAT EC2, and both RDS identifiers.
  - `databaseBootstrapInstanceId` will normally be absent; skip DB-host EC2 widgets there.

#### Alarm tuning rules for the minimal phase

- Prefer longer evaluation windows for alarms that may flap during planned deploys.
- The deploy workflows intentionally quiesce ECS services to `0` during migration windows, so alarms must avoid false positives on short planned dips.
- Recommended first-cut settings:
  - `HealthyHostCount`: alarm only if below `1` for `15` minutes
  - ECS CPU / memory: alarm only after `3` periods of `5` minutes each
  - EC2 `StatusCheckFailed`: alarm after `2` consecutive `5` minute periods
  - RDS `DatabaseConnections`: alarm after `3` periods of `5` minutes
- Stage and production may share the same resources, but production SNS should go to the real operator mailbox; stage can use a lower-noise mailbox.

#### Operator validation checklist

After `pulumi up --stack stage`:

- [ ] verify both ECS log groups show the configured retention days
- [ ] verify the stage dashboard loads widgets without missing-metric errors
- [ ] verify SNS email subscription is confirmed
- [ ] manually trigger one harmless test alarm or temporarily lower one threshold to prove the notification path
- [ ] restore the real threshold before promoting the same resources to production

### Rollout order

1. Add Pulumi resources for both environments.
2. `pulumi up --stack stage`.
3. Confirm stage dashboard widgets populate and one test alarm can fire and reset.
4. `pulumi up --stack production`.
5. Capture screenshots / evidence for the requirement.

### Exit criteria

- Stage and production both have an accessible CloudWatch dashboard.
- At least one alarm per environment is wired to SNS.
- Log retention is enforced (`30d` stage, `90d` production).
- Section 6.5 can point to dashboard + alarms as the monitoring-tool evidence.

---

## Phase 2 — Recommended Application Metrics & Log Consistency

> **Priority: 3 | Severity: 3 | Complexity: 2**
>
> **Goal:** extend Phase 1 from infrastructure monitoring to business-aware monitoring without introducing Prometheus / Grafana into production.
>
> Start only after Phase 1 is live and stable.

### Why this is a separate phase

| Factor                          | Effect                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Requires app-code changes       | Higher regression and rollout risk than Phase 1                                                          |
| Metric schema choices matter    | Bad dimensions / names create noisy or costly metrics                                                    |
| Cross-service consistency helps | `payments` still uses the NestJS default logger while `shop` already uses Pino                           |
| More useful outcome             | Dashboard starts reflecting order flow, worker throughput, and gRPC health instead of infra-only signals |

### Scope

- Keep CloudWatch as the only production observability backend
- Add application-level metrics, preferably via EMF-formatted structured logs
- Optionally align `payments` with Pino for consistent JSON logs across both services
- Extend dashboards and alarms with business-flow metrics

### Common-code boundary

Put only reusable primitives in `libs/`:

- log-level normalization / shared logger constants
- EMF namespace constants and metric-helper builders
- shared field naming conventions

Keep app-specific adapters in each app:

- `shop` HTTP / `pinoHttp` logger config stays in `apps/shop`
- `payments` gRPC logger bootstrap stays in `apps/payments`
- service-specific metric emitters stay near the owning modules

### Recommended implementation order

1. Optional but recommended: migrate `payments` to Pino so both services emit consistent structured JSON.
2. Add HTTP request count / latency metrics in `shop`.
3. Add order lifecycle and worker metrics in `shop`.
4. Add gRPC client metrics in `shop` and gRPC server metrics in `payments`.
5. Add DB latency / query-count metrics where the existing request-context hooks already support them.
6. Extend the CloudWatch dashboards and alarms to include the new app-level metrics.

### Why EMF over sidecars

| Approach                 | Requires                                       | RAM overhead | Fit for t3.micro |
| ------------------------ | ---------------------------------------------- | ------------ | ---------------- |
| **EMF**                  | Structured log lines with `_aws` field         | 0            | Yes              |
| CloudWatch Agent sidecar | Extra container scraping or forwarding metrics | ~100-200MB   | No               |

EMF embeds metric data directly in structured log lines. CloudWatch extracts the `_aws` block and creates real CloudWatch Metrics automatically.

### Example EMF event

```typescript
logger.info({
  _aws: {
    Timestamp: Date.now(),
    CloudWatchMetrics: [
      {
        Namespace: 'RdShop',
        Dimensions: [['method', 'path', 'statusCode']],
        Metrics: [{ Name: 'RequestDuration', Unit: 'Milliseconds' }],
      },
    ],
  },
  method: 'GET',
  path: '/api/v1/products',
  statusCode: 200,
  RequestDuration: 42,
});
```

### Recommended custom metrics

Use one CloudWatch namespace for all application metrics:

- `Namespace = RdShop/Application`

Keep dimensions intentionally low-cardinality. Never emit request ids, user ids, emails, order ids, raw SQL, or raw URLs as metric dimensions.

| Metric                      | Unit         | Dimensions                                                   | Purpose                          |
| --------------------------- | ------------ | ------------------------------------------------------------ | -------------------------------- |
| `HttpRequestCount`          | Count        | `Environment`, `Service`, `Route`, `Method`, `StatusClass`   | request volume                   |
| `HttpRequestDurationMs`     | Milliseconds | `Environment`, `Service`, `Route`, `Method`                  | HTTP latency                     |
| `OrderCreatedCount`         | Count        | `Environment`, `Service`, `InitialStatus`                    | order creation volume            |
| `OrderCompletionCount`      | Count        | `Environment`, `Service`, `FinalStatus`                      | paid / cancelled / failed volume |
| `OrderWorkerMessageCount`   | Count        | `Environment`, `Service`, `Queue`, `Result`                  | worker throughput / retry / DLQ  |
| `OrderProcessingDurationMs` | Milliseconds | `Environment`, `Service`, `Result`                           | end-to-end async processing time |
| `RabbitMqPublishCount`      | Count        | `Environment`, `Service`, `Queue`                            | queue publish volume             |
| `GrpcClientRequestCount`    | Count        | `Environment`, `Service`, `PeerService`, `Method`, `Outcome` | outbound gRPC volume / failures  |
| `GrpcClientDurationMs`      | Milliseconds | `Environment`, `Service`, `PeerService`, `Method`            | outbound gRPC latency            |
| `GrpcServerRequestCount`    | Count        | `Environment`, `Service`, `Method`, `Outcome`                | inbound gRPC volume / failures   |
| `GrpcServerDurationMs`      | Milliseconds | `Environment`, `Service`, `Method`                           | inbound gRPC latency             |
| `DbQueryDurationMs`         | Milliseconds | `Environment`, `Service`, `Operation`, `Entity`              | SQL latency                      |
| `DbQueriesPerRequest`       | Count        | `Environment`, `Service`, `Route`                            | N+1 / query explosion signal     |

#### Dimension contract before code work

- `Environment`: `stage` or `production`
- `Service`: `shop` or `payments`
- `Route`: normalized logical route key, not raw URL; examples:
  - `auth:signin`
  - `products:list`
  - `orders:create`
  - `orders:get-by-id`
- `StatusClass`: `2xx`, `4xx`, `5xx`
- `Outcome`: `success`, `error`, `timeout`, `retry`, `dlq`
- `Entity`: repository / aggregate name such as `Order`, `Product`, `User`, `Payment`

If a route cannot be normalized safely, do not emit route-level metrics for it until a stable key exists.

### Instrumentation points

- global NestJS metrics interceptor for HTTP request metrics
- `RabbitMQService.publish()` and `OrderWorkerService.handleMessage()`
- payments gRPC server handlers and shop gRPC client calls
- TypeORM query logger / existing AsyncLocalStorage-based request context

### Dashboard and alarm extensions

Add a second-wave dashboard once EMF metrics exist:

- request rate / error rate / latency by path
- orders created / processed / paid / cancelled
- worker retry / DLQ volume
- gRPC latency / failure rate

Add alarms only after real metric baselines are visible. App-level alarms should start narrow and conservative.

#### Initial alarm set for Phase 2

Lock these as the **first** app-level alarms before writing code:

| Alarm                       | Metric / expression                                                   | Initial threshold                                        | Notes                                  |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| HTTP 5xx rate high          | `HttpRequestCount` metric math using `StatusClass=5xx` over total     | `> 5%` for `5` minutes, only when total requests `>= 50` | service-wide first, not per-route      |
| HTTP latency high           | `HttpRequestDurationMs` p95                                           | `> 1500 ms` for `15` minutes                             | start with `shop` only                 |
| Worker DLQ message seen     | `OrderWorkerMessageCount{Result=dlq}` sum                             | `>= 1` over `10` minutes                                 | critical business alarm                |
| gRPC client error rate high | `GrpcClientRequestCount` metric math using `Outcome=error` over total | `> 5%` for `5` minutes, only when total requests `>= 20` | watch `shop -> payments` path          |
| gRPC client latency high    | `GrpcClientDurationMs` p95                                            | `> 500 ms` for `10` minutes                              | start with payments authorization path |

Dashboard-only in the first app-metrics cut:

- `DbQueryDurationMs`
- `DbQueriesPerRequest`
- `OrderProcessingDurationMs`

These should be graphed first and promoted to alarms only after real stage baselines are collected.

#### Code-work sequence after the metric contract is frozen

1. Add shared metric-schema helpers in `libs/` only for constants / builders.
2. Add `payments` Pino alignment if chosen.
3. Emit `HttpRequestCount` and `HttpRequestDurationMs` from `shop`.
4. Emit worker and RabbitMQ metrics in `shop`.
5. Emit gRPC client metrics in `shop` and gRPC server metrics in `payments`.
6. Emit DB timing / query-count metrics last.
7. Extend Pulumi dashboards and alarms only after stage metrics are visible in CloudWatch.

### Dependencies

No extra dependency is required if EMF is emitted manually in structured logs. If preferred, `aws-embedded-metrics` is acceptable.

### Manual AWS work

- none beyond normal metric validation and optional screenshot capture
- metric propagation delay in CloudWatch should be expected during first validation

### Exit criteria

- Both services emit consistent, searchable structured logs, or `payments` divergence is an explicit conscious deferral.
- CloudWatch shows application metrics in a dedicated namespace.
- Dashboards visualize at least one business-flow view, not only infrastructure health.
- Requirement evidence is stronger than logs-only fallback.

---

## Phase 3 — Distributed Tracing (AWS X-Ray)

> **Priority: 2 | Severity: 2 | Complexity: 3**
>
> **Deferred to post-free-tier.** At current scale (2 services, 1 instance, synchronous gRPC), Pino `requestId` correlation across CloudWatch log streams covers 90% of debugging needs.

### Why defer

| Factor                           | Assessment                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------- |
| **Current debugging capability** | Pino `requestId` correlates shop ↔ payments logs in CloudWatch Logs Insights |
| **ADOT Collector sidecar**       | ~100-200MB RAM — doesn't fit on t3.micro alongside both services             |
| **X-Ray SDK (no collector)**     | Direct sends possible but adds SDK dependency + ~10MB overhead per service   |
| **X-Ray free tier**              | 100K traces/month — sufficient for staging                                   |
| **Value at 2-service scale**     | Low. Tracing shines with 5+ services and async fan-out patterns              |

### Implementation (when ready)

When budget allows (t3.small or Fargate), add OpenTelemetry with X-Ray exporter:

```
npm install @opentelemetry/sdk-node @opentelemetry/api \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/id-generator-aws-xray \
  @opentelemetry/exporter-trace-otlp-http
```

**Bootstrap** — `apps/shop/src/tracing.ts` (loaded before app):

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';

const sdk = new NodeSDK({
  serviceName: 'shop-service',
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  idGenerator: new AWSXRayIdGenerator(),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

Auto-instruments: HTTP, Express, pg (PostgreSQL), amqplib (RabbitMQ), gRPC.

**ADOT Collector** as ECS sidecar receives OTLP from the app and forwards to X-Ray. This keeps the app code identical between local (Jaeger) and AWS (X-Ray).

### Trace context propagation

- **HTTP → RabbitMQ:** Inject trace context in message headers; extract in worker
- **HTTP → gRPC:** Auto-propagated by OpenTelemetry gRPC instrumentation
- **Request ID correlation:** Link `X-Request-ID` to trace ID via span attributes

### Tasks (future)

- [ ] Install OpenTelemetry packages
- [ ] Create `tracing.ts` bootstrap file with X-Ray ID generator
- [ ] Update `main.ts` to import tracing before app
- [ ] Add ADOT Collector sidecar to ECS task definition
- [ ] Add trace context propagation in RabbitMQ message headers
- [ ] Custom spans for business operations (order creation, payment auth)
- [ ] Add `OTEL_EXPORTER_OTLP_ENDPOINT` to environment schema
- [ ] Verify traces in X-Ray console

---

## CloudWatch Logs integration

> Part of AWS migration — no separate implementation phase needed.

Current state:

- `shop` already writes structured JSON logs through Pino
- `payments` still lands in CloudWatch Logs through ECS `awslogs`, but log structure remains less consistent until Phase 2

ECS `awslogs` captures both services' stdout/stderr and sends them to CloudWatch Logs.

**ECS task definition (configured in Pulumi):**

```json
"logConfiguration": {
  "logDriver": "awslogs",
  "options": {
    "awslogs-group": "/ecs/rd-shop/shop",
    "awslogs-region": "eu-central-1",
    "awslogs-stream-prefix": "shop"
  }
}
```

**CloudWatch Logs Insights** can query shop Pino fields directly today:

```
fields @timestamp, req.method, req.url, res.statusCode, responseTime
| filter level = 50          # Pino numeric level: 50 = error
| sort @timestamp desc
| limit 100
```

**Log groups:**

- `/ecs/rd-shop/shop` — shop service logs
- `/ecs/rd-shop/payments` — payments service logs

**Retention:** Set per log group (30 days stage, 90 days production) — configured in Pulumi.

---

## Implementation order

```
Security Hardening (Pino + Helmet + Throttler)  ← Prerequisite — see security-hardening-plan.md
  ↓
AWS Migration Phases 0-2 (VPC + Data + Compute) ← Infrastructure must exist for CloudWatch
  ↓
Phase 1 (Minimal CloudWatch monitoring)          ← Dashboards + alarms + retention from built-in AWS metrics
  ↓
Phase 2 (App metrics + log consistency)          ← EMF metrics + optional payments Pino alignment
  ↓
Phase 3 (X-Ray Tracing)                          ← Deferred to post-free-tier (t3.small or Fargate)
```

---

## Env vars

| Variable                      | Value                   | Notes                                 |
| ----------------------------- | ----------------------- | ------------------------------------- |
| `AWS_REGION`                  | `eu-central-1`          | Used by EMF and CloudWatch SDK        |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | ADOT collector sidecar (Phase 3 only) |

---

## Cross-references

- Pino structured logging + HTTP hardening: `docs/backend/requirements/security-hardening-plan.md` (Prerequisite + Parts 4a, 4b)
- AWS infrastructure: `docs/backend/requirements/aws-migration-plan.md`
- ECS task definitions with `awslogs` driver: `docs/backend/requirements/aws-migration-plan.md` (Phase 2)
