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

**Deploy strategy:** `minimumHealthyPercent: 0`, `maximumPercent: 100` — ECS stops the old task before starting the new one. This means brief downtime during deployments in both stage and production today. That trade-off is intentional: current AWS free-tier budget keeps the platform on a single t3.micro with no spare capacity for overlapping old/new tasks, and the goal is to keep the setup simple and cheap rather than optimize for zero-downtime rollouts yet. Zero-downtime deployment is deferred until budget allows larger or multiple ECS hosts, at which point production should switch to `minimumHealthyPercent: 100`, `maximumPercent: 200` and run old/new tasks side by side.

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
| **ECS patterns**          | `@pulumi/aws` + `@pulumi/awsx` cover ECS on EC2, VPC, ALB, and IAM with good TypeScript ergonomics.                           |
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
| **SST**       | TypeScript          | Partial (focus on serverless) | Poor — optimized for Lambda/serverless, not this ECS-on-EC2 target          |

### Recommendation: Pulumi ✅

Pulumi is a strong fit. TypeScript IaC means the entire team can contribute to infrastructure without learning a new language. The Pulumi AWS providers give enough structure for ECS on EC2 without forcing a separate DSL.

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
└────┬────┘
    │
    ▼
┌───────────┐
│   Shop    │
│(ECS on EC2│
│  t3.micro)│
│  Port 8080│
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
  ├── Dedicated RabbitMQ EC2 / SQS (message queue)
   ├── S3 (file storage)
   ├── SES (email)
   └── Secrets Manager (runtime secrets)

   Payments connects to:
   ├── RDS Postgres (payments DB)
   └── Secrets Manager (runtime secrets)
```

---

## AWS Service Mapping

| Current (VM/Docker)         | AWS Target                                  | Notes                                                                                 |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Docker Compose (shop)       | ECS service (EC2 t3.micro)                  | ALB target, ECS task                                                                  |
| Docker Compose (payments)   | ECS service (same EC2)                      | No ALB, Cloud Map service discovery                                                   |
| Postgres 16 (shop)          | RDS PostgreSQL 16                           | Multi-AZ option, automated backups                                                    |
| Postgres 16 (payments)      | RDS PostgreSQL 16                           | Separate instance, private subnet                                                     |
| RabbitMQ 3.13               | Dedicated EC2 RabbitMQ (recommended) or SQS | AmazonMQ rejected for current account/region because RabbitMQ starts at `mq.m5.large` |
| MinIO (S3)                  | S3                                          | Already using AWS SDK; swap endpoint                                                  |
| GHCR                        | ECR                                         | Native ECS integration, no PAT needed                                                 |
| .env files (base64 via SSH) | Secrets Manager + SSM Parameter Store       | Task-level IAM, no env files on disk                                                  |
| Docker networks             | VPC + security groups                       | Private/public subnets, NACLs                                                         |
| SSH deploy                  | ECS service update (GitHub Actions)         | `aws ecs update-service --force-new-deployment`                                       |
| VM health checks            | ALB health checks + ECS health checks       | `/health` for liveness, `/ready` for ALB target                                       |
| No TLS                      | ACM + ALB HTTPS listener                    | Free certs, auto-renewal                                                              |
| No CDN                      | S3 initially, CloudFront later              | Keep presigned download flow first; CDN/public URL rewrite is deferred                |

---

## Prerequisites

**do NOT manually create any AWS services** (ECS, RDS, S3, etc.) — that's Pulumi's entire job. You only do a small set of **one-time manual bootstrapping** that IaC tools can't provision for themselves.

## What you do manually (one-time, ~30 min)

### 1. Stop using root user — create IAM identities

Root user should only be used for billing and account-level settings. You need two IAM identities:

| Identity                              | Purpose                                                                  | How to create                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IAM user: `admin`**                 | Your personal console + CLI access. Day-to-day AWS work.                 | IAM → Users → Create. Attach `AdministratorAccess` policy. Enable MFA. Generate access key (for `aws configure` on your machine).                                                                                                                                                                                                                                             |
| **IAM role: `github-actions-deploy`** | CI/CD deploys via GitHub Actions. No static keys — uses OIDC federation. | IAM → Identity providers → Add `token.actions.githubusercontent.com`. Then create IAM role trusting that provider, scoped to this repo. Attach one **customer-managed policy** for ECR push + ECS deploy + Pulumi-managed AWS resources. Do **not** attach ECS runtime roles (`AmazonEC2ContainerServiceforEC2Role`, `AmazonECSTaskExecutionRolePolicy`) to this GitHub role. |

#### Exact GitHub OIDC values for this repo

- GitHub repository: `MarneusKalgar/rd_shop-backend`
- OIDC provider URL: `https://token.actions.githubusercontent.com`
- Audience / client ID: `sts.amazonaws.com`
- Bootstrap IAM role name: `github-actions-deploy`
- Allowed OIDC `sub` values for bootstrap role:
  - `repo:MarneusKalgar/rd_shop-backend:ref:refs/heads/development`
  - `repo:MarneusKalgar/rd_shop-backend:environment:stage`
  - `repo:MarneusKalgar/rd_shop-backend:environment:production`

Current workflow mapping:

- `build-and-push.yml` → `repo:MarneusKalgar/rd_shop-backend:ref:refs/heads/development`
- `deploy-stage.yml` → `repo:MarneusKalgar/rd_shop-backend:environment:stage`
- `deploy-production.yml` → `repo:MarneusKalgar/rd_shop-backend:environment:production`

#### Trust policy JSON for `github-actions-deploy`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GitHubActionsOidc",
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "ForAnyValue:StringEquals": {
          "token.actions.githubusercontent.com:sub": [
            "repo:MarneusKalgar/rd_shop-backend:ref:refs/heads/development",
            "repo:MarneusKalgar/rd_shop-backend:environment:stage",
            "repo:MarneusKalgar/rd_shop-backend:environment:production"
          ]
        }
      }
    }
  ]
}
```

#### Permission policy JSON for `github-actions-deploy`

Attach this as a **customer-managed policy** (for example: `github-actions-deploy-bootstrap`). It is intentionally broad enough for bootstrap + Pulumi-managed AWS changes. Tighten it after stage is stable. Do **not** attach ECS runtime roles (`AmazonEC2ContainerServiceforEC2Role`, `AmazonECSTaskExecutionRolePolicy`) to the GitHub Actions role.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrBootstrapAndPush",
      "Effect": "Allow",
      "Action": "ecr:*",
      "Resource": "*"
    },
    {
      "Sid": "EcsEc2AlbAndDiscoveryBootstrap",
      "Effect": "Allow",
      "Action": [
        "ecs:*",
        "ec2:*",
        "elasticloadbalancing:*",
        "autoscaling:*",
        "servicediscovery:*",
        "logs:*",
        "cloudwatch:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DataEdgeAndConfigBootstrap",
      "Effect": "Allow",
      "Action": [
        "rds:*",
        "s3:*",
        "cloudfront:*",
        "acm:*",
        "route53:*",
        "mq:*",
        "secretsmanager:*",
        "ssm:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "IamReadOnlyEnumeration",
      "Effect": "Allow",
      "Action": [
        "iam:ListRoles",
        "iam:ListPolicies",
        "iam:ListInstanceProfiles",
        "iam:GetRolePolicy",
        "iam:GetOpenIDConnectProvider",
        "iam:ListOpenIDConnectProviders"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ManageRdShopIamArtifactsOnly",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:UpdateRole",
        "iam:UpdateAssumeRolePolicy",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:CreatePolicy",
        "iam:DeletePolicy",
        "iam:GetPolicy",
        "iam:GetPolicyVersion",
        "iam:CreatePolicyVersion",
        "iam:DeletePolicyVersion",
        "iam:ListPolicyVersions",
        "iam:ListAttachedRolePolicies",
        "iam:ListRolePolicies",
        "iam:CreateInstanceProfile",
        "iam:DeleteInstanceProfile",
        "iam:GetInstanceProfile",
        "iam:TagInstanceProfile",
        "iam:UntagInstanceProfile",
        "iam:AddRoleToInstanceProfile",
        "iam:RemoveRoleFromInstanceProfile"
      ],
      "Resource": [
        "arn:aws:iam::<AWS_ACCOUNT_ID>:role/rd-shop-*",
        "arn:aws:iam::<AWS_ACCOUNT_ID>:policy/rd-shop-*",
        "arn:aws:iam::<AWS_ACCOUNT_ID>:instance-profile/rd-shop-*"
      ]
    },
    {
      "Sid": "PassRdShopRolesToEcsAndEc2Only",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": ["arn:aws:iam::<AWS_ACCOUNT_ID>:role/rd-shop-*"],
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": ["ecs-tasks.amazonaws.com", "ec2.amazonaws.com"]
        }
      }
    },
    {
      "Sid": "ReadCallerIdentity",
      "Effect": "Allow",
      "Action": ["sts:GetCallerIdentity"],
      "Resource": "*"
    }
  ]
}
```

No `cloudformation:*` permission is included above because this plan uses Pulumi's native AWS provider, not CDK / CloudFormation stacks.

Also omit `iam:CreateServiceLinkedRole` from the default bootstrap policy. If a later CI run fails on that action, add a **service-specific** statement only for the exact AWS service named in the `AccessDenied` error instead of using `Resource: "*"`.

**Additional statement required after switching Pulumi stacks to AWS KMS secrets provider**

Once `stage` / `production` stacks are re-encrypted with AWS KMS, `github-actions-deploy` also needs KMS permissions or Pulumi preview/apply in CI will fail while reading or writing stack secrets.

Add this statement to the policy attached to `github-actions-deploy` after creating the KMS keys:

```json
{
  "Sid": "UsePulumiStackSecretsKmsKeys",
  "Effect": "Allow",
  "Action": [
    "kms:Decrypt",
    "kms:DescribeKey",
    "kms:Encrypt",
    "kms:GenerateDataKey",
    "kms:GenerateDataKeyWithoutPlaintext",
    "kms:ReEncryptFrom",
    "kms:ReEncryptTo"
  ],
  "Resource": ["<STAGE_KMS_KEY_ARN>", "<PRODUCTION_KMS_KEY_ARN>"]
}
```

Tightening later:

- `github-actions-stage` should keep only `<STAGE_KMS_KEY_ARN>`
- `github-actions-production` should keep only `<PRODUCTION_KMS_KEY_ARN>`

#### Preferred hardened end state

- `github-actions-build` → trust only `repo:MarneusKalgar/rd_shop-backend:ref:refs/heads/development` and grant ECR-only permissions
- `github-actions-stage` → trust only `repo:MarneusKalgar/rd_shop-backend:environment:stage` and grant stage deploy permissions
- `github-actions-production` → trust only `repo:MarneusKalgar/rd_shop-backend:environment:production` and grant production deploy permissions

Start with one bootstrap role if you want fewer moving parts. Split roles before production hardening.

#### What to tighten later

- Replace `github-actions-deploy-bootstrap` on `github-actions-stage` / `github-actions-production` with environment-specific policies such as `github-actions-stage-deploy` and `github-actions-production-deploy`
- Keep `github-actions-build` ECR-only. Do not add ECS / RDS / IAM deploy permissions to the build role
- Make Pulumi-created IAM artifacts environment-scoped so deploy roles can narrow `iam:PassRole` and IAM management safely:
  - `rd-shop-stage-*`
  - `rd-shop-production-*`
- After first successful deploy, narrow wildcard `Resource: "*"` grants to exact environment resources where practical:
  - ECS clusters / services / task definitions
  - CloudWatch log groups
  - Secrets Manager secrets
  - SSM parameter paths
  - Dedicated RabbitMQ EC2 broker resources
  - ACM certificates
  - Route 53 hosted zone records
  - S3 buckets
- Keep exact `token.actions.githubusercontent.com:sub` values in trust policies. No branch wildcards unless you explicitly choose broader trust
- Use GitHub Environment protection rules as a second boundary for `stage` / `production` in addition to IAM trust policies

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
- S3 bucket (CloudFront can be added later if/when enabled)
- Secrets Manager secrets
- Dedicated RabbitMQ EC2 instance + EBS data volume
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

After these 6 steps, you do **not** need to run `pulumi up` immediately. You can keep building phases in code and use `pulumi preview` only until chosen first-apply milestone is ready.

#### Copy-paste manual checklist

- [ ] Create IAM user `admin`
- [ ] Attach `AdministratorAccess` to `admin`
- [ ] Enable MFA on `admin`
- [ ] Create access key for `admin`
- [ ] Add IAM OIDC provider `https://token.actions.githubusercontent.com`
- [ ] Create IAM role `github-actions-deploy`
- [ ] Create customer-managed policy `github-actions-deploy-bootstrap`
- [ ] Attach `github-actions-deploy-bootstrap` to `github-actions-deploy`
- [ ] Run `aws configure --profile rd-shop`
- [ ] Install Pulumi CLI: `npm install -g @pulumi/pulumi`
- [ ] Run `pulumi login`
- [ ] Enable MFA on root account
- [ ] Delete any root access keys
- [ ] Stop using root for day-to-day work

#### First real `pulumi up` timing

Two valid strategies:

- **Recommended:** start real applies in smaller slices (at least by end of Phase 1) so VPC, RDS, S3, secrets, and SES issues surface with smaller blast radius
- **Valid alternative:** wait until Phases 0-3 are fully represented in code, then run first real `pulumi up` before Phase 4; this keeps Phase 4 focused on CI/CD wiring only

Trade-offs if first apply waits until end of Phase 3:

- Lower early AWS spend while infra code is still moving
- Much larger first apply blast radius: network + data + compute + dedicated RabbitMQ EC2 fail or succeed together
- Slower debugging because broken dependency can be anywhere across Phases 0-3
- More prerequisites must be ready at once: Pulumi secrets, sender identity choice, and any message-broker credential inputs already modeled by then

If you choose delayed first apply:

- Keep using `pulumi preview --stack <stack>` after each phase so drift between code and expectations is caught early
- One manual rerun cycle (`preview` → `up` → optional `destroy` in disposable stage) is still useful, but it is **not required** as a separate gate before Phase 4
- First CI-driven stage deploy can absorb remaining stage compute / broker drift as long as the stack already previews cleanly and required secrets are present

If first apply is interrupted:

- Rerun `pulumi up --stack <stack> --refresh`
- Pulumi reuses resources already recorded in stack state; it does **not** intentionally duplicate them
- If AWS resource exists but interrupted update failed before state fully recorded it, expect conflict / `AlreadyExists`; recover with `pulumi refresh`, then rerun, or import/repair state if needed

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
- Private subnets (ECS host, RDS, dedicated RabbitMQ EC2)
- NAT egress path for ECS host outbound traffic (ECR pulls, Secrets Manager, SES, package fetches when needed)
- NAT Gateway or **NAT instance** (t3.micro — free tier eligible, cheaper than NAT Gateway)
- VPC endpoints for S3, ECR, Secrets Manager, CloudWatch Logs (reduce NAT traffic)

#### 0.3 Security groups

| SG                | Inbound                                          | Purpose                       |
| ----------------- | ------------------------------------------------ | ----------------------------- |
| `sg-alb`          | 80, 443 from 0.0.0.0/0                           | ALB public access             |
| `sg-ecs`          | 8080, 5001 from sg-alb and self                  | ECS EC2 instance (both tasks) |
| `sg-rds-shop`     | 5432 from sg-ecs                                 | Shop DB                       |
| `sg-rds-payments` | 5432 from sg-ecs                                 | Payments DB                   |
| `sg-mq`           | 5672 from sg-ecs; optional 15672 from admin CIDR | Dedicated RabbitMQ EC2 broker |

Bootstrap note:

- Keep explicit broad egress rules during initial migration bring-up so dependencies stay easy to validate.
- Treat least-privilege egress tightening as **post-migration priority** in Phase 6, especially `sg-rds-shop`, `sg-rds-payments`, and `sg-mq`.

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
- **Storage:** 20GB gp3 (minimum practical size), no autoscaling in stage; optional autoscaling cap later in production if real growth justifies it
- **Multi-AZ:** off for stage, on for production
- **Automated backups:** currently pinned to 1-day retention in both committed stack configs for the budget/free-tier posture; production code default remains 7 days if that explicit override is removed later
- **SSL enforcement:** `rds.force_ssl = 1` parameter group
- **Subnet group:** private subnets only
- **Security group:** port 5432, inbound from `sg-ecs` only
- **Connection:** `DATABASE_URL=postgresql://<user>:<pass>@<rds-endpoint>:5432/<db>?sslmode=require`

#### 1.2 S3 file storage

- Keep existing bucket (`rd-shop-files-private`) or create new per environment
- Remove `AWS_S3_ENDPOINT` / `AWS_S3_FORCE_PATH_STYLE` (MinIO workarounds)
- Bucket policy: private
- CORS on bucket for presigned upload from browser
- Initial AWS rollout may keep wildcard `allowedOrigins` / `allowedHeaders` to avoid blocking browser uploads during bootstrap; tighten both in Phase 6 once exact frontend origins and required headers are stable
- Keep current presigned download flow for initial migration
- Defer CloudFront distribution + public image URL rewrite to post-migration work once core AWS stack is stable

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

**Mandatory before first `pulumi up` for each stack**

Preview may still succeed with dry-run placeholder secret values. That is **not** enough for apply. Before first real `pulumi up`, set required Pulumi secret config in `infra/`:

```sh
cd infra

# stage
pulumi config set --stack stage --secret shopJwtAccessSecret '<32+ char secret>'
pulumi config set --stack stage --secret shopTokenHmacSecret '<32+ char secret>'

# production
pulumi config set --stack production --secret shopJwtAccessSecret '<32+ char secret>'
pulumi config set --stack production --secret shopTokenHmacSecret '<32+ char secret>'
```

Optional now, but set before dedicated RabbitMQ broker credentials become real runtime inputs:

```sh
cd infra

# stage
pulumi config set --stack stage --secret shopRabbitmqUser '<broker-user>'
pulumi config set --stack stage --secret shopRabbitmqPassword '<broker-password>'

# production
pulumi config set --stack production --secret shopRabbitmqUser '<broker-user>'
pulumi config set --stack production --secret shopRabbitmqPassword '<broker-password>'
```

**Where Pulumi stores these values**

- `pulumi config set --secret ...` writes encrypted ciphertext into the stack settings file for that stack:
  - `infra/Pulumi.stage.yaml`
  - `infra/Pulumi.production.yaml`
- Encrypted values appear under `config:` as `secure: ...`; that is expected and is normally safe to keep in git.
- Only encrypted `secure:` entries should be versioned. Never commit plaintext secret values to stack YAML.
- Do not copy encrypted `secure:` blobs between stacks manually. Pulumi encrypts stack secrets with stack-specific key material/provider context, so move/set them with `pulumi config set --stack <stack> --secret ...` instead of copy-paste.

**Decision for initial bootstrap (chosen path)**

- Do **not** block first real `pulumi up` on AWS KMS or Pulumi ESC adoption.
- Use Pulumi's current/default stack secrets provider for bootstrap and first manual applies.
- Reason: deploy-time secrets must be readable **before** the stack runs; a KMS key created by the same stack creates a chicken-and-egg bootstrap problem.
- AWS Secrets Manager is still the correct target for **runtime** app secrets after infrastructure exists, but it does not replace the need for an initial deploy-time secret source.
- Pulumi ESC is a valid future improvement for centralized deploy-time secrets/config, but it adds one more system and workflow to learn. It should not delay infrastructure bring-up.

**Hardening step after Phase 4 (recommended timing)**

- Do not block initial bring-up or Phase 4 CI/CD wiring on KMS migration.
- After Phase 4 is stable, create dedicated AWS KMS keys outside the main app stack (manual bootstrap or separate bootstrap stack).
- Re-encrypt `stage` and `production` with `pulumi stack change-secrets-provider` using those KMS keys.
- Keep encrypted `secure:` values in git after the provider switch; the tightening comes from stricter decryption control, not from hiding ciphertext from the repository.

**Post-bootstrap AWS KMS migration commands**

Run these after Phase 4 is working and before production hardening / long-term CI operation.

```sh
export AWS_PROFILE=rd-shop
export AWS_REGION=eu-central-1

cd infra

# stage KMS key
STAGE_KMS_KEY_ID=$(aws kms create-key \
  --region "$AWS_REGION" \
  --description "Pulumi stack secrets for rd_shop stage" \
  --tags TagKey=Project,TagValue=rd-shop TagKey=Stack,TagValue=stage TagKey=Purpose,TagValue=pulumi-secrets \
  --query 'KeyMetadata.KeyId' \
  --output text)

STAGE_KMS_KEY_ARN=$(aws kms describe-key \
  --region "$AWS_REGION" \
  --key-id "$STAGE_KMS_KEY_ID" \
  --query 'KeyMetadata.Arn' \
  --output text)

aws kms create-alias \
  --region "$AWS_REGION" \
  --alias-name alias/rd-shop-stage-pulumi-secrets \
  --target-key-id "$STAGE_KMS_KEY_ID"

aws kms enable-key-rotation \
  --region "$AWS_REGION" \
  --key-id "$STAGE_KMS_KEY_ID"

pulumi stack change-secrets-provider --stack stage \
  "awskms://alias/rd-shop-stage-pulumi-secrets?region=eu-central-1"

pulumi preview --stack stage

# production KMS key
PRODUCTION_KMS_KEY_ID=$(aws kms create-key \
  --region "$AWS_REGION" \
  --description "Pulumi stack secrets for rd_shop production" \
  --tags TagKey=Project,TagValue=rd-shop TagKey=Stack,TagValue=production TagKey=Purpose,TagValue=pulumi-secrets \
  --query 'KeyMetadata.KeyId' \
  --output text)

PRODUCTION_KMS_KEY_ARN=$(aws kms describe-key \
  --region "$AWS_REGION" \
  --key-id "$PRODUCTION_KMS_KEY_ID" \
  --query 'KeyMetadata.Arn' \
  --output text)

aws kms create-alias \
  --region "$AWS_REGION" \
  --alias-name alias/rd-shop-production-pulumi-secrets \
  --target-key-id "$PRODUCTION_KMS_KEY_ID"

aws kms enable-key-rotation \
  --region "$AWS_REGION" \
  --key-id "$PRODUCTION_KMS_KEY_ID"

pulumi stack change-secrets-provider --stack production \
  "awskms://alias/rd-shop-production-pulumi-secrets?region=eu-central-1"

pulumi preview --stack production
```

After creating the keys, replace `<STAGE_KMS_KEY_ARN>` and `<PRODUCTION_KMS_KEY_ARN>` in the IAM policy statement above with the actual values printed by the `describe-key` commands.

**Safe-to-apply checklist for first `pulumi up --stack stage`**

- `shopJwtAccessSecret` and `shopTokenHmacSecret` are set for `stage`
- AWS credentials point to intended AWS account and region
- You accept immediate creation/cost for stage RDS instances, NAT instance, S3 bucket, Secrets Manager secrets, SSM parameters, SES identity, and ECR repositories
- You accept that `stage` stays disposable until stable; `pulumi destroy --stack stage` removes stage DB data, stage bucket objects, and stage secrets
- SES identity creation alone does not make email fully ready; sender verification and SES sandbox / production-access steps remain separate

#### 1.5 SES email setup

- Shop `MailService` already uses SES v2 SDK — no application refactor required for initial AWS migration
- Verify sender identity or sending domain for `SES_FROM_ADDRESS`
- Request SES production access before production needs to send to arbitrary recipient addresses
- Provide `AWS_SES_REGION` and `SES_FROM_ADDRESS` through environment config
- Grant shop task role permission to send email via SES
- Stage can use verified test recipients while SES is still in sandbox; production should not depend on sandbox mode

#### 1.6 Data migration runbook (skip for empty rollout)

- Keep `pg_dump` → `pg_restore` instructions for Postgres and `aws s3 sync` instructions for MinIO → S3 as fallback runbooks
- Skip migration implementation for the initial AWS rollout because target databases and buckets start empty
- If legacy data appears later, run the migration as an operational task, not as part of the first infrastructure bring-up
- Stage still needs deterministic seed/init data for e2e tests even when legacy migration is skipped

---

### Phase 2 — Compute (ECS on EC2 + ALB)

> **Priority: 5 | Severity: 5 | Complexity: 4**

#### 2.1 ECS cluster + EC2 capacity

- One cluster per environment: `rd-shop-stage`, `rd-shop-production`
- **EC2 capacity provider** (chosen path for this migration)
- EC2 instance: `t3.micro` (1 vCPU, 1GB RAM) — free tier eligible
- AMI: ECS-optimized Amazon Linux 2023 (managed by AWS, auto-updated via launch template)
- Instance profile: IAM role with `AmazonEC2ContainerServiceforEC2Role` + ECR pull + CloudWatch Logs
- User data: `echo ECS_CLUSTER=rd-shop-stage >> /etc/ecs/ecs.config`
- Key pair: for SSH debugging (optional, can use ECS Exec instead)
- Placement: private subnet (outbound via NAT instance)
- Container Insights enabled

#### 2.2 Shop service

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

#### 2.3 Payments service

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

#### 2.4 ALB

- **Public ALB** in public subnets
- HTTPS listener (443): ACM certificate, TLS 1.2 minimum
- HTTP listener (80): redirect to HTTPS
- Target group: shop ECS service, dynamic port, health check `/ready`
- Access logs → S3 bucket

> **Free tier note:** ALB is not free tier eligible (~$20/mo). Alternative: use the EC2 instance's public IP directly (no TLS, no health-check-based routing). Not recommended for production, but acceptable for a budget staging setup. Can be added later when budget allows.

#### 2.5 Route 53

- Hosted zone for domain
- A record (alias) → ALB (or A record → EC2 Elastic IP if no ALB)
- ACM DNS validation record

#### 2.6 Future: capacity upgrade path

When single-host ECS on `t3.micro` stops being sufficient:

- Move to a larger EC2 host (`t3.small` / `t4g.small`) first — lowest-friction upgrade
- Add headroom for `minimumHealthyPercent: 100`, `maximumPercent: 200` rolling deploys
- If required later, move to multi-instance ECS on EC2 before revisiting other compute models
- Keep ALB, Cloud Map, task roles, secrets, and release flow stable while only compute capacity changes

---

### Phase 3 — Message Queue

> **Priority: 4 | Severity: 4 | Complexity: 2**

#### Decision: dedicated EC2 RabbitMQ vs. SQS

| Criteria                   | Dedicated EC2 RabbitMQ                                                       | SQS + SNS                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Protocol compatibility** | Drop-in — AMQP 0.9.1, same `amqplib` client                                  | Requires rewrite — HTTP-based SDK, different API                                           |
| **Code changes**           | Near zero — keep current `RabbitMQService` contract                          | Significant — replace `RabbitMQService`, change consumer pattern, no channel/ack semantics |
| **Features**               | Durable queues, manual ack, prefetch, retry + DLQ flow match current code    | FIFO queues, DLQ, visibility timeout. No channels/prefetch. Different retry model          |
| **Management UI**          | RabbitMQ management console (same as local compose)                          | AWS Console / CloudWatch                                                                   |
| **Cost**                   | Lower than AmazonMQ; uses one small EC2 + EBS but shares EC2 free-tier hours | Pay-per-request (~$0.40/million). Cheaper at low volume.                                   |
| **Operational overhead**   | You own the VM/container bootstrap, but that is acceptable for current goal  | Fully managed, zero ops                                                                    |
| **Migration effort**       | **Low-to-medium** — infra work only, almost no app churn                     | **High** — rewrite queue module, change DLQ/retry logic, integration tests                 |

**Recommendation:** dedicated EC2 RabbitMQ is the recommended path for the current stack. It stays inside AWS, preserves the current RabbitMQ contract, avoids the AmazonMQ `mq.m5.large` floor, and keeps application changes near zero. SQS remains the better long-term AWS-native architecture, but it is a real refactor and is not the shortest path to a working migration.

**Rejected option for current stack:** AmazonMQ (RabbitMQ engine). First stage `pulumi up` confirmed AWS rejects `mq.t3.micro` for RabbitMQ with `BadRequestException`, and Frankfurt create flow shows `mq.m5.large` as the minimum available size. That makes AmazonMQ the wrong fit for the current cost target.

#### Architectural tradeoff: broker ownership vs. service ownership

- Dedicated EC2 RabbitMQ is still shared integration infrastructure, not part of one service runtime in the same sense as shop HTTP handlers or payments gRPC handlers.
- Current repo reality is narrower: only `shop` publishes and consumes queue messages today; `payments` does not talk to RabbitMQ directly.
- Initial migration should keep shop-scoped config names (`shopRabbitmq*`) because they match current code ownership and minimize migration churn.
- Ownership boundary should stay explicit: broker infrastructure is shared/platform scope, while the `orders.process` / `orders.dlq` contract belongs to the shop/orders bounded context until another service becomes a first-class publisher or consumer.
- If payments or future services start using messaging directly, promote config and credentials from shop-specific to generic/shared naming, and split broker access per service (separate users, permissions, and possibly vhosts).

#### Recommended dedicated EC2 RabbitMQ architecture

- One dedicated RabbitMQ EC2 instance in a private subnet. Keep it separate from the ECS host so broker restarts and disk pressure do not couple to app task scheduling.
- One persistent gp3 EBS data volume mounted at `/var/lib/rabbitmq` so broker state survives instance reboot and container restart.
- Run the same broker image already used in compose: `rabbitmq:3.13-management-alpine`.
- No public IP, no ALB, no public listener. ECS tasks reach the broker over private VPC networking only.
- Reuse or repurpose `sg-mq` so port `5672` is allowed from `sg-ecs`. Expose management UI `15672` only to a narrow admin CIDR, or leave it disabled initially.
- Broker credentials stay in Secrets Manager. The EC2 instance fetches them at boot through its instance role; shop tasks read the same credentials through their existing runtime secret path.
- Initial runtime path uses internal AMQP on port `5672`. The AMQPS support already added to `RabbitMQService` can stay, but it is not required for the first dedicated EC2 rollout.
- Publish broker location to app config as `RABBITMQ_HOST=<private-ip-or-private-dns>` and `RABBITMQ_PORT=5672` via SSM / runtime secret wiring.
- No manual queue bootstrap is required. The shop app already asserts `orders.process` and `orders.dlq` on startup.

#### Detailed Pulumi implementation — step by step

1. Replace the AmazonMQ Phase 3 design with a dedicated broker module under `infra/src/messaging/` that provisions one RabbitMQ EC2 instance instead of `aws.mq.Broker`.
2. Add broker config inputs for stack-specific EC2 shape and bootstrap: instance type, root/data volume size, optional admin CIDRs for port `15672`, optional SSH key name if Session Manager is not enough, and image tag / container image if you want it configurable.
3. Reuse or adapt the current `sg-mq` security group so ingress becomes `5672 from sg-ecs`, optional `15672 from admin CIDRs`, and broad egress is left explicit for initial bring-up.
4. Create a dedicated IAM role + instance profile for the broker EC2 instance. Attach `AmazonSSMManagedInstanceCore` and a narrow inline policy for `secretsmanager:GetSecretValue` on the RabbitMQ secret and `ssm:GetParameter*` on any broker bootstrap parameters.
5. Create a dedicated Secrets Manager secret for broker bootstrap values. Minimum contents: `RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS`, `RABBITMQ_DEFAULT_VHOST`.
6. Provision one private-subnet EC2 instance for the broker. Stage should start with a single-node instance in one AZ; production can keep the same pattern initially if “make it work” is the current priority.
7. Attach a dedicated gp3 EBS volume and mount it to `/var/lib/rabbitmq`. Keep queue state off the root disk so container restarts and host reboots do not wipe broker data.
8. Use `userData` to bootstrap the instance: install Docker, install AWS CLI if needed, fetch the broker secret via the instance role, mount the EBS volume, and start `rabbitmq:3.13-management-alpine` with the mounted data path and bootstrap env vars.
9. Add a simple boot-time health check in the bootstrap script, for example `rabbitmq-diagnostics ping`, so the instance does not report success before the broker is actually up.
10. Export the broker private IP (or dedicated private DNS record if you add one) from Pulumi and wire it into runtime config. For the first working version, using the EC2 private IP in `RABBITMQ_HOST` is acceptable; private DNS can be a follow-up improvement.
11. Update runtime config generation so `RABBITMQ_HOST` and `RABBITMQ_PORT=5672` come from the dedicated broker outputs instead of AmazonMQ outputs. `RABBITMQ_USER` and `RABBITMQ_PASSWORD` stay in Secrets Manager as before.
12. Remove AmazonMQ-specific logic and validation from the infra code path: `aws.mq.Broker` resource creation, AmazonMQ outputs, `resolveRabbitMqHostInstanceType`, and AmazonMQ-only runtime assumptions.
13. Keep application code unchanged for the initial rollout. The current `RabbitMQService` env contract remains valid; the existing AMQPS support simply stays unused.
14. Verification order for first stage bring-up: `pulumi up --stack stage` → confirm broker EC2 is running and bootstrap finished → redeploy `shop` ECS service so it rereads runtime parameters → create one order and verify queue processing + DLQ path.

---

### Phase 4 — CI/CD Pipeline Update

> **Priority: 4 | Severity: 4 | Complexity: 3**

#### 4.1 GitHub Actions OIDC federation

- Replace long-lived AWS credentials with OIDC identity provider
- Start with one bootstrap role (`github-actions-deploy`) trusted by `development` branch + `stage` / `production` environments
- Harden later by splitting into `github-actions-build`, `github-actions-stage`, `github-actions-production`
- GitHub Actions jobs that assume AWS roles must set `permissions: { id-token: write, contents: read }`
- No AWS access keys stored in GitHub secrets

```yaml
permissions:
  contents: read
  id-token: write

- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v5
  with:
    aws-region: eu-central-1
    role-to-assume: ${{ vars.AWS_ROLE_ARN_STAGE }}
```

#### 4.2 Phase 4 workstream map

Do not migrate the whole release path in one shot. Split Phase 4 into workstreams with independent exit criteria.

| Workstream                    | Goal                                                                        | Why isolate it                                                                            | Exit criteria                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **A. Testability foundation** | Extract reusable workflow / action core and branch-test harnesses           | Removes the current `main` merge loop for every workflow fix                              | Build and stage deploy logic can be exercised from non-default branches through `push`-based test wrappers |
| **B. Build & Push**           | Replace GHCR with ECR using OIDC                                            | Cleanly separates image publishing from deploy logic                                      | Immutable ECR image refs + digests are produced and release-manifest contract stays stable                 |
| **C. Deploy Stage**           | Replace SSH / Compose stage deploy with Pulumi + ECS + one-off DB tasks     | First real AWS release path; absorbs remaining stage stack drift                          | Stage deploy reaches stable ECS services after `pulumi up`, migrations, seed, smoke                        |
| **D. Stage validation gate**  | Adapt validation from VM-era smoke only to deployed-stage checks            | Current e2e flow is still local-Docker-oriented and should not block stage deploy rewrite | Post-deploy stage e2e or seeded sanity checks run against real stage URL                                   |
| **E. Deploy Production**      | Replace SSH / Compose production deploy with Pulumi + ECS + migrations only | Production depends on stage flow already being proven                                     | Production deploy stays manual / approval-gated and runs migrations without seed                           |

#### 4.3 Workstream A — Testability foundation

- Keep `build-and-push.yml`, `deploy-stage.yml`, and `deploy-production.yml` as thin trigger / policy wrappers.
- Move real build and deploy logic into reusable workflow or composite-action cores.
- Add branch-only test wrappers triggered by `push` to CI-focused branches such as `ci/build/**` and `ci/stage/**`.
- Keep official default-branch-gated workflows for real stage / production operation, but stop using them as the only place to debug workflow logic.
- Preserve `pr-checks.yml` as the PR quality gate; add `pulumi preview` there only when infra changes need review visibility.
- This workstream is cross-cutting and may land incrementally. Build-lane testability can come first; stage-lane testability must be in place before Workstream C is considered done.

#### 4.4 Workstream B — Build & Push

- Update `build-and-push.yml` to push to ECR instead of GHCR.
- Use OIDC-based AWS auth plus `aws-actions/amazon-ecr-login@v2` and `docker/build-push-action`.
- Keep immutable `sha-<commit>` tags as the primary deploy input. Branch tags may exist for convenience only.
- Keep release-manifest artifact shape stable if possible so deploy workflows can continue to read one canonical manifest.
- Build path should not know about RabbitMQ, migrations, or ECS rollout. Its only job is publishing immutable images and artifact metadata.
- Success criteria:
  - both services build successfully on branch-local test wrapper runs
  - ECR push works without long-lived AWS secrets
  - release manifest contains immutable image refs and digests consumed later by deploy jobs

#### 4.5 Workstream C — Deploy Stage

- Replace SSH / VM logic in `deploy-stage.yml` with AWS auth, `pulumi up --stack stage`, ECS rollout, and post-deploy validation.
- Stage deploy should absorb any remaining stage compute or broker drift. A separate manual `pulumi up` before this phase is optional, not required.
- Recommended stage execution order:

```text
download release manifest
  -> assume stage role via OIDC
  -> pulumi up --stack stage --yes
  -> if broker diff changed RabbitMQ infra: wait for broker EC2 healthy
  -> run one-off payments migration task
  -> run one-off shop migration task
  -> run one-off shop seed task
  -> update ECS services / force new deployment
  -> wait services-stable
  -> smoke test (/health -> /ready -> /status)
  -> async order sanity check
```

- Run migrations and seed as explicit one-off tasks, not as app container startup hooks.
- If the stage workflow is still too large, split it internally into jobs such as `infra`, `db-init`, `deploy-apps`, and `smoke`, but keep one stage deployment workflow entrypoint.

#### 4.6 Workstream D — Stage validation gate

- Keep smoke testing in the stage deploy workflow because it is the cheapest failure signal.
- Move broader e2e validation into a separate post-deploy gate after stage deploy is stable.
- Reuse the real existing e2e scenarios from `apps/shop/test/e2e`, but do not reuse their local Docker bootstrap path unchanged for deployed-stage validation.
- Recommended first version of the stage validation gate:
  - hit deployed stage base URL
  - use deterministic seeded accounts / products
  - validate one order flow end-to-end, including async worker completion
- Stage seed data is owned by the dedicated stage seed task, not by app startup.

Implementation order:

1. Define a dedicated stage-validation data namespace derived from `apps/shop/src/db/perf-seed/`, but keep it intentionally small. Use deterministic UUIDs, email prefixes, and product title prefixes reserved only for validation so cleanup can target those rows without touching normal stage data.
2. Implement a small stage-validation seed slice using the existing perf-seed style and helpers instead of the full performance dataset. Seed only the minimum set needed by the reused e2e scenarios: one or more validation users, a small product set with stable stock, and only the supporting records those scenarios actually need.
3. Implement a matching cleanup task for the stage-validation namespace. Delete only validation-owned rows, in FK-safe order, and make the cleanup idempotent so it can run in `always()` / failure paths.
4. Keep the HTTP/assertion logic from the real e2e scenarios in `apps/shop/test/e2e`, but extract or parameterize any assumptions that currently depend on local bootstrap behavior or shared seed data. The stage gate should point those scenarios at validation-only users and products, not arbitrary existing stage records.
5. Create a dedicated stage-validation Jest subset that runs selected existing scenarios against `STAGE_VALIDATION_BASE_URL=<stage-url>`. Start with the narrowest stable slice, such as auth + cart/order flow + async order completion, before widening coverage.
6. Add a one-off ECS seed task before validation that inserts only the stage-validation namespace data. Do not overload the normal stage seed task with temporary validation data.
7. Add a one-off ECS cleanup task after validation that always runs, even on failure, so the shared stage database returns to its pre-validation shape.
8. Wire `stage-validation.yml` as a separate post-deploy gate: wait for successful stage deploy, run validation seed task, run the selected existing e2e scenario subset against the real stage URL, then always run cleanup and publish logs/artifacts.
9. Add a branch-local `stage-validation-test.yml` wrapper using the same push-based test-wrapper pattern already proven for build and stage deploy.
10. Only after repeated stable runs should the stage validation workflow become a required gate for promotion toward production.

#### 4.7 Workstream E — Deploy Production

- Keep `deploy-production.yml` manual-dispatch and approval-gated through the GitHub `production` environment.
- Replace SSH / VM deploy with AWS auth, `pulumi up --stack production`, one-off migration tasks, ECS rollout, and smoke test.
- Accept brief downtime during production deployment for the first ECS/Pulumi cut. Reuse the same service-quiesce -> migrations -> restore -> force-new-deployment flow already proven on stage instead of adding a zero-downtime migration lane now.
- Production execution order should be:

```text
download release manifest
  -> approval gate
  -> assume production role via OIDC
  -> pulumi up --stack production --yes
  -> if broker diff changed RabbitMQ infra: wait for broker EC2 healthy
  -> run one-off payments migration task
  -> run one-off shop migration task
  -> update ECS services / force new deployment
  -> wait services-stable
  -> smoke test
```

- No production seed.
- Production rollout should start only after stage deploy plus stage validation are stable.

#### 4.7.1 Common Stage / Prod pieces

- Keep stage and production deploy structure intentionally close for the first production ECS rollout.
- Shared deploy core should be:
  - checkout exact commit
  - assume environment-scoped AWS role via OIDC
  - download release manifest
  - parse immutable image refs
  - set stack image inputs
  - `pulumi up`
  - capture stack outputs
  - quiesce ECS services
  - run one-off DB tasks
  - restore services and force rollout
  - wait for ECS stabilization
  - dump diagnostics on failure
  - smoke test
  - write deploy summary
- Production-only differences should stay small:
  - `workflow_dispatch` inputs: `run_id`, `sha`
  - `environment: production` approval gate
  - `PULUMI_STACK=production`
  - production-scoped IAM role / Pulumi config
  - no `shop-seed`
- Do not block Workstream E on extracting a reusable core first. Ship production by copying the proven stage ECS flow with the above diffs, then extract shared workflow pieces later only if stage/prod drift grows again.

#### 4.8 Cross-cutting notes — Workflow testing

GitHub Actions behavior matters here:

- `workflow_dispatch` and `workflow_run` only work when the workflow file exists on the default branch.
- `push` workflows can be tested from non-default branches and use the workflow file from the pushed branch.

Recommended testing strategy:

- Extract real logic into reusable workflow / composite-action cores, then keep thin default-branch wrappers around them.
- Add branch-local test wrappers for build and stage deploy, triggered by `push` on CI branches.
- Use narrow `paths:` filters so these wrappers run only for workflow, infra, Docker, or deploy-related changes.
- Prefer a dedicated non-prod target such as `stage-ci` if budget allows. If not, shared `stage` is acceptable temporarily with strict concurrency and operator discipline.
- Keep production testing on the official manual workflow only; do not create a branch-local production deploy harness.
- Use `act` only for YAML / shell / composite-action syntax checks. It is not a real substitute for OIDC auth, GitHub Environments, `workflow_run`, or cross-run artifact behavior.
- Do not change default-branch policy just to make workflow testing easier. Solve the problem by splitting trigger wrappers from execution logic.

#### 4.9 Cross-cutting notes — Seed / migration

Current repo commands already provide the required building blocks:

- `apps/payments/package.json` exposes `db:migrate:prod`
- `apps/shop/package.json` exposes `db:migrate:prod`
- `apps/shop/package.json` exposes `db:seed:prod`

Recommended execution model:

- Run DB work as explicit one-off ECS tasks or equivalent command overrides against the already-built application images.
- Do not run migrations or seed in normal app startup commands.
- Keep production seed disabled. Stage seed is allowed only through the dedicated stage seed task.
- Pass `ALLOW_SEED_IN_PRODUCTION=true` only to the stage seed task environment. Do not set it for normal service runtime and do not set it in production runtime config.

Stage DB order:

```text
payments migrate
  -> shop migrate
  -> shop seed
```

Production DB order:

```text
payments migrate
  -> shop migrate
```

#### 4.10 Cross-cutting notes — Payments gRPC discovery hardening

- Current `shop` payments client still resolves Cloud Map SRV records on the request path. Keep this acceptable for initial stage rollout, but plan a short-lived in-process resolution cache so normal RPC traffic does not pay DNS lookup cost on every call.
- Tie cache invalidation to a bounded TTL and refresh on transport failures so discovery still reacts to ECS task replacement.
- Current SRV target choice is deterministic priority / weight ordering, not RFC 2782 weighted selection.
- When multiple `payments` task endpoints are expected, replace deterministic ordering with RFC 2782-compliant weighted random selection within the lowest-priority SRV set.
- Implement the cache and weighted selection together so endpoint stickiness, balancing, and failover semantics are defined in one place.

Additional rollout rules:

- `shop` seed should remain idempotent because stage deploys may rerun.
- Application releases must remain backward-compatible with both pre-migration and post-migration schemas during rollout. Use expand / contract migration patterns.
- If a migration is not backward-compatible, treat that release as a special operational rollout, not a normal automatic deploy.

#### 4.11 Cross-cutting notes — Dedicated EC2 RabbitMQ deploy strategy

- Dedicated EC2 RabbitMQ is stateful infrastructure, but it does **not** need its own permanent build or release pipeline.
- Keep broker lifecycle in the same Pulumi stack and the same stage / production deploy workflows.
- Always run `pulumi up` before ECS redeploy. If there is no broker diff, RabbitMQ remains untouched and deploy continues normally.
- If Pulumi changes broker infra in a way that can restart or replace the instance, wait for broker health first, then redeploy at least the `shop` ECS service so it rereads broker connection settings.
- `payments` does not depend on RabbitMQ directly. For simplicity both services may still be redeployed together, but only `shop` is broker-coupled.
- Recommended future operator control: add an optional workflow input such as `infra-scope = full | app-only | broker` if broker-only maintenance becomes common.
- Main rule: lifecycle separation, not pipeline separation. Normal app deploys should not intentionally replace the broker, but the same deploy workflow may still safely pass through broker-aware infra steps.

#### 4.12 Cleanup target — Remove VM deployment artifacts

- Delete SSH-based `deploy-to-stage` and `deploy-to-production` composite actions after ECS deploy path is proven.
- Remove VM-era GitHub secrets and variables such as `SSH_PRIVATE_KEY`, `GHCR_TOKEN`, `SSH_HOST`, `SSH_USER`, `DEPLOY_DIR`, and base64 env-file transport.
- Replace them with AWS role ARNs, AWS region / ECR registry values, ECS cluster and service identifiers, Pulumi access configuration, and any stage / production URL variables needed by smoke or e2e checks.
- PR path should keep preview-style validation only; actual mutating deploy logic belongs in merge-to-development and production approval workflows.

---

### Phase 5 — Stage DB cost split (stage PostgreSQL on EC2, production on RDS)

> **Priority: 4 | Severity: 4 | Complexity: 3**

This phase exists only because the current AWS account/plan effectively allows two RDS instances, while the target architecture wants two PostgreSQL databases for stage and two for production. The cost-constrained compromise is:

- keep **production** on two dedicated RDS instances (`shop`, `payments`)
- move **stage** to one private EC2 host running self-managed PostgreSQL
- keep stage intentionally simple: one host, one EBS volume, two logical databases, no HA, no replica, no automated backup plan for now

#### 5.1 Target state

- Stage PostgreSQL runs on one dedicated private EC2 instance, similar in spirit to the dedicated RabbitMQ EC2 workaround already accepted for free-tier limits.
- The stage PostgreSQL host stores both logical databases:
  - `rd_shop`
  - `rd_shop_payments`
- Production keeps the existing intended ownership model from Phase 1: two dedicated RDS instances managed by Pulumi.
- Application runtime contract should stay as stable as possible. The app should continue to receive:
  - DB host
  - DB port
  - DB name
  - DB username
  - secret payload with password / connection URL

#### 5.2 Why this is a separate phase

- This is not normal production deployment work. It is a quota / cost workaround that changes stage database infrastructure shape.
- It should not be hidden inside `deploy-production.yml` because freeing stage DB capacity is a destructive stage action, not a production rollout step.
- First production `pulumi up --stack production` should remain a manual bootstrap action even after this phase is implemented.

#### 5.3 Amount of work

- Moderate infra work, low application work.
- Expected scope:
  - one new stage-only PostgreSQL EC2 path
  - one stage-only data/runtime wiring path
  - minimal security-group additions
  - stage cutover validation
- Rough effort: about one focused infra workstream, approximately 6-10 hours if no major EC2 bootstrap issues appear.

#### 5.4 Recommended implementation order

1. Add a stage-only database backend switch in the Pulumi data layer. Keep production on the current RDS path and allow stage to choose `ec2-postgres`.
2. Implement one private EC2 PostgreSQL host for stage, preferably modeled after the existing dedicated RabbitMQ EC2 provisioning pattern but simpler.
3. Attach an encrypted EBS volume for the stage PostgreSQL data directory.
4. Bootstrap PostgreSQL through user data or cloud-init:
   - install PostgreSQL
   - initialize the data directory
   - create database users `shop` and `payments`
   - create databases `rd_shop` and `rd_shop_payments`
   - bind only on the private interface / security-group path
5. Reuse the existing stage DB security-group intent rather than inventing a second network model. ECS should still be the only caller allowed on port `5432`.
6. Publish stage DB credentials in Secrets Manager using the same payload shape the runtime-config layer already expects, so application code stays unchanged.
7. Refactor the stage data-layer outputs so `createFoundationRuntimeConfig(...)` can consume either:
   - RDS connection metadata for production
   - EC2 PostgreSQL connection metadata for stage
8. Apply the stage stack, run stage migrations, run stage seed, and rerun stage validation against the new stage PostgreSQL host.
9. Only after stage is healthy on EC2 PostgreSQL should Pulumi remove the two old stage RDS instances.
10. After the RDS quota is free, run the first `pulumi up --stack production` manually. After production infra exists, continue using the normal `deploy-production.yml` workflow for image-based deploys.

#### 5.5 Safe manual release of the two stage RDS instances

Goal: free the two RDS slots for production **without** breaking Pulumi state.

Do **not** do this:

- Do not delete the stage RDS instances directly in the AWS console while the stage stack still declares them.
- Do not use `pulumi state rm` / manual state surgery to fake-delete them.
- Do not destroy the whole `stage` stack, because `stage` is still the shared-infra owner for other resources.

Safe release procedure:

1. Implement the stage EC2 PostgreSQL path from this phase.
2. Run `pulumi preview --stack stage` and confirm the desired state replaces stage RDS with the EC2 PostgreSQL host.
3. Run `pulumi up --stack stage` and let Pulumi perform the stage cutover.
4. Run stage migrations, stage seed, and stage validation gates against the new stage DB host.
5. Re-run `pulumi preview --stack stage` until no further unexpected DB drift remains.
6. Verify that the old stage RDS instances are no longer present:

```bash
aws rds describe-db-instances \
  --region eu-central-1 \
  --query 'DBInstances[].{id:DBInstanceIdentifier,status:DBInstanceStatus}' \
  --output table
```

7. Only then run the first `pulumi up --stack production` manually.

#### 5.6 First production bootstrap after the stage DB split

- Keep the first production bootstrap as manual Pulumi CLI work.
- Reason: this is still quota-sensitive bootstrap territory, not a routine application rollout.
- Recommended first-run order:

```text
finish stage validation on EC2 PostgreSQL
  -> verify stage RDS instances are gone
  -> pulumi preview --stack production
  -> pulumi up --stack production
  -> verify production DBs / runtime secrets / endpoints
  -> switch to deploy-production.yml for normal image-based deploys
```

### Phase 6 — Observability & Security (post-migration)

> **Priority: 3 | Severity: 3 | Complexity: 2**

Items that become available or mandatory after AWS migration.

#### 6.1 CloudWatch integration

- Detailed rollout lives in `docs/backend/requirements/observability-plan.md`:
  - Phase 1: minimal valid CloudWatch monitoring (retention + built-in dashboards + alarms + SNS, no app-code changes)
  - Phase 2: recommended app metrics + log consistency (EMF metrics + optional `payments` Pino alignment)
- ECS container logs already flow to CloudWatch via `awslogs` driver
- Set up log retention policies (30 days stage, 90 days production)
- CloudWatch Alarms: high CPU, high memory, 5xx rate, unhealthy targets
- Container Insights dashboards are optional enhancement work; do not block the minimal monitoring phase on them

#### 6.2 Secrets rotation

- RDS: Secrets Manager native rotation (Lambda-based, automatic)
- JWT signing secret: custom rotation Lambda with dual-key verification window
- AWS credentials: IAM task roles (no static keys — no rotation needed)

#### 6.3 TLS everywhere

- ALB → HTTPS (ACM cert, auto-renewal)
- If stage / production stay on default CloudFront domains, viewer-facing HTTPS is already satisfied without Route53-hosted custom domains. In that mode, ALB HTTPS becomes hardening work, not migration-blocking work.
- Current stage `publicEdgeMode=cloudfront` is viewer-HTTPS only; CloudFront → ALB remains HTTP until custom-domain mode is used
- RDS → SSL enforced via parameter group
- Dedicated RabbitMQ EC2 → internal AMQP `5672` initially; add TLS later if needed
- S3 → HTTPS (AWS SDK default)
- CloudFront → HTTPS + custom domain cert if CDN layer is enabled later
- gRPC inter-service → same EC2 instance (localhost in bridge mode); VPC placement trust for cross-instance

#### 6.4 Network least-privilege hardening

- Revisit bootstrap `*-egress-all` security group rules created in Phase 0.3
- Tighten or remove broad egress from `sg-rds-shop`, `sg-rds-payments`, and `sg-mq`
- Restrict `sg-ecs` and `sg-alb` egress to real dependencies where operationally safe
- Re-validate required traffic against VPC endpoints, RDS, dedicated RabbitMQ EC2, SES, and runtime health checks

#### 6.5 S3/browser hardening

- Replace wildcard S3 CORS `allowedOrigins` with exact stage/production frontend origins
- Replace wildcard S3 CORS `allowedHeaders` with only headers actually required by presigned upload flow
- Re-test browser upload, presigned download, and local MinIO compatibility after tightening

#### 6.6 Audit log migration (optional)

- Swap `AuditLogService` backing store from DB table to CloudWatch Logs
- Security hardening plan designed the interface to be storage-agnostic (repository pattern)

### Phase 7 — Public file delivery via CloudFront

> **Priority: 2 | Severity: 2 | Complexity: 2**

This phase is intentionally post-migration. Core AWS cutover already works with presigned S3 reads, so do not block Phases 4-6 on this refactor.

#### 7.1 Why this is separate

- Current file flow is operational but suboptimal: public product / avatar reads still hit S3 through presigned URLs instead of a CDN-backed stable public URL.
- Default CloudFront domains already provide HTTPS, so this optimization does **not** require Route53 custom domains or paid DNS features to start.
- Upload flow can stay presigned-to-S3. Only public read path needs to change.

#### 7.2 Target state

- Stage and production expose public file reads through CloudFront, not direct presigned S3 download URLs.
- Application stores canonical object keys (or equivalent stable relative paths), not expiring download URLs.
- `FilesService` / `S3Service` generate public URLs as `https://<cloudfront-domain>/<object-key>` when asset is public.
- Private / operator-only downloads may keep presigned S3 URLs if that remains simpler.

#### 7.3 Implementation order

1. Provision or finalize one CloudFront distribution per environment for public file delivery. Default CloudFront domain is acceptable initially.
2. Put S3 bucket access behind CloudFront origin access control / equivalent private-origin policy so public reads do not require public bucket exposure.
3. Refactor file-read URL generation in app code to return CloudFront URLs for public assets while keeping presigned upload flow unchanged.
4. Normalize persisted file references to stable object keys if any records currently store full presigned download URLs.
5. Define cache behavior explicitly: prefer versioned object keys over broad invalidation where possible.
6. Validate browser upload -> persisted file reference -> public read flow on stage, then production.

#### 7.4 Exit criteria

- Product and avatar reads use CloudFront URLs in both stage and production.
- No public read path depends on expiring S3 presigned download URLs.
- Viewer-facing HTTPS for file reads works through CloudFront without requiring Route53 custom domains.

---

## Environment Variables — Migration Mapping

| Current Env Var                                         | AWS Equivalent                                                   | Source              |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ------------------- |
| `DATABASE_URL`                                          | RDS endpoint (composed from Secrets Manager JSON)                | Secrets Manager     |
| `DATABASE_HOST` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | RDS credentials                                                  | Secrets Manager     |
| `JWT_ACCESS_SECRET`                                     | Application secret                                               | Secrets Manager     |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`           | **Removed** — use IAM task role                                  | Task role           |
| `AWS_S3_ENDPOINT`                                       | **Removed** — use default S3 endpoint                            | N/A                 |
| `AWS_S3_FORCE_PATH_STYLE`                               | **Removed** — MinIO workaround                                   | N/A                 |
| `AWS_S3_PUBLIC_ENDPOINT`                                | **Removed** — no separate public endpoint in initial AWS rollout | N/A                 |
| `AWS_CLOUDFRONT_URL`                                    | CloudFront distribution URL for public file reads                | SSM Parameter Store |
| `AWS_SES_REGION`                                        | SES region                                                       | SSM Parameter Store |
| `SES_FROM_ADDRESS`                                      | Verified SES sender identity                                     | SSM Parameter Store |
| `RABBITMQ_HOST`                                         | Dedicated RabbitMQ EC2 private IP or private DNS                 | SSM Parameter Store |
| `RABBITMQ_PORT`                                         | `5672` (internal AMQP initially)                                 | SSM Parameter Store |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD`                   | Dedicated RabbitMQ broker credentials                            | Secrets Manager     |
| `PAYMENTS_GRPC_HOST`                                    | `payments.rd-shop.local` (Cloud Map)                             | SSM Parameter Store |
| `CORS_ALLOWED_ORIGINS`                                  | Production domain                                                | SSM Parameter Store |
| `APP_URL`                                               | `https://api.yourdomain.com`                                     | SSM Parameter Store |
| `PORT`, `NODE_ENV`, `APP_LOG_LEVEL`                     | Static config                                                    | SSM Parameter Store |

### Application code changes required

| Change                                                        | Scope                      | Reason                                                         |
| ------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------- |
| Remove `AWS_S3_ENDPOINT` / `AWS_S3_FORCE_PATH_STYLE` fallback | `S3Service`                | No MinIO in AWS; default S3 endpoint works                     |
| No additional RabbitMQ transport change required              | `RabbitMQService`          | Dedicated broker keeps the existing AMQP env contract (`5672`) |
| IAM credential chain (remove static keys)                     | `S3Service`, `MailService` | ECS task role provides credentials via EC2 instance metadata   |
| Remove `MINIO_PORT` / `MINIO_CONSOLE_PORT` env vars           | env schema                 | No MinIO                                                       |

**Deferred post-migration refactor:** see Phase 7 for switching product/avatar reads from presigned S3 URLs to public CloudFront URLs.

---

## Cost Estimate (Stage Environment — Free Tier Optimized)

| Service                    | Spec                          | ~Monthly Cost                                               | Free Tier?                  |
| -------------------------- | ----------------------------- | ----------------------------------------------------------- | --------------------------- |
| EC2 (ECS host)             | t3.micro, 24/7                | ~$0\*                                                       | ✅ 750 hrs/mo for 12 months |
| ECS                        | Orchestration                 | $0                                                          | ✅ Always free              |
| RDS (shop)                 | db.t3.micro, 20GB, single-AZ  | ~$0\*                                                       | ✅ 750 hrs/mo for 12 months |
| RDS (payments)             | db.t3.micro, 20GB, single-AZ  | ~$0–15\*\*                                                  | ✅ Shares 750 hrs with shop |
| Dedicated RabbitMQ EC2     | `t3.micro` + EBS data volume  | Shares EC2 free-tier pool; still much cheaper than AmazonMQ | ✅ / partial                |
| ALB                        | 1 ALB + minimal LCUs          | ~$20                                                        | ❌                          |
| NAT instance               | t3.micro (fck-nat AMI)        | ~$0\*                                                       | ✅ Shares 750 hrs pool      |
| S3                         | 5GB storage, minimal requests | ~$0                                                         | ✅ 5GB for 12 months        |
| CloudFront                 | Deferred initially            | $0 now                                                      | Optional / post-migration   |
| Secrets Manager            | ~10 secrets                   | ~$4                                                         | ❌                          |
| CloudWatch Logs            | Minimal ingestion             | ~$0                                                         | ✅ 5GB ingestion/mo         |
| ECR                        | Image storage (500MB)         | ~$0                                                         | ✅ 500MB/mo for 12 months   |
| **Total (year 1)**         |                               | **~$54/mo**                                                 |                             |
| **Total (post-free-tier)** |                               | **~$105/mo**                                                |                             |

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
Phase 1 (Data)           ──── RDS + S3 + Secrets Manager + SSM + SES setup
  │                        Legacy data migration kept as runbook only
     │
Phase 2 (Compute)        ──── ECS on EC2 (t3.micro) + ALB + Cloud Map
     │                        Shop + Payments on single instance
     │                        Smoke test against ALB endpoint
     │
Phase 3 (Queue)          ──── Dedicated RabbitMQ EC2 provisioning
  │                        Point shop to broker private host / port 5672
     │
Phase 4 (CI/CD)          ──── GitHub Actions OIDC + ECR push + ECS deploy
     │                        Remove SSH/VM deploy artifacts
     │
Phase 5 (Stage DB split) ──── Stage PostgreSQL on EC2, free 2 RDS slots, manual production bootstrap
  │
Phase 6 (Hardening)      ──── CloudWatch alarms, secrets rotation, audit log migration
     │
DNS cutover              ──── Route 53 → ALB
VM decommission          ──── After monitoring period
```

---

## Time Estimate (8h/day, AI-assisted)

> Assumes: one developer, 8h working days, AI pair-programming throughout, no prior AWS production experience but familiar with the codebase.

| Phase                        | Scope                                                                                                                                                                                      | Est. Days         | Key bottlenecks                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Prerequisites**            | IAM admin user + MFA, OIDC provider + deploy role, Pulumi login, root lockdown                                                                                                             | 0.5               | All manual console steps — no automation possible                                                                                                                        |
| **Phase 0** — Foundation     | Pulumi project, VPC (2 AZs, public/private subnets, NAT instance), 5 security groups, 2 ECR repos + lifecycle policies                                                                     | 1                 | NAT instance vs NAT Gateway tradeoff; VPC CIDR planning                                                                                                                  |
| **Phase 1** — Data layer     | 2 RDS instances, S3 foundation, Secrets Manager + SSM, SES setup, migration runbook only                                                                                                   | 1.5               | Secret/config decomposition; RDS parameter-group setup; SES identity verification / sandbox exit timing                                                                  |
| **Phase 2** — Compute        | ECS cluster + EC2 launch template, shop task definition + ALB + target group, payments task definition + Cloud Map, ACM cert + Route 53                                                    | 2.5               | Largest phase. First ECS deploy almost always has issues (env injection, health check timing, bridge networking, stop-before-start memory); ECS Exec debugging adds time |
| **Phase 3** — Message queue  | Dedicated RabbitMQ EC2 (Pulumi), EBS data volume, bootstrap/user-data, runtime host/credential wiring, verify message flow + DLQ                                                           | 1.0               | EC2 bootstrap timing, Docker startup, volume mount correctness, broker health-check sequencing                                                                           |
| **Phase 4** — CI/CD          | OIDC assume-role, ECR push in `build-and-push.yml`, `deploy-stage.yml` rewrite (`pulumi up` + broker-ready wait + ECS deploy + async gate), `deploy-production.yml`, remove SSH composites | 1.5               | OIDC trust policy scope (repo + branch conditions); broker-ready wait sequencing; `aws ecs wait` timeout tuning                                                          |
| **Phase 5** — Stage DB split | Stage PostgreSQL on EC2, runtime-secret compatibility, stage cutover, free 2 RDS slots for production bootstrap                                                                            | 1.0-1.5           | EC2 bootstrap reliability, PostgreSQL init/user-data sequencing, keeping runtime secret shape compatible                                                                 |
| **Phase 6** — Observability  | CloudWatch alarms (CPU/memory/5xx/unhealthy), log retention policies, Container Insights dashboards, secrets rotation, security-group egress hardening                                     | 1                 | RDS rotation Lambda testing; JWT dual-key window design                                                                                                                  |
| **DNS cutover + buffer**     | Route 53 → ALB, monitoring period, rollback readiness                                                                                                                                      | 0.5               | Pre-lower DNS TTL 24h before cutover; propagation can take up to 48h otherwise                                                                                           |
| **Total**                    |                                                                                                                                                                                            | **~10.5-11 days** |                                                                                                                                                                          |

**Range:** 10 days (no surprises) → 14 days (ECS debugging, broker bootstrap issues, SES verification delays, stage PostgreSQL cutover issues).

**Three highest-risk time sinks:**

1. **Phase 2** — ECS first-deploy debugging is non-linear; t3.micro memory pressure may force task sizing iterations
2. **Phase 1 SES setup** — sender identity verification / sandbox exit can delay real-email readiness
3. **DNS cutover** — forgetting to pre-lower TTL causes up to 48h propagation wait

---

## Risks & Mitigations

| Risk                                       | Impact | Mitigation                                                                                                                                     |
| ------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy data migration issues               | Medium | Initial rollout starts empty; keep pg_dump / restore and `aws s3 sync` as runbooks if historical data must be imported later                   |
| Dedicated RabbitMQ EC2 bootstrap           | Medium | Keep bootstrap simple: single private EC2, one EBS data volume, Dockerized RabbitMQ 3.13, explicit post-boot health check before ECS redeploy  |
| Broker replacement can disrupt queue state | Medium | Mount `/var/lib/rabbitmq` on dedicated EBS volume; avoid unnecessary replacement-causing config churn during normal app deploys                |
| gRPC over Cloud Map latency                | Low    | Cloud Map DNS resolution adds ~1ms; within PAYMENTS_GRPC_TIMEOUT_MS (5000ms) budget                                                            |
| t3.micro memory pressure                   | Medium | Monitor ECS memory utilization; if both tasks OOM, reduce memory limits or upgrade to t3.small                                                 |
| Deploy downtime (stop-before-start)        | Medium | Acceptable for staging. For production: add host headroom or move to larger EC2 capacity for zero-downtime rolling deploys                     |
| NAT instance SPOF                          | Low    | Single AZ NAT instance; if it fails, outbound traffic stops. Use VPC endpoints for critical services (S3, ECR, Secrets Manager) as backup path |
| Free tier expiration (12 months)           | Medium | Budget for ~$105/mo post-free-tier; evaluate larger reserved EC2 capacity or architecture simplifications at that point                        |
| Pulumi state corruption                    | Medium | Use Pulumi Cloud (managed state) or S3 + DynamoDB locking; CI/CD serializes deploys                                                            |

---

## E2E Test Integration into CI/CD

> **Decision: Option A — Post-Deploy Stage Gate**

### Context

A Jest + Supertest e2e test suite exists at `apps/shop/test/e2e/`. It covers:

- Order lifecycle (PENDING → PAID, cancellation + stock restore, idempotency)
- Order querying (GET by ID, list with pagination, cursor pagination, 401/404 edge cases)
- Cart flow (add/upsert/remove items, checkout, empty-cart guard)

The suite runs against a live HTTP stack. It requires a fully deployed shop + payments + postgres + rabbitmq to be meaningful. This rules out PR checks as a host.

### Options evaluated

#### Option A — Post-Deploy Stage Gate ✅ Chosen

Run e2e tests in `deploy-stage.yml` immediately after `aws ecs wait services-stable`. The suite hits the already-deployed stage environment via its public URL.

```
deploy-stage.yml
  ├── Assume stage IAM role (OIDC)
  ├── pulumi up --stack stage
  ├── aws ecs update-service --force-new-deployment
  ├── aws ecs wait services-stable
  ├── E2E gate ← inserted here
  │     ├── npm run test:e2e:shop
  │     └── on failure: block merge, CloudWatch alert
  └── (success) tag image as stable
```

**Why this is correct:**

- Tests run against real infrastructure after every deploy to stage
- Failures block the `deploy-production.yml` trigger (production deploy only fires after stage succeeds)
- No additional infra needed — stage environment already exists post-deploy and is publicly reachable
- Timeout budget is generous: suite takes ~60–90s against a running stack

#### Option B — PR-time compose stack

Spin up `compose.e2e.yml` inside the PR check job, run tests, tear down.

**Rejected because:**

- Heavy: adds ~3–5 min to PR checks (Postgres cold start, migrations, seed)
- Flaky: Docker-in-Docker on GitHub Actions hosted runners is unreliable for multi-container stacks
- Wrong signal: tests pass against a local compose stack but fail against ECS (network config differences)
- Duplicates what integration tests already cover (unit + integration suite already runs on PR)

#### Option C — Nightly scheduled workflow

Separate cron workflow that deploys a fresh environment, runs e2e, tears it down.

**Not chosen now, valid future addition:**

- Good for regression detection against the current production image
- Complements Option A (stage gate catches regressions per-deploy; nightly catches time-based drift)
- Implement after Option A is stable

### AWS migration compatibility

The e2e suite is wire-compatible with AWS — it speaks HTTP/JSON against the public endpoint. Only the base URL changes:

| Environment | `STAGE_VALIDATION_BASE_URL`               | Source                      |
| ----------- | ----------------------------------------- | --------------------------- |
| Local       | `http://localhost:8092` (from `.env.e2e`) | `.env.e2e` file (committed) |
| Stage (AWS) | `https://api-stage.yourdomain.com`        | Pulumi stack output         |
| Production  | not run against production                | N/A                         |

No protocol-level scenario changes are required when switching from local compose to ECS. The stage-validation subset now reads a single `STAGE_VALIDATION_*` contract: `STAGE_VALIDATION_BASE_URL` for target selection, `STAGE_VALIDATION_NAMESPACE` for fixture ownership, and `STAGE_VALIDATION_PRODUCT_ID` / `STAGE_VALIDATION_USER_PASSWORD` for seeded-stage reuse. No extra observability header is needed because Phase 2 custom app metrics stay disabled outside `production`. Built-in ALB / ECS / RDS / EC2 metrics will still include the low-volume stage-validation traffic.

### Data preconditions

- The e2e suite creates its own users at runtime, so no dedicated CI credentials are required today
- The suite still expects existing products with stock, so stage needs migrations + deterministic seed/init data before the e2e gate runs
- Because stage is public, GitHub-hosted runners can hit it directly; no self-hosted runner, VPN, or VPC bridge is needed

### Credentials in CI

Local `.env.e2e` contains non-secret defaults for local compose (committed to the repo). For the AWS stage gate, the workflow derives `STAGE_VALIDATION_BASE_URL` from Pulumi output, derives `STAGE_VALIDATION_NAMESPACE` from a GitHub Environment prefix plus `github.run_id`, reads `STAGE_VALIDATION_PRODUCT_ID` from a GitHub Environment variable, and reads `STAGE_VALIDATION_USER_PASSWORD` from a GitHub Environment secret.

| Variable                         | Local source | CI source                             |
| -------------------------------- | ------------ | ------------------------------------- |
| `STAGE_VALIDATION_BASE_URL`      | `.env.e2e`   | Pulumi `publicEndpointUrl` output     |
| `STAGE_VALIDATION_NAMESPACE`     | N/A          | GitHub Environment variable (`stage`) |
| `STAGE_VALIDATION_PRODUCT_ID`    | N/A          | GitHub Environment variable (`stage`) |
| `STAGE_VALIDATION_USER_PASSWORD` | N/A          | GitHub Environment secret (`stage`)   |

### Implementation plan

#### Step 1 — Now (local, already done)

`compose.e2e.yml` + `jest-e2e.json` + specs exist. Local run:

```bash
npm run e2e:up        # docker compose up (shop + payments + postgres + rabbitmq)
npm run e2e:migrate   # run migrations
npm run e2e:seed      # seed test data
npm run test:e2e:shop # jest --config jest-e2e.json
npm run e2e:down      # docker compose down -v --remove-orphans
```

#### Step 2 — Phase 2 (post-ECS deploy): add e2e gate to `deploy-stage.yml`

```yaml
- name: Run e2e tests
  env:
    STAGE_VALIDATION_BASE_URL: ${{ steps.stack.outputs.public_endpoint_url }}
    STAGE_VALIDATION_NAMESPACE: ${{ env.STAGE_VALIDATION_NAMESPACE }}
    STAGE_VALIDATION_PRODUCT_ID: ${{ vars.STAGE_VALIDATION_PRODUCT_ID }}
    STAGE_VALIDATION_USER_PASSWORD: ${{ secrets.STAGE_VALIDATION_USER_PASSWORD }}
  run: npm run test:e2e:shop:stage
  timeout-minutes: 10
```

Add to GitHub `stage` Environment: `STAGE_VALIDATION_NAMESPACE` variable, `STAGE_VALIDATION_PRODUCT_ID` variable, and `STAGE_VALIDATION_USER_PASSWORD` secret.

Before enabling the gate, ensure stage init flow creates the minimum product catalog the suite expects.

#### Step 3 — Phase 4 (CI/CD update): wire into OIDC deploy flow

The e2e step runs after `aws ecs wait services-stable` and before the optional `tag-as-stable` step. Job-level `needs` ordering ensures production deploy only triggers when the stage e2e gate passes.

```yaml
jobs:
  deploy-stage:
    steps:
      - ... # ecs update-service + wait
      - name: Run e2e tests
        ...
  deploy-production:
    needs: [deploy-stage]   # blocked if e2e fails
    ...
```

#### Step 4 — Future: nightly regression run (Option C)

Once Option A is stable, add a scheduled workflow that runs the e2e suite against the current production image on a nightly cron. This catches time-based drift (expired certs, DB drift, third-party API changes) without blocking deploys.

---

## Cross-references

- Security hardening (TLS, secrets rotation deferred items): `docs/backend/requirements/security-hardening-plan.md` Parts 2, 3, 5
- Current Docker setup: `docs/backend/architecture/infra-docker-compose.md`
- Current CI/CD: `docs/backend/architecture/infra-ci-pipeline.md`
- Observability plan (Pino, metrics): `docs/backend/requirements/observability-plan.md`
- Payments plan (Capture/Refund): `docs/backend/requirements/payments-plan.md`
