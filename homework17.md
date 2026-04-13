# Homework 17 — GitHub Actions CI/CD Pipeline

## Overview

The project uses a four-workflow GitHub Actions pipeline with seven reusable composite actions. The pipeline separates quality gating (PR checks) from artifact production (build & push) and deployment (stage / production), so that a single immutable image artifact is built once and promoted through environments without rebuilding.

> **Infrastructure note:** Both the stage and production deploy targets are **DigitalOcean Droplets** (Ubuntu VMs). These Droplets must be **manually provisioned** before the first deployment — the pipeline does not create or configure servers. This is a known limitation; the full infrastructure is planned to migrate to **AWS** in the near future (at which point provisioning will be handled by Terraform / CDK and this step will be automated).

---

## Pipeline at a Glance

```
Pull Request
    │
    ▼
┌─────────────────────────────────────┐
│  PR Checks  (pr-checks.yml)         │  triggered on: pull_request → development / main
│                                     │
│  code-quality ──────────────────►   │
│     └─ install-dependencies         │
│     └─ code-quality (lint +         │
│           type-check + unit tests)  │
│             │                       │
│             ▼                       │
│  docker-preview-build (matrix)      │
│     └─ shop  ──────── (build only,  │
│     └─ payments          no push)   │
│             │                       │
│             ▼                       │
│  all-checks-passed (sentinel)       │← required status check on branch protection
└─────────────────────────────────────┘
                  │
                  │  merge to development
                  ▼
┌─────────────────────────────────────┐
│  Build and Push (build-and-push.yml)│  triggered on: push → development
│                                     │
│  build-and-push (matrix)            │
│     └─ shop                         │
│     └─ payments                     │
│        → push to GHCR               │
│        → tags: sha-<full-sha>       │
│                + branch name        │
│        → upload image-meta artifact │
│             │                       │
│             ▼                       │
│  release-manifest                   │
│     → merge service metadata        │
│     → upload release-manifest-<sha> │
└─────────────────────────────────────┘
                  │
          ┌───────┴──────────────────────────────────────┐
          │ automatic                                     │ manual (workflow_dispatch)
          ▼                                               ▼
┌──────────────────────────┐             ┌──────────────────────────────┐
│  Deploy — Stage          │             │  Deploy — Production         │
│  (deploy-stage.yml)      │             │  (deploy-production.yml)     │
│                          │             │                              │
│  triggered via:          │             │  inputs:                     │
│  workflow_run on         │             │   • run_id (build run)       │
│  build-and-push success  │             │   • sha (commit SHA)         │
│                          │             │                              │
│  1. checkout @ head_sha  │             │  ⚠️  environment: production  │
│  2. download manifest    │             │     (required reviewers /    │
│  3. parse-release-       │             │      manual approval gate)   │
│     manifest             │             │                              │
│  4. deploy-to-stage      │             │  1. checkout @ inputs.sha    │
│     (SSH → Docker pull   │             │  2. download manifest        │
│      + compose up)       │             │  3. parse-release-manifest   │
│  5. smoke-test-shop      │             │  4. deploy-to-production     │
│     (health + ready      │             │     (SSH → Docker pull       │
│      + status)           │             │      + compose up)           │
│  6. write-deploy-summary │             │  5. smoke-test-shop          │
└──────────────────────────┘             │  6. write-deploy-summary     │
                                         └──────────────────────────────┘
```

---

## Workflow Details

### 1. PR Checks (`pr-checks.yml`)

**Trigger:** `pull_request` targeting `development` or `main`

**Concurrency:** Cancels in-progress runs for the same PR on new push (fast feedback).

```
┌──────────────────────────────────────────────────────────────────┐
│  Job: code-quality                                               │
│                                                                  │
│   Step 1 · checkout                                              │
│   Step 2 · install-dependencies  ←─── composite action          │
│              └─ setup-node (with npm cache)                      │
│              └─ npm ci                                           │
│   Step 3 · code-quality          ←─── composite action          │
│              └─ npm run lint:ci                                   │
│              └─ npm run type-check                               │
│              └─ npm run test:cov                                  │
│              └─ upload coverage artifact (retention: 7d)         │
└──────────────────────────────────────────────────────────────────┘
                          │ needs: code-quality
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Job: docker-preview-build  [matrix: shop | payments]            │
│                                                                  │
│   Step 1 · checkout                                              │
│   Step 2 · setup-buildx                                          │
│   Step 3 · build production image  (push: false)                 │
│              └─ GHA layer cache per service                      │
│              └─ target: prod-distroless-<app>                    │
└──────────────────────────────────────────────────────────────────┘
                          │ needs: [code-quality, docker-preview-build]
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Job: all-checks-passed  (if: always)                            │
│                                                                  │
│   Sentinel job — single required status check entry in branch    │
│   protection. Fails if any upstream job failed / cancelled /     │
│   skipped. Writes PR summary table to GitHub Step Summary.       │
└──────────────────────────────────────────────────────────────────┘
```

---

### 2. Build and Push (`build-and-push.yml`)

**Trigger:** `push` to `development`

**Concurrency:** One run per commit SHA; `cancel-in-progress: false` — every merged commit gets an artifact.

```
┌──────────────────────────────────────────────────────────────────┐
│  Job: build-and-push  [matrix: shop | payments]  (fail-fast: off)│
│                                                                  │
│   Step 1 · checkout                                              │
│   Step 2 · docker/login-action → GHCR (GITHUB_TOKEN)            │
│   Step 3 · docker/metadata-action                                │
│              └─ tag: sha-<full-sha>   (immutable, deploy ref)    │
│              └─ tag: <branch-name>    (mutable, convenience)     │
│   Step 4 · setup-buildx                                          │
│   Step 5 · docker/build-push-action                              │
│              └─ context: .  file: Dockerfile                     │
│              └─ target: prod-distroless-<app>                    │
│              └─ push: true → ghcr.io/<org>/<repo>/<app>          │
│              └─ GHA layer cache per service                      │
│   Step 6 · save metadata JSON  { image, digest }                 │
│   Step 7 · upload-artifact: image-meta-<app>  (retention: 30d)  │
└──────────────────────────────────────────────────────────────────┘
                          │ needs: build-and-push
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Job: release-manifest                                           │
│                                                                  │
│   Step 1 · download-artifact (pattern: image-meta-*)            │
│   Step 2 · assemble release-manifest.json                        │
│              └─ { commit, ref, services: { shop, payments } }    │
│   Step 3 · print manifest                                        │
│   Step 4 · upload-artifact: release-manifest-<sha>              │
│              └─ retention: 90d                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

### 3. Deploy — Stage (`deploy-stage.yml`)

**Trigger:** `workflow_run` on "Build and Push" completion (branch: `development`, conclusion: `success`)

**Concurrency:** `cancel-in-progress: false` — never interrupts a running deploy.

**Environment:** `stage` (scoped secrets / variables)

```
┌──────────────────────────────────────────────────────────────────┐
│  Job: deploy  (environment: stage)                               │
│                                                                  │
│   Step 1 · checkout @ workflow_run.head_sha                      │
│   Step 2 · download-artifact: release-manifest-<sha>             │
│   Step 3 · parse-release-manifest  ←── composite action          │
│              └─ outputs: commit, ref, shop-image,                │
│                          shop-digest, payments-image,            │
│                          payments-digest                         │
│   Step 4 · deploy-to-stage  ←─────── composite action            │
│              └─ SSH into stage VM                                │
│              └─ decode base64 .env files                         │
│              └─ docker login GHCR                                │
│              └─ docker pull both images                          │
│              └─ git checkout <sha> on VM                         │
│              └─ generate image override compose files            │
│              └─ compose up payments (rd_shop_backend_payments_stage)
│              └─ compose up shop    (rd_shop_backend_shop_stage)  │
│   Step 5 · smoke-test-shop  ←──────── composite action           │
│              └─ SSH: poll /health  (24×5s, ~2 min max)           │
│              └─ SSH: assert /ready  (hard deps)                  │
│              └─ SSH: log /status    (informational)              │
│   Step 6 · write-deploy-summary  (if: always)  ←── composite     │
└──────────────────────────────────────────────────────────────────┘
```

**Required secrets (stage environment):**

| Secret              | Description                                   |
| ------------------- | --------------------------------------------- |
| `SSH_PRIVATE_KEY`   | Private key for deploy user on stage VM       |
| `ENV_FILE_SHOP`     | Base64-encoded `.env.production` for shop     |
| `ENV_FILE_PAYMENTS` | Base64-encoded `.env.production` for payments |
| `GHCR_TOKEN`        | GitHub PAT with `read:packages` scope         |

**Required variables (stage environment):**

| Variable     | Description                                            |
| ------------ | ------------------------------------------------------ |
| `SSH_HOST`   | Hostname / IP of the stage VM                          |
| `SSH_USER`   | SSH username                                           |
| `DEPLOY_DIR` | Absolute path to repo checkout on the VM               |
| `BASE_URL`   | Internal URL of shop app, e.g. `http://localhost:8080` |

> **Deploy target:** DigitalOcean Droplet — must be manually provisioned (Docker + Docker Compose installed, deploy user with SSH key added, repo cloned to `DEPLOY_DIR`, shared Docker network created) before this workflow can succeed.

---

### 4. Deploy — Production (`deploy-production.yml`)

**Trigger:** Manual `workflow_dispatch` (controlled promotion / rollback)

**Inputs:**

| Input    | Description                       |
| -------- | --------------------------------- |
| `run_id` | build-and-push run ID to deploy   |
| `sha`    | Commit SHA that produced that run |

**Concurrency:** `cancel-in-progress: false`

**Environment:** `production` — configure required reviewers in GitHub → Settings → Environments for a manual approval gate before the job runs.

```
┌──────────────────────────────────────────────────────────────────┐
│  Job: deploy  (environment: production)                          │
│                                                                  │
│              ⚠️  Manual approval gate (required reviewers)       │
│                          │                                       │
│                          ▼                                       │
│   Step 1 · checkout @ inputs.sha                                 │
│   Step 2 · download-artifact: release-manifest-<sha>             │
│              └─ run-id: inputs.run_id                            │
│   Step 3 · parse-release-manifest                                │
│   Step 4 · deploy-to-production  ←── composite action            │
│              └─ same SSH + pull + compose up flow as stage       │
│              └─ project names: rd_shop_backend_{payments,shop}_prod
│              └─ git checkout <sha> ensures compose/image sync    │
│                 (also enables reliable rollbacks)                │
│   Step 5 · smoke-test-shop                                       │
│   Step 6 · write-deploy-summary  (if: always)                    │
└──────────────────────────────────────────────────────────────────┘
```

> **Deploy target:** DigitalOcean Droplet — must be manually provisioned (Docker + Docker Compose installed, deploy user with SSH key added, repo cloned to `DEPLOY_DIR`, shared Docker network created) before this workflow can succeed.

**Rollback procedure:**

```
For rollback, re-run workflow_dispatch with the run_id and sha
of any previous successful Build and Push run.
The matched compose files and images are always in sync because
the VM is checked out at exactly that commit SHA.
```

---

## Reusable Composite Actions

All actions live under `.github/actions/` and are referenced by relative path within workflows.

```
.github/actions/
├── install-dependencies/    Setup Node.js + npm ci
├── code-quality/            lint:ci + type-check + test:cov + upload coverage
├── parse-release-manifest/  Read release-manifest.json → step outputs
├── deploy-to-stage/         SSH → pull images → compose up (stage)
├── deploy-to-production/    SSH → pull images → compose up (production)
├── smoke-test-shop/         SSH → /health → /ready → /status polling
└── write-deploy-summary/    Append deploy table to GitHub Step Summary
```

### Action dependency map

```
pr-checks.yml
  └─ install-dependencies
  └─ code-quality

build-and-push.yml
  (no local composite actions — uses docker/* marketplace actions)

deploy-stage.yml
  └─ parse-release-manifest
  └─ deploy-to-stage
  └─ smoke-test-shop
  └─ write-deploy-summary

deploy-production.yml
  └─ parse-release-manifest
  └─ deploy-to-production
  └─ smoke-test-shop
  └─ write-deploy-summary
```

---

## Artifact Flow

```
build-and-push run
       │
       ├─ artifact: image-meta-shop      ─────┐
       ├─ artifact: image-meta-payments  ─────┤
       │                                      │
       │         release-manifest job         │
       │              downloads both ◄────────┘
       │              merges → release-manifest.json
       │
       └─ artifact: release-manifest-<sha>   ───► deploy-stage.yml
                                              ───► deploy-production.yml
```

Artifact retention: image-meta — 30 days · release-manifest — 90 days

---

## Image Tagging Strategy

| Tag                  | Type      | Purpose                                                 |
| -------------------- | --------- | ------------------------------------------------------- |
| `sha-<full-git-sha>` | Immutable | Primary deployment reference; never overwritten         |
| `<branch-name>`      | Mutable   | Convenience alias; updated on every push to that branch |

Images are pushed to: `ghcr.io/<org>/<repo>/<service>:<tag>`

---

## Branch & Environment Strategy

```
feature/* ──► development ──► (auto) stage ──► (manual) production
                │                                        │
                └─ PR Checks gate                        └─ approval gate
                   (required status check)                 (required reviewers)
```

| Branch        | Protection rules                           |
| ------------- | ------------------------------------------ |
| `development` | Required status check: `All Checks Passed` |
| `main`        | Required status check: `All Checks Passed` |

---

## Infrastructure

### Current deployment targets

Both environments run on **DigitalOcean Droplets** (Ubuntu VMs). Docker Compose is used directly on each Droplet; there is no container orchestration layer (Kubernetes / ECS) at this time.

| Environment | Provider     | Type             | Notes                                        |
| ----------- | ------------ | ---------------- | -------------------------------------------- |
| stage       | DigitalOcean | Droplet (Ubuntu) | Auto-deployed on every push to `development` |
| production  | DigitalOcean | Droplet (Ubuntu) | Manual `workflow_dispatch` + approval gate   |

### Manual server provisioning (prerequisite)

Each Droplet must be set up **once** before the pipeline can deploy to it. The pipeline assumes the following are already in place:

```
1. Docker Engine + Docker Compose plugin installed
2. A deploy user created with the SSH public key matching SSH_PRIVATE_KEY secret
3. Repository cloned to DEPLOY_DIR on the Droplet
4. Shared Docker bridge network created:
     docker network create rd_shop_backend_dev_shared
5. GitHub Environments (stage / production) configured in the repository settings
   with all required secrets and variables (see secrets tables in workflow details above)
```

The pipeline will fail at the SSH step if any of the above prerequisites are missing.

### Known limitation & migration plan

> Manual Droplet provisioning is a known limitation of the current setup. We plan to migrate the entire infrastructure to **AWS** in the near future. Once migrated, server provisioning will be fully automated (Terraform / AWS CDK), eliminating this manual step and enabling auto-scaling, managed databases, and consolidated observability.

---

## Security Considerations

- **GITHUB_TOKEN** is used only for GHCR push during build; deploy VMs authenticate with a scoped PAT (`GHCR_TOKEN` with `read:packages` only).
- **SSH keys** are stored as environment-scoped secrets; the private key never appears in logs.
- **`.env` files** are stored base64-encoded as secrets and decoded on the VM at deploy time; they are never committed to the repository.
- **Distroless images** shipped to both environments have no shell — even if a container is compromised, there is no interpreter to execute arbitrary code.
- **Non-root runtime** — containers run as UID 1001 / 65532.
- **Immutable image tags** — each deploy references an exact digest (`sha-<sha>`), preventing tag mutation attacks.
- **Production approval gate** — the `production` GitHub Environment must be configured with required reviewers to prevent accidental or unauthorized production deploys.

---

## Evidences

Visual evidence of the CI/CD pipeline in action — workflow runs and branch protection settings — is documented in [ci-cd-evidences/index.md](ci-cd-evidences/index.md).
