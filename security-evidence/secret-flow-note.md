# Secrets Management — rd_shop

> Full context: [security-homework/SECURITY-BASELINE.md](../security-homework/SECURITY-BASELINE.md#3-secrets-management)

## Where secrets live

```
GitHub Environment Secrets (environments: stage / production)
  │  base64-encoded ENV_FILE_SHOP, ENV_FILE_PAYMENTS
  ↓
GitHub Actions deploy workflow (SSH into VM)
  │  printf '%s' "${ENV_FILE_SHOP}" | base64 -d > apps/shop/.env.production
  ↓
VM file system: apps/{shop,payments}/.env.production
  │  plaintext, VM-local, owner = deploy user only
  ↓
docker compose env_file mount → container env vars at runtime
```

**Security properties:**

- Secrets never baked into Docker images (`.env*` deleted at build stage)
- Per-environment isolation (`stage` and `production` are separate GH environments)
- Production deploys require **manual approval gate** in GitHub
- SSH tunnel for all secret injection (not over HTTP)
- GitHub Actions masks secret values in job logs

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

## Current vs. target secrets delivery

| Dimension          | Current (VM + Docker Compose)    | Target (AWS)                                  |
| ------------------ | -------------------------------- | --------------------------------------------- |
| Secret store       | GitHub Environment Secrets       | AWS Secrets Manager                           |
| Delivery mechanism | base64 → SSH → `.env.production` | ECS task secrets / SSM Parameter Store        |
| Rotation           | Manual (no automation)           | Automated via Secrets Manager rotation Lambda |
| Access control     | GH environment protection rules  | IAM role + resource-based policy              |
| Audit trail        | GH Actions logs                  | CloudTrail + Secrets Manager audit            |

## Residual risk

- No automated rotation (blocked on [AWS migration](../docs/backend/requirements/aws-migration-plan.md))
- `.env.production` is plaintext on disk — mitigated by SSH-only access and file ownership
