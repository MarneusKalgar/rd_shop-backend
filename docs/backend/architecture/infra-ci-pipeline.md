# rd_shop — CI/CD Pipeline

## Primary workflow files (`.github/workflows/`)

| File                    | Trigger                                                           | Purpose                                                                                                             |
| ----------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pr-checks.yml`         | PR → `development`, `main`, `release/*`                           | Quality gate for app and infra code                                                                                 |
| `build-and-push.yml`    | Push → `development`                                              | Build both service images, push to ECR, publish release manifest artifact                                           |
| `deploy-stage.yml`      | `workflow_run` after successful `Build and Push` on `development` | Apply stage Pulumi stack with selected release images, run DB init, restore ECS services, dispatch stage validation |
| `stage-validation.yml`  | Manual dispatch or dispatched from `deploy-stage.yml`             | Seed namespaced validation data, run deployed e2e suite against stage, clean up                                     |
| `deploy-production.yml` | Manual `workflow_dispatch`                                        | Apply approved production Pulumi stack with selected release images, run DB init, restore ECS services              |

Repository also contains `*-test.yml` rehearsal variants. The active delivery path is the non-`-test` workflow set above.

## `pr-checks.yml` job graph

```text
install ──► code-quality ──┬──► integration-tests   ──┐
                           └──► docker-preview-build ──┴──► all-checks-passed
```

- `install`: restores and saves root `node_modules` and `infra/node_modules` caches; runs `npm ci` / `npm ci --prefix infra` only on cache miss.
- `code-quality`: runs the shared composite for lint, type-check, and unit tests.
- `integration-tests`: runs `npm run test:integration:shop:cov` and uploads `coverage-integration/`.
- `docker-preview-build`: validates that both production Docker targets build successfully without pushing.
- `all-checks-passed`: single branch-protection sentinel that fails if any upstream job failed, was cancelled, or was skipped.

## `build-and-push.yml`

- Uses GitHub OIDC to assume the AWS build role (`AWS_ROLE_ARN_BUILD`); no static AWS access keys.
- Builds `shop` and `payments` images and pushes them to ECR under `rd-shop/<app>`.
- Publishes immutable `sha-<full-sha>` tags and branch tags.
- Uploads `release-manifest-<sha>` as the deployment source of truth for stage and production.

## `deploy-stage.yml`

- Triggered automatically when `Build and Push` succeeds for `development`.
- Downloads the release manifest, extracts the ECR image URIs, and writes them into the stage Pulumi stack config.
- Quiesces existing ECS services to desired count `0`, applies the stage stack with `pulumi up`, then runs one-off ECS migration/init tasks.
- If stage uses `ec2-postgres`, waits for the bootstrap host through SSM before DB init.
- Restores the saved ECS desired counts, forces a rollout, waits for service stabilization, and runs the HTTP smoke test.
- Dispatches `stage-validation.yml` after deploy success.

## `stage-validation.yml`

- Reads live stage outputs from the Pulumi stack, including `publicEndpointUrl`.
- Seeds isolated validation data through one-off ECS tasks (`dist/apps/shop/db/stage-validation/seed.js`).
- Runs the deployed e2e suite with `npm run test:e2e:shop:stage` against `STAGE_VALIDATION_BASE_URL`.
- Cleans up the namespace-scoped validation data with `dist/apps/shop/db/stage-validation/cleanup.js`.

## `deploy-production.yml`

- Manual `workflow_dispatch` with `run_id` and `sha`, so production deploys consume an already-built artifact rather than rebuilding.
- Uses the `production` GitHub Environment as the approval gate.
- Repeats the same high-level flow as stage: manifest download, Pulumi config update, ECS quiesce, `pulumi up`, DB init tasks, ECS restore, stabilization wait, smoke test, deploy summary.
- No automatic production e2e validation workflow exists yet; only smoke checks run inside the deploy flow.

## Active composite actions (`.github/actions/`)

| Action                   | Used by active AWS workflows          |
| ------------------------ | ------------------------------------- |
| `code-quality`           | `pr-checks.yml`                       |
| `parse-release-manifest` | stage and production deploy workflows |
| `smoke-test-shop-http`   | stage and production deploy workflows |
| `write-deploy-summary`   | stage and production deploy workflows |

`deploy-to-stage`, `deploy-to-production`, and `smoke-test-shop` remain in the repo as older self-hosted helpers, but the current AWS workflows do not call them.

## Artifact and credential model

- Release artifacts are keyed by commit SHA and retained long enough to support controlled production deploys and rollbacks.
- AWS access in CI uses GitHub OIDC roles (`AWS_ROLE_ARN_BUILD`, `AWS_ROLE_ARN`) instead of long-lived keys.
- Pulumi Cloud access remains environment-scoped via `PULUMI_ACCESS_TOKEN`.
- Active deploy workflows do not use SSH keys or VM-side `.env` files.
