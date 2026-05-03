# Secrets Management — rd_shop

> Full context: [security-homework/SECURITY-BASELINE.md](../security-homework/SECURITY-BASELINE.md#3-secrets-management)

## Where secrets live

```
Pulumi ESC (deploy-time Pulumi config)
  │  `rd-shop/stage`, `rd-shop/production`
  ↓
Pulumi stack settings import
  │  `environment:` in `infra/Pulumi.<stack>.yaml`
  ↓
GitHub Actions deploy workflow
  │  `pulumi up` with OIDC AWS auth + Pulumi access token
  ↓
AWS Secrets Manager + SSM Parameter Store
  │  Pulumi writes runtime secrets and non-secret config per stack/service
  ↓
ECS task definitions (`valueFrom`)
  │
  ↓
Container env at startup
```

**Security properties:**

- Deploy-time Pulumi secrets are centralized in Pulumi ESC, not active stack-local `secure:` entries
- Runtime secrets are not copied to VM filesystems; ECS resolves them directly from AWS secret stores
- Per-environment isolation exists across GitHub Environments, Pulumi ESC environments, AWS Secrets Manager names, and SSM parameter prefixes
- Production deploys require **manual approval gate** in GitHub
- GitHub Actions holds deploy credentials/tokens, not application secret payload files
- Deploy-time secrets were rotated during the Pulumi ESC cutover

## What must never be logged

| Field                                                          | Why                         |
| -------------------------------------------------------------- | --------------------------- |
| `Authorization` header                                         | Contains raw JWT            |
| `cookie` header                                                | Contains refresh token      |
| `password` (any form)                                          | Self-evident                |
| `tokenHash` DB column                                          | Bcrypt hash of secret token |
| Raw reset/verification tokens                                  | Single-use secret           |
| AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) | IAM access                  |
| Database URL / credentials                                     | DB access                   |
| `JWT_SECRET` / `JWT_PRIVATE_KEY`                               | Token signing               |

**Enforced automatically:**

- `Authorization` and `cookie` headers: `redact` in Pino config (`apps/shop/src/config/logger.ts`)
- `password` column: `select: false` on `User` entity (never included in queries by default)
- Stack traces: stripped by `GlobalExceptionFilter` before reaching HTTP responses

## Current secret delivery model

| Layer                     | Current implementation                                                               |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Deploy-time secret store  | Pulumi ESC (`rd-shop/stage`, `rd-shop/production`)                                   |
| Runtime secret store      | AWS Secrets Manager (`rd-shop/shop/<stack>`, `rd-shop/payments/<stack>`)             |
| Runtime non-secret config | SSM Parameter Store (`/rd-shop/<stack>/<service>/*`)                                 |
| Delivery mechanism        | Pulumi writes stores, ECS injects by ARN / parameter name                            |
| Access control            | GitHub Environment + Pulumi access token for deploy-time; IAM task roles for runtime |
| Audit trail               | GitHub Actions for deploys; CloudTrail / Secrets Manager access logs in AWS          |

## Residual risk

- No automated rotation for deploy-time JWT / RabbitMQ secrets yet; updates are currently procedural through Pulumi ESC change windows
- Runtime secret rotation runbooks are still incomplete even though the AWS secret stores are in place
