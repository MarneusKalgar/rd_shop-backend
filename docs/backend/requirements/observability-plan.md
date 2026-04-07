# Observability & Reliability — Implementation Plan

> Each phase carries **Priority** (business urgency), **Severity** (risk if absent), and **Complexity** (implementation effort) rated 1–5.
>
> **Phases 1–2** (Pino structured logging + HTTP security hardening) have been **moved to `security-hardening-plan.md`** — they are prerequisites for security hardening and are implemented in that scope.

## Current state

- NestJS default logger with configurable log levels (`APP_LOG_LEVEL`)
- `RequestIdMiddleware`: generates/propagates `X-Request-ID` per request
- `QueryLoggerMiddleware`: counts SQL queries per request via AsyncLocalStorage (GraphQL only)
- `AsyncLocalStorage` for request-scoped context (`queryCount`)
- Health checks: `/health` (liveness), `/ready` (postgres + rabbitmq + minio), `/status` (+ payments gRPC)
- Graceful shutdown implemented
- No structured logging, no metrics, no distributed tracing
- No Winston/Pino — uses default NestJS `ConsoleLogger`

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

## Phase 1 — CloudWatch Metrics via Embedded Metrics Format (EMF)

> **Priority: 3 | Severity: 3 | Complexity: 2**
>
> **Prerequisite:** Pino structured logging (`security-hardening-plan.md`, Prerequisite section)

### Why EMF over CloudWatch Agent sidecar

| Approach         | Requires                                                        | RAM overhead | Fit for t3.micro        |
| ---------------- | --------------------------------------------------------------- | ------------ | ----------------------- |
| **EMF**          | Nothing — Pino logs with `_aws` field, CloudWatch auto-extracts | 0            | Yes                     |
| CW Agent sidecar | Sidecar container scraping `/metrics`                           | ~100-200MB   | No — no memory headroom |

EMF embeds metric data directly in Pino log lines. CloudWatch parses the `_aws` field and creates real CloudWatch Metrics automatically — no sidecar, no Prometheus server, no additional compute.

### Implementation

**`MetricsInterceptor`** — global NestJS interceptor that emits EMF-formatted log lines:

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

### Custom metrics

| Metric                              | Type    | Labels                     | Purpose               |
| ----------------------------------- | ------- | -------------------------- | --------------------- |
| `http_requests_total`               | Counter | method, path, status       | Request volume        |
| `http_request_duration_ms`          | Value   | method, path, status       | Latency               |
| `orders_created_total`              | Counter | status                     | Order creation volume |
| `orders_processed_total`            | Counter | result (success/retry/dlq) | Worker throughput     |
| `rabbitmq_messages_published_total` | Counter | queue                      | Queue publish volume  |
| `grpc_requests_total`               | Counter | method, status             | gRPC call volume      |
| `grpc_request_duration_ms`          | Value   | method                     | gRPC latency          |
| `db_query_duration_ms`              | Value   | operation                  | SQL query latency     |
| `db_queries_per_request`            | Value   | path                       | N+1 detection         |

### Instrumentation points

- `MetricsInterceptor` — global NestJS interceptor for HTTP request metrics
- `RabbitMQService.publish()` and `OrderWorkerService.handleMessage()`
- `PaymentsGrpcService.authorize()` and `getPaymentStatus()`
- TypeORM query logger (extend existing `AsyncLocalStorage` pattern)

### Local dev: Prometheus (optional)

For local development, keep `prom-client` + `@willsoto/nestjs-prometheus` as optional dependencies. The `/metrics` endpoint works in dev for Prometheus scraping + Grafana visualization. In AWS, EMF takes over — the `/metrics` endpoint is not used in production.

### Dependencies

```
npm install aws-embedded-metrics
```

Or emit EMF format manually via Pino (no extra dependency — just structured log lines with `_aws` field).

### Tasks

- [ ] Create `MetricsInterceptor` (global NestJS interceptor)
- [ ] Define EMF metric schemas for HTTP, orders, RabbitMQ, gRPC
- [ ] Instrument `RabbitMQService.publish()` and `OrderWorkerService.handleMessage()`
- [ ] Instrument `PaymentsGrpcService` methods
- [ ] Instrument TypeORM query logger for DB metrics
- [ ] Optional: add `prom-client` + `/metrics` for local dev Prometheus
- [ ] Verify metrics appear in CloudWatch Metrics console

---

## Phase 2 — CloudWatch Dashboards & Alarms

> **Priority: 2 | Severity: 2 | Complexity: 2**
>
> **Prerequisite:** Phase 1 (metrics must exist in CloudWatch before dashboards can visualize them)

### Dashboards (provisioned via Pulumi)

| Dashboard          | Widgets                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- |
| **API Overview**   | Request rate, error rate (5xx), p50/p95/p99 latency                                      |
| **Orders**         | Creation rate, processing time, retry rate, DLQ volume                                   |
| **Infrastructure** | ECS CPU/memory utilization (built-in ECS metrics), RDS connections, AmazonMQ queue depth |

Dashboards are defined as JSON in the Pulumi `infra/` project — same IaC pipeline, version-controlled, reproducible per environment.

### Alarms

| Alarm                    | Metric source                              | Condition                | Action                 |
| ------------------------ | ------------------------------------------ | ------------------------ | ---------------------- |
| High error rate          | `http_requests_total` (EMF)                | 5xx > 5% of total for 5m | SNS → email            |
| Slow responses           | `http_request_duration_ms` p95             | > 2s for 5m              | SNS → email            |
| DLQ growing              | `orders_processed_total{result=dlq}`       | > 0 for 10m              | SNS → email            |
| Service unhealthy        | ECS health check (built-in)                | 3 consecutive failures   | ECS auto-restart + SNS |
| High CPU/memory          | ECS `CPUUtilization` / `MemoryUtilization` | > 80% for 5m             | SNS → email            |
| DB connections exhausted | RDS `DatabaseConnections` (built-in)       | > 80% of max for 1m      | SNS → email            |

### Notifications

- SNS topic per environment: `rd-shop-alarms-stage`, `rd-shop-alarms-production`
- Email subscription initially; Slack webhook (via Lambda) as future enhancement

### Tasks

- [ ] Create CloudWatch Dashboard definitions in Pulumi
- [ ] Create CloudWatch Alarms in Pulumi
- [ ] Create SNS topics + email subscriptions in Pulumi
- [ ] Set CloudWatch Logs retention policies (30 days stage, 90 days production)
- [ ] Document alarm runbook (what each alarm means, how to respond)

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

Pino writes JSON to stdout → ECS `awslogs` log driver captures it → CloudWatch Logs ingests each line as a structured JSON event. **Zero application code changes.**

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

**CloudWatch Logs Insights** can query Pino fields directly:

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
Phase 1 (CloudWatch Metrics via EMF)             ← MetricsInterceptor + EMF format
  ↓
Phase 2 (CloudWatch Dashboards + Alarms)         ← Pulumi IaC, SNS notifications
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
