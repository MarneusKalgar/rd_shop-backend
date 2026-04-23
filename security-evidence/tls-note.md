# Transport Security / TLS Posture — rd_shop

> Full context: [security-homework/SECURITY-BASELINE.md](../security-homework/SECURITY-BASELINE.md#4-transport-security--tls)

## Current state (VM + Docker Compose)

| Segment                  | Protocol | TLS | Notes                                          |
| ------------------------ | -------- | --- | ---------------------------------------------- |
| Client → Shop API        | HTTP     | ❌  | No edge proxy/cert on VM                       |
| Shop → Postgres          | TCP      | ❌  | Same Docker network, trusted by placement      |
| Shop → RabbitMQ          | AMQP     | ❌  | Same Docker network                            |
| Shop → MinIO (S3)        | HTTP     | ❌  | Same Docker network                            |
| Shop → Payments (gRPC)   | HTTP/2   | ❌  | Shared Docker bridge network                   |
| Client → MinIO presigned | HTTP     | ❌  | Dev only; prod uses real S3/CloudFront (HTTPS) |

## Target state (AWS migration)

See [aws-migration-plan.md](../docs/backend/requirements/aws-migration-plan.md) for full scope.

| Segment               | Protocol      | TLS | Notes                              |
| --------------------- | ------------- | --- | ---------------------------------- |
| Client → ALB          | HTTPS         | ✅  | ACM certificate, TLS 1.2+          |
| ALB → Shop ECS        | HTTP          | ❌  | Internal VPC, trusted by placement |
| Shop → RDS Postgres   | TCP           | ✅  | RDS enforces SSL by default        |
| Shop → AmazonMQ / SQS | AMQPS / HTTPS | ✅  | Managed service, TLS enforced      |
| Shop → S3             | HTTPS         | ✅  | AWS SDK default                    |
| Shop → Payments gRPC  | HTTP/2        | ✅  | Service mesh or internal ALB       |
| Client → CloudFront   | HTTPS         | ✅  | ACM cert on distribution           |

## App-level TLS readiness (already implemented)

- `secure: true` on refresh cookie gated on `isProduction()` — no TLS in dev, enforced in prod
- `APP_URL` env var drives all generated links — no hardcoded `http://`
- S3 presigned URLs generated as HTTPS by AWS SDK

## Traffic classification

| Traffic type           | Classification                | Current protection                        |
| ---------------------- | ----------------------------- | ----------------------------------------- |
| Client → API           | Public                        | Rate limiting, JWT auth, input validation |
| Shop → Payments (gRPC) | Internal trusted-by-placement | Docker network isolation                  |
| Shop → Postgres        | Internal trusted-by-placement | Docker network; creds via env             |
| Shop → RabbitMQ        | Internal trusted-by-placement | Docker network; creds via env             |
| Shop → MinIO / S3      | Internal (dev) / HTTPS (prod) | IAM creds; VPC in AWS target              |

## Deferred to AWS migration

- HTTP → HTTPS redirect (ALB listener rule)
- ACM certificate provisioning
- gRPC inter-service TLS (service mesh or mTLS)
- `Strict-Transport-Security` header effective once TLS is in place
