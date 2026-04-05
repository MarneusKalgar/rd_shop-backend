# rd_shop — CI/CD Pipeline

## Workflow files (`.github/workflows/`)

| File                    | Trigger                                 | Purpose                              |
| ----------------------- | --------------------------------------- | ------------------------------------ |
| `pr-checks.yml`         | PR → `development`, `main`, `release/*` | Quality gate                         |
| `build-and-push.yml`    | Push → `development`                    | Build + publish images to GHCR       |
| `deploy-stage.yml`      | After build-and-push                    | Auto-deploy to stage VM              |
| `deploy-production.yml` | Manual `workflow_dispatch`              | Production deploy with approval gate |

## pr-checks.yml job graph

```
install ──► code-quality ──┬──► integration-tests   ──┐
                           └──► docker-preview-build ──┴──► all-checks-passed
```

- **install**: `npm ci` on cache miss; saves `node_modules` keyed `node-modules-${{ runner.os }}-${{ hashFiles('package-lock.json') }}`
- **code-quality**: restores cache, runs `code-quality` composite action (lint, type-check, unit tests)
- **integration-tests**: `needs: code-quality`; `timeout-minutes: 15`; restores cache; runs `npm run test:integration:shop` (Testcontainers, Docker pre-installed on ubuntu-latest)
- **docker-preview-build**: matrix `[shop, payments]`; `docker/build-push-action@v7`; GHA cache per app scope; push: false
- **all-checks-passed**: `if: always()`; sentinel job added to branch protection; writes step summary table

## build-and-push.yml

- Builds both service images; pushes with immutable `sha-<full-sha>` tag
- Assembles `release-manifest-<sha>.json` artifact (image refs + digests); 90-day retention
- Single source of truth for both deploy workflows

## deploy-stage.yml

- Auto-triggered after successful build-and-push
- SSHs into stage VM; pulls pre-built images; runs Docker Compose
- Three-phase smoke test: `/health` → `/ready` → `/status`

## deploy-production.yml

- Manual `workflow_dispatch`; inputs: `run_id`, `sha`
- `production` GitHub Environment — required reviewers approval gate
- Checks out exact commit SHA on target VM for reliable rollback

## Composite actions (`.github/actions/`)

| Action                   | Purpose                               |
| ------------------------ | ------------------------------------- |
| `install-dependencies`   | `npm ci` + cache                      |
| `code-quality`           | lint + type-check + unit tests        |
| `parse-release-manifest` | Read image refs from release artifact |
| `deploy-to-stage`        | SSH + compose up on stage             |
| `deploy-to-production`   | SSH + compose up on prod              |
| `smoke-test-shop`        | HTTP health probe sequence            |
| `write-deploy-summary`   | GitHub step summary table             |

## Image tags

Format: `sha-<full-git-sha>` — immutable, prevents tag mutation.  
Digests stored in release manifest and logged in every step summary.

## Secrets

- `stage` and `production` are separate GitHub Environments with separate SSH keys, env files, GHCR tokens
- No cross-environment secret access
