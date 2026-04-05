# Observability & Reliability — Implementation Plan

## Current state

- NestJS default logger with configurable log levels (`APP_LOG_LEVEL`)
- `RequestIdMiddleware`: generates/propagates `X-Request-ID` per request
- `QueryLoggerMiddleware`: counts SQL queries per request via AsyncLocalStorage (GraphQL only)
- `AsyncLocalStorage` for request-scoped context (`queryCount`)
- Health checks: `/health` (liveness), `/ready` (postgres + rabbitmq + minio), `/status` (+ payments gRPC)
- Graceful shutdown implemented
- No Helmet, no CORS config, no rate limiting, no structured logging, no metrics, no distributed tracing
- No Winston/Pino — uses default NestJS `ConsoleLogger`

---

## Phase 1 — Structured logging (Pino)

### 1.1 Why Pino over Winston

- 5-10x faster (critical in Node.js event loop)
- Native JSON output — direct compatible with log aggregators (ELK, Datadog, CloudWatch)
- `nestjs-pino` integrates seamlessly with NestJS lifecycle
- Built-in request serialization (method, url, status, duration)

### 1.2 Dependencies

```
npm install nestjs-pino pino-http pino-pretty
```

### 1.3 Configuration — `apps/shop/src/config/logger.ts` (rewrite)

```typescript
LoggerModule.forRoot({
  pinoHttp: {
    level: process.env.APP_LOG_LEVEL || 'info',
    transport: isProd ? undefined : { target: 'pino-pretty' },
    genReqId: (req) => req.headers['x-request-id'] || randomUUID(),
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, requestId: req.id }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
});
```

### 1.4 Request context

pino-http creates a child logger per request with `requestId`, `method`, `url`, `statusCode`, `responseTime` automatically. `userId` can be added via `req.log.setBindings({ userId })` in a guard/interceptor after JWT validation — no `AsyncLocalStorage` needed.

The existing `AsyncLocalStorage` stays as-is — it's a query counter for DataLoader verification, not a request context store. No reason to merge the two concerns.

### 1.5 Replace existing logger usage

- Remove `RequestIdMiddleware` (pino-http `genReqId` handles request ID generation/propagation natively)
- Keep `AsyncLocalStorage` + `QueryLoggerMiddleware` for query counting — just swap `this.logger` to Pino
- Replace `Logger.log()` / `this.logger.log()` calls with Pino logger injection

### 1.6 Tasks

- [ ] Install `nestjs-pino`, `pino-http`, `pino-pretty`
- [ ] Rewrite `config/logger.ts` for Pino
- [ ] Register `LoggerModule` in `AppModule`
- [ ] Remove `RequestIdMiddleware` (replaced by pino-http `genReqId`)
- [ ] Update `QueryLoggerMiddleware` to use Pino (keep AsyncLocalStorage for query counting)
- [ ] Add `userId` to request log context via `req.log.setBindings()` in auth guard/interceptor
- [ ] Redact sensitive fields (Authorization header, passwords)
- [ ] Update `main.ts`: `app.useLogger(app.get(Logger))`
- [ ] Verify JSON output in prod, pretty-print in dev
- [ ] Update tests (logger mock may need adjustment)

---

## Phase 2 — HTTP security hardening

### 2.1 Helmet

```
npm install helmet
```

In `main.ts`:

```typescript
app.use(helmet());
```

Sets secure HTTP headers: `X-Content-Type-Options`, `Strict-Transport-Security`, `X-Frame-Options`, etc.

### 2.2 CORS

```typescript
app.enableCors({
  origin: process.env.CORS_ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  credentials: true,
  maxAge: 86400,
});
```

Env var: `CORS_ALLOWED_ORIGINS` — comma-separated list. Wide open in dev, restricted in prod.

### 2.3 Rate limiting

```
npm install @nestjs/throttler
```

```typescript
ThrottlerModule.forRoot([
  { name: 'short', ttl: 1000, limit: 3 }, // 3 req/sec
  { name: 'medium', ttl: 10000, limit: 20 }, // 20 req/10sec
  { name: 'long', ttl: 60000, limit: 100 }, // 100 req/min
]);
```

Custom stricter limits on auth endpoints:

- `/auth/signin`: 5 attempts per minute per IP
- `/auth/forgot-password`: 3 per hour per email
- `/auth/refresh`: 10 per minute

> **Important:** `@nestjs/throttler` rate-limits by IP by default. The auth endpoints
> `forgot-password` (3/hour per email) and `resend-verification` (1/min per userId)
> must rate-limit by **user identity**, not IP, to prevent abuse across proxies.
> This requires a custom `ThrottlerGuard` that extracts the key from the request body
> or JWT payload:
>
> ```typescript
> @Injectable()
> export class UserEmailThrottleGuard extends ThrottlerGuard {
>   protected async getTracker(req: Request): Promise<string> {
>     return req.body?.email ?? req.ip;
>   }
> }
> ```
>
> When these guards are in place, remove the manual DB-based rate-limit queries
> (`threeHoursAgo` / `oneMinuteAgo`) from `AuthService.forgotPassword()` and
> `AuthService.resendVerification()`.

### 2.4 Tasks

- [ ] Install + configure Helmet
- [ ] Configure CORS with env-based origins
- [ ] Install `@nestjs/throttler`, configure global + per-route limits
- [ ] Add `CORS_ALLOWED_ORIGINS` to environment schema
- [ ] Apply `@Throttle()` on auth endpoints
- [ ] Verify GraphQL throttling (needs `GqlThrottlerGuard`)
- [ ] Tests: verify rate limit responses (429)

---

## Phase 3 — Prometheus metrics

### 3.1 Dependencies

```
npm install prom-client @willsoto/nestjs-prometheus
```

### 3.2 Metrics endpoint

`GET /metrics` — Prometheus scrape endpoint (excluded from auth + `api/` prefix).

### 3.3 Default metrics

`prom-client` auto-collects: process CPU, memory, event loop lag, GC stats, active handles.

### 3.4 Custom metrics

| Metric                              | Type      | Labels                     | Purpose               |
| ----------------------------------- | --------- | -------------------------- | --------------------- |
| `http_requests_total`               | Counter   | method, path, status       | Request volume        |
| `http_request_duration_seconds`     | Histogram | method, path, status       | Latency distribution  |
| `orders_created_total`              | Counter   | status                     | Order creation volume |
| `orders_processed_total`            | Counter   | result (success/retry/dlq) | Worker throughput     |
| `rabbitmq_messages_published_total` | Counter   | queue                      | Queue publish volume  |
| `grpc_requests_total`               | Counter   | method, status             | gRPC call volume      |
| `grpc_request_duration_seconds`     | Histogram | method                     | gRPC latency          |
| `db_query_duration_seconds`         | Histogram | operation                  | SQL query latency     |
| `db_queries_per_request`            | Histogram | path                       | N+1 detection         |

### 3.5 Implementation

- `MetricsInterceptor` — global NestJS interceptor for HTTP metrics
- Instrument `RabbitMQService.publish()` and `OrderWorkerService.handleMessage()`
- Instrument `PaymentsGrpcService.authorize()` and `getPaymentStatus()`
- Instrument TypeORM query logger (extend existing `AsyncLocalStorage` pattern)

### 3.6 Tasks

- [ ] Install `prom-client` + `@willsoto/nestjs-prometheus`
- [ ] Create `MetricsModule`, register in `AppModule`
- [ ] Expose `/metrics` endpoint (bypass auth + prefix)
- [ ] Create `MetricsInterceptor` for HTTP request metrics
- [ ] Add custom counters/histograms for orders, RabbitMQ, gRPC
- [ ] Instrument TypeORM query logger for DB metrics
- [ ] Docker compose: add Prometheus service + scrape config
- [ ] Tests: verify metrics endpoint returns valid Prometheus format

---

## Phase 4 — Distributed tracing (OpenTelemetry)

### 4.1 Dependencies

```
npm install @opentelemetry/sdk-node @opentelemetry/api \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http
```

### 4.2 Tracing setup — `apps/shop/src/tracing.ts` (loaded before app)

```typescript
// Must be imported before any other module
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: 'shop-service',
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

Auto-instruments: HTTP, Express, pg (PostgreSQL), amqplib (RabbitMQ), gRPC.

### 4.3 Trace context propagation

- **HTTP → RabbitMQ:** Inject trace context in message headers; extract in worker
- **HTTP → gRPC:** Auto-propagated by OpenTelemetry gRPC instrumentation
- **Request ID correlation:** Link `X-Request-ID` to trace ID via span attributes

### 4.4 Docker compose additions

| Service  | Image                           | Port                         | Purpose             |
| -------- | ------------------------------- | ---------------------------- | ------------------- |
| `jaeger` | `jaegertracing/all-in-one:1.57` | 16686 (UI), 4318 (OTLP HTTP) | Trace visualization |

Or use Grafana Tempo if Grafana is already in the stack.

### 4.5 Tasks

- [ ] Install OpenTelemetry packages
- [ ] Create `tracing.ts` bootstrap file
- [ ] Update `main.ts` to import tracing before app
- [ ] Add trace context propagation in RabbitMQ message headers
- [ ] Custom spans for business operations (order creation, payment auth)
- [ ] Docker compose: add Jaeger or Tempo service
- [ ] Add `OTEL_EXPORTER_OTLP_ENDPOINT` to environment schema
- [ ] Verify traces in Jaeger UI

---

## Phase 5 — Grafana dashboards (deferred)

### 5.1 Docker compose additions

| Service      | Image                    | Port |
| ------------ | ------------------------ | ---- |
| `grafana`    | `grafana/grafana:latest` | 3000 |
| `prometheus` | `prom/prometheus:latest` | 9090 |

### 5.2 Pre-built dashboards

- **API Overview:** Request rate, error rate, p50/p95/p99 latency
- **Orders:** Creation rate, processing time, retry rate, DLQ volume
- **Database:** Query rate, slow queries, connections
- **Infrastructure:** CPU, memory, event loop lag

### 5.3 Alerting rules

| Alert                         | Condition                          | Severity |
| ----------------------------- | ---------------------------------- | -------- |
| High error rate               | 5xx > 5% of total for 5m           | Critical |
| Slow responses                | p95 > 2s for 5m                    | Warning  |
| DLQ growing                   | orders_dlq size > 0 for 10m        | Warning  |
| DB connection pool exhaustion | available connections < 2 for 1m   | Critical |
| Payment service down          | gRPC Ping failures > 3 consecutive | Warning  |

### 5.4 Tasks

- [ ] Docker compose: Grafana + Prometheus services
- [ ] Prometheus scrape config for shop + payments
- [ ] Import/create dashboards (JSON provisioning)
- [ ] Alert rules in Prometheus/Grafana
- [ ] Documentation: how to access dashboards locally

---

## AWS CloudWatch integration

When infrastructure moves to AWS (ECS/Fargate), CloudWatch becomes the production observability backend. The phases above remain the same — Pino, Prometheus, and OpenTelemetry are application-level concerns — but their outputs route to CloudWatch instead of (or alongside) local tools.

### Logs — CloudWatch Logs

No code changes needed. Pino writes JSON to stdout → ECS `awslogs` log driver captures it → CloudWatch Logs ingests each line as a structured JSON event.

**ECS task definition:**

```json
"logConfiguration": {
  "logDriver": "awslogs",
  "options": {
    "awslogs-group": "/ecs/rd-shop",
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

**Retention:** Set per log group (e.g., 30 days dev, 90 days prod).

### Metrics — CloudWatch Metrics

Two options (not mutually exclusive):

| Approach                          | How                                                                                   | Pros                                    | Cons                                          |
| --------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------- |
| **Embedded Metrics Format (EMF)** | Pino logs with special `_aws` field → CloudWatch auto-extracts metrics from log lines | Zero infrastructure, no sidecar         | Metric resolution limited to log frequency    |
| **CloudWatch Agent sidecar**      | Scrapes `/metrics` (Prometheus format) → pushes to CloudWatch Metrics                 | Reuses Phase 3 Prometheus metrics as-is | Requires sidecar container in task definition |

**Recommended: CloudWatch Agent sidecar** — reuses all Prometheus metrics from Phase 3 without code changes. Add as a sidecar container in the ECS task definition pointed at the app's `/metrics` endpoint.

### Tracing — AWS X-Ray via OpenTelemetry

OpenTelemetry (Phase 4) can export to X-Ray instead of Jaeger. Replace the OTLP exporter with the X-Ray exporter:

```
npm install @opentelemetry/id-generator-aws-xray @aws/aws-distro-opentelemetry-node-autoinstrumentation
```

Or use the **AWS Distro for OpenTelemetry (ADOT) Collector** as a sidecar — receives OTLP from the app and forwards to X-Ray. This keeps the app code identical between local (Jaeger) and AWS (X-Ray).

### Alarms

CloudWatch Alarms replace Grafana alerting rules from Phase 5:

| Alarm             | Metric source                                  | Condition     |
| ----------------- | ---------------------------------------------- | ------------- |
| High error rate   | `http_requests_total{status=~"5.."}` via agent | > 5% for 5m   |
| Slow responses    | `http_request_duration_seconds` p95            | > 2s for 5m   |
| DLQ growing       | `orders_processed_total{result="dlq"}`         | > 0 for 10m   |
| Service unhealthy | ECS health check failures                      | 3 consecutive |
| High CPU/memory   | ECS built-in metrics                           | > 80% for 5m  |

Notifications via SNS → email/Slack.

### Dashboards

CloudWatch Dashboards replace Grafana dashboards (Phase 5) in production. Same panels, different tool — built from the same underlying metrics.

Local dev still uses Prometheus + Grafana (docker compose) for fast iteration.

### Env vars (AWS-specific)

```
AWS_REGION=eu-central-1
CLOUDWATCH_LOG_GROUP=/ecs/rd-shop
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318    # ADOT collector sidecar
```

### Tasks

- [ ] Configure ECS task definition with `awslogs` log driver
- [ ] Set CloudWatch Logs retention policies per environment
- [ ] Add CloudWatch Agent sidecar for Prometheus metrics scraping
- [ ] Configure ADOT Collector sidecar for X-Ray trace export
- [ ] Create CloudWatch Alarms (error rate, latency, DLQ, health)
- [ ] Create CloudWatch Dashboard (API overview, orders, DB)
- [ ] SNS topic + subscription for alarm notifications
- [ ] Document local-vs-AWS observability differences

---

## Implementation order recommendation

```
Phase 1 (Structured logging)  ← Foundation — do first, everything else depends on good logs
  ↓
Phase 2 (Security hardening)  ← Quick win, no dependencies
  ↓
Phase 3 (Metrics)             ← Requires Phase 1 for correlated logging
  ↓
Phase 4 (Tracing)             ← Biggest value after metrics are in place
  ↓
Phase 5 (Dashboards)          ← Local dev visualization (Prometheus + Grafana)
  ↓
AWS CloudWatch                ← Production observability — routes Pino logs, Prometheus
                                 metrics, and OTel traces to CloudWatch/X-Ray. Done
                                 during or after AWS infrastructure migration.
```
