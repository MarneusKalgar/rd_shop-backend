# AWS Migration Plan

> Migration from single-VM Docker Compose deployment to AWS managed services.
> Each phase carries **Priority** (business urgency), **Severity** (risk if skipped), and **Complexity** (implementation effort) rated 1–5.

---

## Current State

### Architecture

Two NestJS services deployed as Docker containers on a single VM via SSH from GitHub Actions:

| Service      | Role                                             | Port | Protocol      |
| ------------ | ------------------------------------------------ | ---- | ------------- |
| **shop**     | HTTP REST + GraphQL (Apollo) + RabbitMQ consumer | 8080 | HTTP          |
| **payments** | gRPC server (internal only)                      | 5001 | HTTP/2 (gRPC) |

### Supporting infrastructure (all on the same VM)

| Component             | Current                        | Image                           |
| --------------------- | ------------------------------ | ------------------------------- |
| Postgres (shop)       | Docker container               | postgres:16-alpine              |
| Postgres (payments)   | Docker container (separate DB) | postgres:16-alpine              |
| RabbitMQ              | Docker container               | rabbitmq:3.13-management-alpine |
| MinIO (S3-compatible) | Docker container               | minio/minio:latest              |

### Container images

- Built via GitHub Actions, pushed to GHCR (`ghcr.io/<owner>/rd_shop/<app>:sha-<commit>`)
- Multi-stage Dockerfile: distroless production images (`gcr.io/distroless/nodejs24-debian12:nonroot`)
- Non-root user (UID 1001), tini init, source maps stripped

### Deploy flow

```
PR → development branch
  → build-and-push.yml (GHCR push, release-manifest artifact)
    → deploy-stage.yml (auto, SSH → VM, env decode, docker compose up)
      → deploy-production.yml (manual dispatch, approval gate, SSH → VM)
```

### Secrets delivery

GitHub environment secrets (base64-encoded `.env` files) → SSH → VM filesystem → compose `env_file` mount → container env vars. No external secrets manager.

### Networking

Docker Compose networks (local dev workaround used in "production"):

- `shop-network` — external-facing
- `shop-network-internal` — shop ↔ postgres ↔ rabbitmq
- `payments-network-internal` — payments ↔ postgres
- `rd_shop_backend_prod_shared` — shop ↔ payments (gRPC bridge)

### Health checks

- `GET /health` — liveness (process alive)
- `GET /ready` — readiness (postgres + rabbitmq + minio)
- `GET /status` — full (includes payments gRPC ping, soft dependency)

---

## Compute Platform Comparison

> **Constraint:** AWS Free Tier — only `t2.micro` and `t3.micro` instances available. Fargate and EKS are not in the free tier.

### Option A — Elastic Beanstalk (Docker on EC2)

| Aspect               | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**       | PaaS layer on top of EC2. Manages ALB, auto-scaling, health monitoring, deployments.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Deployment model** | Upload Docker image or `Dockerrun.aws.json`; EB provisions EC2 + ALB automatically.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Free tier**        | ✅ Uses t2.micro/t3.micro EC2 underneath — eligible for free tier EC2 hours.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Pros**             | Lowest learning curve. Built-in rolling/blue-green deploys. Managed ALB, auto-scaling, monitoring. HTTPS via ACM out of the box. Worker tier for background jobs. Single-container or multi-container Docker support.                                                                                                                                                                                                                                                                                                       |
| **Cons**             | **One application per environment** — two services (shop + payments) = two EB environments = two ALBs (wasteful for payments which is internal-only gRPC). gRPC requires manual ALB target group configuration via `.ebextensions` — EB abstracts this away poorly. No native service discovery for shop→payments; requires Cloud Map or hardcoded private IPs. Multi-container Docker mode (ECS on EB) adds complexity without benefit at this scale. Config via `.ebextensions` and platform hooks can be opaque/brittle. |
| **Fit for rd_shop**  | **Acceptable for shop only.** EB handles the shop service well (HTTP, ALB, health checks). But the payments gRPC service on a second EB environment is awkward and wasteful (second ALB for an internal-only service).                                                                                                                                                                                                                                                                                                      |

### Option B — ECS on EC2 ✅ Recommended

| Aspect               | Assessment                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**       | Container orchestrator on self-managed EC2 instances. Full control over instance types, task placement, networking.                                                                                                                                                                                                                           |
| **Deployment model** | ECS task definitions reference ECR images. ECS services manage desired count, rolling updates, ALB target group registration.                                                                                                                                                                                                                 |
| **Free tier**        | ✅ ECS itself is free — you only pay for the underlying EC2 instances. t3.micro eligible.                                                                                                                                                                                                                                                     |
| **Pros**             | **Both services on one instance** — shop + payments run as two ECS tasks on a single t3.micro (1 vCPU, 1GB RAM), sharing resources. Native service discovery via Cloud Map (payments reachable by DNS). ALB integration for shop with health checks. IAM task roles for per-service permissions. Full docker exec / SSH access for debugging. |
| **Cons**             | You manage the EC2 instance: ECS-optimized AMI updates, instance draining on deploys. Single t3.micro is a SPOF (no auto-scaling / multi-AZ on free tier). Memory is tight — 1GB shared between ECS agent (~50MB), shop (~300-400MB), payments (~200MB). Rolling deploys need headroom (may need to stop old task before starting new).       |
| **Fit for rd_shop**  | **Best fit given free tier constraint.** Both containers fit on one t3.micro. ECS handles multi-service orchestration natively. Cloud Map provides service discovery for gRPC. Upgrade path to Fargate or larger instances when budget allows (same task definitions, just change capacity provider).                                         |

### Option C — Hybrid (EB for shop + ECS on EC2 for payments)

| Aspect              | Assessment                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **What it is**      | EB manages the shop web tier; payments runs as a standalone ECS service on a separate EC2 instance.                                                                                                                                                                |
| **Free tier**       | ⚠️ Two t3.micro instances — only 750 hours/month free (both instances combined), so effectively free for ~15 hours/day or paid for 24/7.                                                                                                                           |
| **Pros**            | EB gives shop zero-config deploy + managed ALB. Payments gets ECS native service discovery. Clean separation of concerns.                                                                                                                                          |
| **Cons**            | **Two instances for two lightweight services** — wasteful. Double the AMI management. Cross-instance networking adds complexity (need shared VPC, security groups, Cloud Map). EB for shop + Cloud Map for payments = two different deployment models to maintain. |
| **Fit for rd_shop** | **Poor.** Added complexity without benefit. If both services fit on one instance, splitting them across two doubles operational overhead and potentially costs.                                                                                                    |

### Decision: ECS on EC2 (single t3.micro)

ECS on EC2 is the only option that runs both services on one free-tier-eligible instance with native container orchestration. The trade-off is EC2 management overhead (AMI, patching), but for a single instance this is minimal. Task definitions are portable — migrating to Fargate later requires only changing the capacity provider, zero task definition changes.

#### Instance sizing (t3.micro — 1 vCPU, 1GB RAM)

| Component     | CPU           | Memory  | Notes                                                       |
| ------------- | ------------- | ------- | ----------------------------------------------------------- |
| ECS Agent     | —             | ~50MB   | Managed by ECS-optimized AMI                                |
| Shop task     | 384 CPU units | 400MB   | Includes HTTP + GraphQL + RabbitMQ consumer                 |
| Payments task | 128 CPU units | 300MB   | gRPC server, lightweight                                    |
| OS + buffer   | —             | ~274MB  | Kernel + headroom                                           |
| **Total**     | 512 / 1024    | ~1024MB | Fits, but no room for concurrent deploy (stop-before-start) |

**Deploy strategy:** `minimumHealthyPercent: 0`, `maximumPercent: 100` — ECS stops the old task before starting the new one (brief downtime during deploys, acceptable for staging). For production (post-free-tier): switch to `minimumHealthyPercent: 100`, `maximumPercent: 200` on larger instances.

---

## IaC Evaluation: Pulumi

### What it is

Infrastructure as Code using real programming languages (TypeScript, Python, Go, etc.) instead of DSLs (HCL, YAML). State managed by Pulumi Cloud (SaaS) or self-hosted backend (S3 + DynamoDB).

### Fit for rd_shop

| Aspect                    | Assessment                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Language**              | TypeScript — same language as the application code. No context-switching to HCL. Team already knows TypeScript.               |
| **Type safety**           | Full IDE autocomplete, compile-time errors for invalid resource configurations. Catches misconfigurations before `pulumi up`. |
| **AWS support**           | First-class `@pulumi/aws` provider + higher-level `@pulumi/awsx` (ECS patterns, VPC, ALB — abstracts boilerplate).            |
| **ECS patterns**          | `awsx.ecs.EC2Service` / `awsx.ecs.FargateService` creates task definition + service + ALB target group in ~20 lines of code.  |
| **Testing**               | Unit tests with Jest (same test framework as the app). Policy tests for compliance.                                           |
| **State management**      | Pulumi Cloud free tier covers individual use. Alternatively, self-managed S3 backend.                                         |
| **Learning curve**        | Lower than Terraform for TypeScript developers. Higher than CDK if coming from AWS-only background.                           |
| **Community / ecosystem** | Smaller than Terraform but growing. All AWS resources available.                                                              |
| **CI/CD integration**     | `pulumi up --yes` in GitHub Actions. Preview on PR, deploy on merge.                                                          |
| **Monorepo placement**    | `infra/` directory at repo root, separate `tsconfig.json`, shared types possible with `libs/common`.                          |

### Pulumi vs. alternatives

| Tool          | Language            | AWS Coverage                  | Fit                                                                         |
| ------------- | ------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| **Pulumi**    | TypeScript (native) | Full                          | ✅ Best — same language, type-safe, testable                                |
| **Terraform** | HCL (DSL)           | Full                          | Good — industry standard, but HCL is a new language to learn                |
| **AWS CDK**   | TypeScript          | Full                          | Good — but tightly coupled to CloudFormation (slower deploys, stack limits) |
| **SST**       | TypeScript          | Partial (focus on serverless) | Poor — optimized for Lambda/serverless, not ECS/Fargate                     |

### Recommendation: Pulumi ✅

Pulumi is a strong fit. TypeScript IaC means the entire team can contribute to infrastructure without learning a new language. The `@pulumi/awsx` ECS patterns significantly reduce boilerplate for the Fargate setup.

---

## Target Architecture

```
                    Internet
                       │
                   Route 53
                       │
                  ┌────▼────┐
                  │   ALB   │ ← ACM cert (TLS termination)
                  │ (public)│ ← HTTP→HTTPS redirect
                  └─┬────┬──┘
                    │    │
         ┌──────────┘    └──────────┐
         ▼                          ▼
   ┌───────────┐            ┌──────────────┐
   │   Shop    │            │  CloudFront   │
   │(ECS on EC2│            │  (S3 public   │
   │  t3.micro)│            │   images)     │
   │  Port 8080│            └──────────────┘
   └─────┬─────┘
         │ Cloud Map DNS (payments.local)
         ▼
   ┌───────────┐
   │ Payments  │
   │(ECS task, │
   │ same EC2) │
   │ Port 5001 │ (gRPC, internal only)
   └───────────┘

   Shop connects to:
   ├── RDS Postgres (shop DB)
   ├── AmazonMQ / SQS (message queue)
   ├── S3 (file storage)
   ├── SES (email)
   └── Secrets Manager (runtime secrets)

   Payments connects to:
   ├── RDS Postgres (payments DB)
   └── Secrets Manager (runtime secrets)
```

---

## AWS Service Mapping

| Current (VM/Docker)         | AWS Target                            | Notes                                                                |
| --------------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| Docker Compose (shop)       | ECS service (EC2 t3.micro)            | ALB target, ECS task                                                 |
| Docker Compose (payments)   | ECS service (same EC2)                | No ALB, Cloud Map service discovery                                  |
| Postgres 16 (shop)          | RDS PostgreSQL 16                     | Multi-AZ option, automated backups                                   |
| Postgres 16 (payments)      | RDS PostgreSQL 16                     | Separate instance, private subnet                                    |
| RabbitMQ 3.13               | AmazonMQ (RabbitMQ engine) or SQS     | See Phase 3 decision                                                 |
| MinIO (S3)                  | S3                                    | Already using AWS SDK; swap endpoint                                 |
| GHCR                        | ECR                                   | Native ECS integration, no PAT needed                                |
| .env files (base64 via SSH) | Secrets Manager + SSM Parameter Store | Task-level IAM, no env files on disk                                 |
| Docker networks             | VPC + security groups                 | Private/public subnets, NACLs                                        |
| SSH deploy                  | ECS service update (GitHub Actions)   | `aws ecs update-service --force-new-deployment`                      |
| VM health checks            | ALB health checks + ECS health checks | `/health` for liveness, `/ready` for ALB target                      |
| No TLS                      | ACM + ALB HTTPS listener              | Free certs, auto-renewal                                             |
| No CDN                      | CloudFront                            | **Public image URLs** — replaces per-request presigned download URLs |

---

## Prerequisites

**do NOT manually create any AWS services** (ECS, RDS, S3, etc.) — that's Pulumi's entire job. You only do a small set of **one-time manual bootstrapping** that IaC tools can't provision for themselves.

## What you do manually (one-time, ~30 min)

### 1. Stop using root user — create IAM identities

Root user should only be used for billing and account-level settings. You need two IAM identities:

| Identity                              | Purpose                                                                  | How to create                                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IAM user: `admin`**                 | Your personal console + CLI access. Day-to-day AWS work.                 | IAM → Users → Create. Attach `AdministratorAccess` policy. Enable MFA. Generate access key (for `aws configure` on your machine).                                                                                                       |
| **IAM role: `github-actions-deploy`** | CI/CD deploys via GitHub Actions. No static keys — uses OIDC federation. | IAM → Identity providers → Add `token.actions.githubusercontent.com`. Then create IAM role trusting that provider, scoped to your repo. Attach a custom policy with ECS, ECR, S3, Secrets Manager, CloudFormation (Pulumi) permissions. |

**Why OIDC instead of a second IAM user for CI?** Static access keys for CI are a security risk (rotated never, stored in GH secrets, leaked in logs). OIDC federation gives GitHub Actions a short-lived token per workflow run — no keys to leak.

```
# After creating admin user, configure locally:
aws configure --profile rd-shop
# → Access Key ID: <from IAM>
# → Secret Access Key: <from IAM>
# → Region: eu-central-1 (or your choice)
# → Output: json
```

### 2. Pulumi account + state backend

| Option           | Setup                                                                    | Cost                    | Recommendation                                                             |
| ---------------- | ------------------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------- |
| **Pulumi Cloud** | `pulumi login` (creates free account)                                    | Free for individual use | Best for starting — managed state, encryption, drift detection, zero setup |
| **S3 backend**   | Create S3 bucket + DynamoDB table manually, `pulumi login s3://<bucket>` | Free tier S3            | More control, but you manage state locking yourself                        |

Go with **Pulumi Cloud** — it's free and eliminates state management as a concern. You can migrate to S3 backend later if needed.

```
npm install -g @pulumi/pulumi
pulumi login  # browser opens, sign up with GitHub
```

### 3. Lock down root user

After creating the `admin` IAM user:

- Enable MFA on root
- Delete root access keys (if any exist)
- Only use root for: billing, account closure, support plan changes

## What Pulumi handles (do NOT create manually)

Everything in Phases 0-4 of the plan is code:

```
pulumi new aws-typescript    # scaffolds infra/ project
pulumi up                    # creates ALL of these:
```

- VPC, subnets, route tables, NAT instance
- Security groups
- ECR repositories
- RDS instances (both)
- S3 bucket + CloudFront distribution
- Secrets Manager secrets
- AmazonMQ broker
- ECS cluster, EC2 capacity provider, launch template, instance profile
- ECS task definitions, services
- ALB, target groups, listeners
- Cloud Map namespace + service discovery
- Route 53 records
- IAM task roles, execution roles

If you create any of these manually, you'll have **drift** — Pulumi won't know about them, can't update/destroy them, and you'll fight conflicts.

## Summary of manual steps (in order)

```
1. AWS Console → IAM → Create admin user (MFA, AdministratorAccess)
2. AWS Console → IAM → Add GitHub OIDC identity provider
3. AWS Console → IAM → Create github-actions-deploy role (OIDC trust)
4. Local terminal → aws configure --profile rd-shop
5. Local terminal → pulumi login (creates Pulumi Cloud account)
6. Lock down root user (MFA, delete root access keys)
```

After these 6 steps, you run `pulumi up` and it creates the entire infrastructure from code. No clicking through AWS Console to create services.

## Phased Implementation

### Phase 0 — Foundation (VPC + IaC bootstrap)

> **Priority: 5 | Severity: 5 | Complexity: 3**

Everything else depends on the network foundation.

#### 0.1 Pulumi project setup

- Create `infra/` directory at repo root
- `pulumi new aws-typescript`
- Stacks: `dev`, `stage`, `production`
- State: Pulumi Cloud (free tier) or S3 backend
- Add `infra/` to GitHub Actions workflow for preview-on-PR / deploy-on-merge

#### 0.2 VPC

- 2 AZs minimum (cost-conscious; expand to 3 for production later)
- Public subnets (ALB, NAT Gateway)
- Private subnets (Fargate tasks, RDS)
- NAT Gateway (Fargate tasks need outbound internet for GHCR/ECR pulls, SES, etc.)
- NAT Gateway or **NAT instance** (t3.micro — free tier eligible, cheaper than NAT Gateway)
- VPC endpoints for S3, ECR, Secrets Manager, CloudWatch Logs (reduce NAT traffic)

#### 0.3 Security groups

| SG                | Inbound                         | Purpose                       |
| ----------------- | ------------------------------- | ----------------------------- |
| `sg-alb`          | 80, 443 from 0.0.0.0/0          | ALB public access             |
| `sg-ecs`          | 8080, 5001 from sg-alb and self | ECS EC2 instance (both tasks) |
| `sg-rds-shop`     | 5432 from sg-ecs                | Shop DB                       |
| `sg-rds-payments` | 5432 from sg-ecs                | Payments DB                   |
| `sg-mq`           | 5671 from sg-ecs                | AmazonMQ (AMQPS)              |

#### 0.4 ECR repositories

- `rd-shop/shop`
- `rd-shop/payments`
- Lifecycle policy: retain last 20 images, expire untagged after 7 days

---

### Phase 1 — Data Layer (RDS + S3 + Secrets Manager)

> **Priority: 5 | Severity: 5 | Complexity: 3**

Provision managed data stores before migrating compute. This allows testing data connectivity independently.

#### 1.1 RDS PostgreSQL

- **Engine:** PostgreSQL 16 (matches current Docker image)
- **Two instances:** `rd-shop-db` (shop) and `rd-payments-db` (payments)
- **Instance class:** `db.t4g.micro` (stage) / `db.t4g.small` (production) — ARM-based, cost-effective
- **Storage:** 20GB gp3, auto-scaling enabled
- **Multi-AZ:** off for stage, on for production
- **Automated backups:** 7-day retention
- **SSL enforcement:** `rds.force_ssl = 1` parameter group
- **Subnet group:** private subnets only
- **Security group:** port 5432, inbound from respective Fargate SG only
- **Connection:** `DATABASE_URL=postgresql://<user>:<pass>@<rds-endpoint>:5432/<db>?sslmode=require`

#### 1.2 S3 + CloudFront (public image URLs)

- Keep existing bucket (`rd-shop-files-private`) or create new per environment
- Remove `AWS_S3_ENDPOINT` / `AWS_S3_FORCE_PATH_STYLE` (MinIO workarounds)
- Bucket policy: private, CloudFront OAC (Origin Access Control) for public reads
- CORS on bucket for presigned upload from browser

**CloudFront distribution** for product images and user avatars:

- Origin: S3 bucket, OAC-restricted
- Cache behavior: `products/*`, `users/*/avatars/*` → cache 24h (images are immutable — new upload = new S3 key)
- HTTPS only (ACM cert or CloudFront default cert)
- `AWS_CLOUDFRONT_URL` env var already exists in app config

**Presigned URL rework — switch to public CloudFront URLs for reads:**

Currently, every GET request for a user avatar or product image generates a per-request S3 presigned download URL (via `GetObjectCommand` + `getSignedUrl`, TTL 3600s). This means:

- Every `GET /users/me`, `GET /products/:id`, and every GraphQL product query hits S3's signing endpoint
- URLs are uncacheable (each has unique signature + expiry)
- No CDN benefit — presigned URLs point directly to S3, bypassing CloudFront

**Target:** replace presigned download URLs with **static CloudFront public URLs** for all product images and user avatars.

| Component                                 | Current                                                                   | Target                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `S3Service.getPresignedDownloadUrl()`     | Signs `GetObjectCommand` per request                                      | **Retain** — still needed for private/non-image files       |
| `S3Service.getPublicUrl()`                | Returns CloudFront URL (if `AWS_CLOUDFRONT_URL` set) or S3 path-style URL | **Use this** for all READY product images and avatars       |
| `FilesService.getPresignedUrlForFileId()` | Always calls `getPresignedDownloadUrl()`                                  | Change to call `getPublicUrl()` for public-visibility files |
| `UsersService.resolveAvatarUrl()`         | Calls `getPresignedUrlForFileId()` → presigned URL                        | Returns `getPublicUrl()` → static CloudFront URL            |
| `ProductsService.resolveFileUrl()`        | Calls `getPresignedDownloadUrl()` → presigned URL                         | Returns `getPublicUrl()` → static CloudFront URL            |
| `ProductsService.resolveMainImageUrl()`   | Same as above                                                             | Same change                                                 |

**Code changes required:**

1. **`FilesService`** — add `getPublicUrlForFileId(fileId)` method that calls `S3Service.getPublicUrl(key)` instead of `getPresignedDownloadUrl(key)`. Only for `FileStatus.READY` files (same guard).
2. **`UsersService.resolveAvatarUrl()`** — call `filesService.getPublicUrlForFileId()` instead of `getPresignedUrlForFileId()`
3. **`ProductsService.resolveFileUrl()` + `resolveMainImageUrl()`** — call `s3Service.getPublicUrl(key)` instead of `getPresignedDownloadUrl(key)`
4. **`S3Service.getPublicUrl()`** already exists and already prefers CloudFront URL when `AWS_CLOUDFRONT_URL` is set → no changes needed in S3Service
5. **Keep `getPresignedDownloadUrl()`** — still needed for private file downloads or future non-image file types
6. **FileRecord visibility** — consider setting `visibility = PUBLIC` on product images and avatars during `completeUpload()` to distinguish from private files

**Benefits:**

- Zero S3 API calls for image reads (pure URL construction)
- CloudFront caches at edge — lower latency globally
- URLs are stable/cacheable by browsers and CDN
- Reduces S3 GET request costs

#### 1.3 Secrets Manager

- **Shop secrets:** `rd-shop/shop/stage`, `rd-shop/shop/production`
- **Payments secrets:** `rd-shop/payments/stage`, `rd-shop/payments/production`
- JSON secret containing all current `.env` values
- ECS task definition references secrets as `valueFrom: <secret-arn>:<json-key>::`
- IAM task execution role: `secretsmanager:GetSecretValue` on specific ARNs only
- **Replaces:** base64 env files in GitHub Secrets, SSH delivery, `.env.production` on VM

#### 1.4 SSM Parameter Store (non-secret config)

- Non-sensitive config (`PORT`, `NODE_ENV`, `APP_LOG_LEVEL`, `CORS_ALLOWED_ORIGINS`, etc.)
- Free tier, no per-secret cost
- Separate from Secrets Manager to allow different access policies

#### 1.5 Data migration

- `pg_dump` from VM Postgres → `pg_restore` to RDS (or use AWS DMS for zero-downtime)
- S3: `aws s3 sync` from MinIO bucket to S3 (if MinIO was used in production)

---

### Phase 2 — Compute (ECS on EC2 + ALB)

> **Priority: 5 | Severity: 5 | Complexity: 4**

#### 2.1 ECR migration

- Update `build-and-push.yml` to push to ECR instead of (or in addition to) GHCR
- Use `aws-actions/amazon-ecr-login@v2` + `docker/build-push-action`
- Tag strategy: keep `sha-<commit>` + `latest` per branch
- Remove GHCR PAT from GitHub secrets (use OIDC federation for ECR auth)

#### 2.2 ECS cluster + EC2 capacity

- One cluster per environment: `rd-shop-stage`, `rd-shop-production`
- **EC2 capacity provider** (not Fargate — free tier constraint)
- EC2 instance: `t3.micro` (1 vCPU, 1GB RAM) — free tier eligible
- AMI: ECS-optimized Amazon Linux 2023 (managed by AWS, auto-updated via launch template)
- Instance profile: IAM role with `AmazonEC2ContainerServiceforEC2Role` + ECR pull + CloudWatch Logs
- User data: `echo ECS_CLUSTER=rd-shop-stage >> /etc/ecs/ecs.config`
- Key pair: for SSH debugging (optional, can use ECS Exec instead)
- Placement: private subnet (outbound via NAT instance)
- Container Insights enabled

#### 2.3 Shop service

**Task definition:**

- Image: `<account>.dkr.ecr.<region>.amazonaws.com/rd-shop/shop:sha-<commit>`
- CPU: 384 units, Memory: 400 MB (hard limit)
- Network mode: `bridge` (both tasks share host network stack via dynamic port mapping)
- Port mapping: host 0 → container 8080 (ALB uses dynamic port via target group)
- Health check: `CMD-SHELL, curl -f http://localhost:8080/health || exit 1` (interval 30s, timeout 5s, retries 3)
- Secrets: from Secrets Manager ARN
- Environment: from SSM Parameter Store
- Log driver: `awslogs` → CloudWatch log group `/ecs/rd-shop/shop`
- Task role: S3 read/write, SES send
- Task execution role: ECR pull, Secrets Manager read, CloudWatch Logs write

**Service:**

- Desired count: 1
- ALB target group: HTTP, dynamic port, health check path `/ready`
- Deployment: `minimumHealthyPercent: 0`, `maximumPercent: 100` (stop-before-start on t3.micro due to memory constraint)
- Auto-scaling: disabled on free tier (single instance)

#### 2.4 Payments service

**Task definition:**

- Image: `<account>.dkr.ecr.<region>.amazonaws.com/rd-shop/payments:sha-<commit>`
- CPU: 128 units, Memory: 300 MB (hard limit)
- Network mode: `bridge`
- Port mapping: host 5001 → container 5001 (static — only shop talks to it, via Cloud Map)
- Health check: TCP 5001 or custom gRPC health check
- Secrets: from Secrets Manager ARN
- Log driver: `awslogs` → `/ecs/rd-shop/payments`
- Task role: Secrets Manager read

**Service:**

- Desired count: 1
- **No ALB** — internal only
- Cloud Map service discovery: `payments.rd-shop.local` → private DNS namespace → EC2 instance private IP + port 5001
- Shop connects via: `PAYMENTS_GRPC_HOST=payments.rd-shop.local`

#### 2.5 ALB

- **Public ALB** in public subnets
- HTTPS listener (443): ACM certificate, TLS 1.2 minimum
- HTTP listener (80): redirect to HTTPS
- Target group: shop ECS service, dynamic port, health check `/ready`
- Access logs → S3 bucket

> **Free tier note:** ALB is not free tier eligible (~$20/mo). Alternative: use the EC2 instance's public IP directly (no TLS, no health-check-based routing). Not recommended for production, but acceptable for a budget staging setup. Can be added later when budget allows.

#### 2.6 Route 53

- Hosted zone for domain
- A record (alias) → ALB (or A record → EC2 Elastic IP if no ALB)
- ACM DNS validation record

#### 2.7 Future: Fargate migration path

When budget allows, migrate from EC2 to Fargate:

- Same task definitions — change only the capacity provider
- Switch network mode from `bridge` to `awsvpc` (Fargate requirement)
- Switch deploy strategy to `minimumHealthyPercent: 100`, `maximumPercent: 200`
- Remove EC2 instance, launch template, instance profile, AMI management
- Everything else (ALB, Cloud Map, task roles, secrets) stays identical

---

### Phase 3 — Message Queue

> **Priority: 4 | Severity: 4 | Complexity: 2**

#### Decision: AmazonMQ vs. SQS

| Criteria                   | AmazonMQ (RabbitMQ engine)                                                   | SQS + SNS                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Protocol compatibility** | Drop-in — AMQP 0.9.1, same `amqplib` client                                  | Requires rewrite — HTTP-based SDK, different API                                           |
| **Code changes**           | Near zero — swap hostname + enable TLS                                       | Significant — replace `RabbitMQService`, change consumer pattern, no channel/ack semantics |
| **Features**               | Exchanges, routing keys, DLQ, TTL, priority, manual ack — all currently used | FIFO queues, DLQ, visibility timeout. No exchanges/routing. Different retry model.         |
| **Management UI**          | RabbitMQ management console (already familiar)                               | AWS Console / CloudWatch                                                                   |
| **Cost**                   | ~$30/mo minimum (mq.t3.micro single-broker)                                  | Pay-per-request (~$0.40/million). Cheaper at low volume.                                   |
| **Operational overhead**   | AWS manages broker, but you manage vhost/user/permissions                    | Fully managed, zero ops                                                                    |
| **Migration effort**       | **Low** — change `RABBITMQ_HOST`, enable AMQPS (port 5671)                   | **High** — rewrite queue module, change DLQ/retry logic, integration tests                 |

**Recommendation:** AmazonMQ (RabbitMQ) for migration. Evaluate SQS as a future optimization if queue costs or operational overhead become a concern. The codebase uses AMQP features (manual ack, DLQ routing, channel prefetch) that don't have direct SQS equivalents.

#### AmazonMQ setup

- Broker type: `rabbitmq`, version 3.13
- Instance: `mq.t3.micro` (stage) / `mq.m5.large` (production)
- Single-broker (stage) / active-standby (production)
- Private subnet, security group allows 5671 from sg-shop
- AMQPS (TLS) endpoint only — no plaintext AMQP
- Env change: `RABBITMQ_HOST=<broker-id>.mq.<region>.amazonaws.com`, `RABBITMQ_PORT=5671`

---

### Phase 4 — CI/CD Pipeline Update

> **Priority: 4 | Severity: 4 | Complexity: 3**

#### 4.1 GitHub Actions OIDC federation

- Replace long-lived AWS credentials with OIDC identity provider
- GitHub Actions assumes IAM role per environment (stage / production)
- No AWS access keys stored in GitHub secrets

#### 4.2 Updated deploy flow

```
PR → development
  → pr-checks.yml (unchanged: lint, test, integration, docker preview)

Push → development
  → build-and-push.yml
    ├── Build + push to ECR (replace GHCR)
    └── Release manifest artifact (unchanged)

  → deploy-stage.yml
    ├── Assume stage IAM role (OIDC)
    ├── pulumi up --stack stage (if infra changes)
    ├── aws ecs update-service --force-new-deployment (shop + payments)
    ├── aws ecs wait services-stable
    └── Smoke test (curl ALB /health → /ready → /status)

Manual dispatch → deploy-production.yml
    ├── Approval gate (GitHub Environment)
    ├── Assume production IAM role (OIDC)
    ├── pulumi up --stack production (if infra changes)
    ├── aws ecs update-service --force-new-deployment
    ├── aws ecs wait services-stable
    └── Smoke test
```

#### 4.3 Remove VM deployment artifacts

- Delete `deploy-to-stage` and `deploy-to-production` composite actions (SSH-based)
- Remove `SSH_PRIVATE_KEY`, `ENV_FILE_SHOP`, `ENV_FILE_PAYMENTS`, `GHCR_TOKEN` from GitHub secrets
- Remove `SSH_HOST`, `SSH_USER`, `DEPLOY_DIR` from GitHub variables
- Replace with: IAM role ARN, ECR registry URL, ECS cluster/service names

#### 4.4 Pulumi CI/CD

- PR: `pulumi preview` — shows planned infra changes as PR comment
- Merge to development: `pulumi up --stack stage --yes`
- Production: `pulumi up --stack production --yes` (after approval)

---

### Phase 5 — Observability & Security (post-migration)

> **Priority: 3 | Severity: 3 | Complexity: 2**

Items that become available or mandatory after AWS migration.

#### 5.1 CloudWatch integration

- ECS container logs already flow to CloudWatch via `awslogs` driver
- Set up log retention policies (30 days stage, 90 days production)
- CloudWatch Alarms: high CPU, high memory, 5xx rate, unhealthy targets
- Container Insights dashboards

#### 5.2 Secrets rotation

- RDS: Secrets Manager native rotation (Lambda-based, automatic)
- JWT signing secret: custom rotation Lambda with dual-key verification window
- AWS credentials: IAM task roles (no static keys — no rotation needed)

#### 5.3 TLS everywhere

- ALB → HTTPS (ACM cert, auto-renewal)
- RDS → SSL enforced via parameter group
- AmazonMQ → AMQPS only
- S3 → HTTPS (AWS SDK default)
- CloudFront → HTTPS + custom domain cert
- gRPC inter-service → same EC2 instance (localhost in bridge mode); VPC placement trust for cross-instance

#### 5.4 Audit log migration (optional)

- Swap `AuditLogService` backing store from DB table to CloudWatch Logs
- Security hardening plan designed the interface to be storage-agnostic (repository pattern)

---

## Environment Variables — Migration Mapping

| Current Env Var                                         | AWS Equivalent                                               | Source              |
| ------------------------------------------------------- | ------------------------------------------------------------ | ------------------- |
| `DATABASE_URL`                                          | RDS endpoint (composed from Secrets Manager JSON)            | Secrets Manager     |
| `DATABASE_HOST` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | RDS credentials                                              | Secrets Manager     |
| `JWT_ACCESS_SECRET`                                     | Application secret                                           | Secrets Manager     |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`           | **Removed** — use IAM task role                              | Task role           |
| `AWS_S3_ENDPOINT`                                       | **Removed** — use default S3 endpoint                        | N/A                 |
| `AWS_S3_FORCE_PATH_STYLE`                               | **Removed** — MinIO workaround                               | N/A                 |
| `AWS_S3_PUBLIC_ENDPOINT`                                | **Removed** — CloudFront URL replaces this for public images | N/A                 |
| `AWS_CLOUDFRONT_URL`                                    | CloudFront distribution URL                                  | SSM Parameter Store |
| `RABBITMQ_HOST`                                         | AmazonMQ broker endpoint                                     | SSM Parameter Store |
| `RABBITMQ_PORT`                                         | `5671` (AMQPS)                                               | SSM Parameter Store |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD`                   | AmazonMQ credentials                                         | Secrets Manager     |
| `PAYMENTS_GRPC_HOST`                                    | `payments.rd-shop.local` (Cloud Map)                         | SSM Parameter Store |
| `CORS_ALLOWED_ORIGINS`                                  | Production domain                                            | SSM Parameter Store |
| `APP_URL`                                               | `https://api.yourdomain.com`                                 | SSM Parameter Store |
| `PORT`, `NODE_ENV`, `APP_LOG_LEVEL`                     | Static config                                                | SSM Parameter Store |

### Application code changes required

| Change                                                        | Scope                                             | Reason                                                       |
| ------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| Remove `AWS_S3_ENDPOINT` / `AWS_S3_FORCE_PATH_STYLE` fallback | `S3Service`                                       | No MinIO in AWS; default S3 endpoint works                   |
| Switch image reads to `getPublicUrl()` (CloudFront)           | `FilesService`, `UsersService`, `ProductsService` | Eliminate per-request S3 presigned URLs for public images    |
| Support `AMQPS` (port 5671 + TLS)                             | `RabbitMQService`                                 | AmazonMQ requires TLS                                        |
| IAM credential chain (remove static keys)                     | `S3Service`, `MailService`                        | ECS task role provides credentials via EC2 instance metadata |
| Remove `MINIO_PORT` / `MINIO_CONSOLE_PORT` env vars           | env schema                                        | No MinIO                                                     |

---

## Cost Estimate (Stage Environment — Free Tier Optimized)

| Service                    | Spec                          | ~Monthly Cost | Free Tier?                  |
| -------------------------- | ----------------------------- | ------------- | --------------------------- |
| EC2 (ECS host)             | t3.micro, 24/7                | ~$0\*         | ✅ 750 hrs/mo for 12 months |
| ECS                        | Orchestration                 | $0            | ✅ Always free              |
| RDS (shop)                 | db.t3.micro, 20GB, single-AZ  | ~$0\*         | ✅ 750 hrs/mo for 12 months |
| RDS (payments)             | db.t3.micro, 20GB, single-AZ  | ~$0–15\*\*    | ✅ Shares 750 hrs with shop |
| AmazonMQ                   | mq.t3.micro, single-broker    | ~$30          | ❌                          |
| ALB                        | 1 ALB + minimal LCUs          | ~$20          | ❌                          |
| NAT instance               | t3.micro (fck-nat AMI)        | ~$0\*         | ✅ Shares 750 hrs pool      |
| S3                         | 5GB storage, minimal requests | ~$0           | ✅ 5GB for 12 months        |
| CloudFront                 | Minimal traffic               | ~$0           | ✅ 1TB/mo for 12 months     |
| Secrets Manager            | ~10 secrets                   | ~$4           | ❌                          |
| CloudWatch Logs            | Minimal ingestion             | ~$0           | ✅ 5GB ingestion/mo         |
| ECR                        | Image storage (500MB)         | ~$0           | ✅ 500MB/mo for 12 months   |
| **Total (year 1)**         |                               | **~$54/mo**   |                             |
| **Total (post-free-tier)** |                               | **~$105/mo**  |                             |

\* Free tier covers 750 EC2 hours/month total across all t3.micro/t2.micro instances.
\*\* Two RDS instances share the 750 hours. If both run 24/7 (1488 hrs), ~738 hrs are paid. Consider using a single RDS instance with two databases as a cost optimization (trade isolation for savings).

> **Cost optimization notes:**
>
> - **NAT instance** (`fck-nat` AMI on t3.micro) replaces NAT Gateway, saving ~$35/mo. Trade-off: single AZ, you manage the instance, but free tier eligible.
> - **Single RDS instance** with two databases (shop + payments) saves ~$15/mo post-free-tier. Trade-off: shared resource limits, no separate scaling. Acceptable for staging.
> - **ALB** is the largest unavoidable cost. Could skip initially and use EC2 public IP + Route 53, but loses TLS termination and health-check routing.

---

## Migration Sequence (suggested)

```
Phase 0 (Foundation)     ──── Pulumi project + VPC + security groups + ECR
     │
Phase 1 (Data)           ──── RDS + S3 + Secrets Manager
     │                        Data migration (pg_dump → RDS)
     │
Phase 2 (Compute)        ──── ECS on EC2 (t3.micro) + ALB + Cloud Map
     │                        Shop + Payments on single instance
     │                        Smoke test against ALB endpoint
     │
Phase 3 (Queue)          ──── AmazonMQ provisioning
     │                        Point shop to AmazonMQ AMQPS endpoint
     │
Phase 4 (CI/CD)          ──── GitHub Actions OIDC + ECR push + ECS deploy
     │                        Remove SSH/VM deploy artifacts
     │
Phase 5 (Hardening)      ──── CloudWatch alarms, secrets rotation, audit log migration
     │
DNS cutover              ──── Route 53 → ALB
VM decommission          ──── After monitoring period
```

---

## Risks & Mitigations

| Risk                                | Impact | Mitigation                                                                                                                                     |
| ----------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Data loss during migration          | High   | pg_dump + restore in maintenance window; verify row counts + checksums before cutover                                                          |
| AmazonMQ AMQP compatibility         | Medium | Test with `amqplib` against AmazonMQ staging broker before cutover; AMQPS (TLS) may need connection string change                              |
| gRPC over Cloud Map latency         | Low    | Cloud Map DNS resolution adds ~1ms; within PAYMENTS_GRPC_TIMEOUT_MS (5000ms) budget                                                            |
| t3.micro memory pressure            | Medium | Monitor ECS memory utilization; if both tasks OOM, reduce memory limits or upgrade to t3.small                                                 |
| Deploy downtime (stop-before-start) | Medium | Acceptable for staging. For production: upgrade to larger instance or Fargate for zero-downtime rolling deploys                                |
| NAT instance SPOF                   | Low    | Single AZ NAT instance; if it fails, outbound traffic stops. Use VPC endpoints for critical services (S3, ECR, Secrets Manager) as backup path |
| Free tier expiration (12 months)    | Medium | Budget for ~$105/mo post-free-tier; evaluate Fargate Savings Plans or Reserved Instances at that point                                         |
| Pulumi state corruption             | Medium | Use Pulumi Cloud (managed state) or S3 + DynamoDB locking; CI/CD serializes deploys                                                            |

---

## Cross-references

- Security hardening (TLS, secrets rotation deferred items): `docs/backend/requirements/security-hardening-plan.md` Parts 2, 3, 5
- Current Docker setup: `docs/backend/architecture/infra-docker-compose.md`
- Current CI/CD: `docs/backend/architecture/infra-ci-pipeline.md`
- Observability plan (Pino, metrics): `docs/backend/requirements/observability-plan.md`
- Payments plan (Capture/Refund): `docs/backend/requirements/payments-plan.md`
