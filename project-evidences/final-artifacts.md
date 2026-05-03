# RD Shop — Final Artifacts

This file maps the required submission artifacts from section 7 of [.temp/final-raw.md](../.temp/final-raw.md) to concrete files, screenshots, URLs, and reviewer entrypoints.

## 7.1 Repository with source code

- Repository: https://github.com/MarneusKalgar/rd_shop-backend
- Infrastructure code: [infra/](../infra/)
- Application code: [apps/shop/](../apps/shop/) and [apps/payments/](../apps/payments/)

## 7.2 README with system description, main loop, local launch, tests, configuration, deployed service link

- Main [README](../README.md)
- Deployed stage service: https://dxkl8eocmyjhj.cloudfront.net
- Deployed production service: https://d1bupksw8nr8i8.cloudfront.net
- Stage status endpoint: https://dxkl8eocmyjhj.cloudfront.net/status
- Production status endpoint: https://d1bupksw8nr8i8.cloudfront.net/status
- Main business loop: [order creation flow](../docs/backend/architecture/feature-order-creation-flow.md)
- Final result retrieval flow: [order querying flow](../docs/backend/architecture/feature-order-querying-flow.md)

## 7.3 Docker configuration for local launch

- Root [Dockerfile](../Dockerfile) and [Dockerfile.dev](../Dockerfile.dev)
- Shop local/dev compose: [compose.yml](../apps/shop/compose.yml), [compose.dev.yml](../apps/shop/compose.dev.yml)
- Payments local/dev compose: [compose.yml](../apps/payments/compose.yml), [compose.dev.yml](../apps/payments/compose.dev.yml)
- Shop e2e stack for production-like local full-stack checks: [compose.e2e.yml](../apps/shop/compose.e2e.yml)
- Shop performance stack: [compose.perf.yml](../apps/shop/compose.perf.yml)
- Local Docker instructions in the main [README](../README.md)

### Raw docker compose commands without npm wrappers

Use distinct app-scoped project names to avoid `postgres` / `migrate` collisions:

```bash
docker network create rd_shop_backend_dev_shared || true

BASE=reviewer01

docker compose --project-name "${BASE}_payments_dev" \
  -f apps/payments/compose.yml -f apps/payments/compose.dev.yml up

docker compose --project-name "${BASE}_shop_dev" \
  -f apps/shop/compose.yml -f apps/shop/compose.dev.yml up

docker compose --project-name "${BASE}_payments_dev" \
  -f apps/payments/compose.yml -f apps/payments/compose.dev.yml run --rm migrate

docker compose --project-name "${BASE}_shop_dev" \
  -f apps/shop/compose.yml -f apps/shop/compose.dev.yml run --rm migrate

docker compose --project-name "${BASE}_shop_dev" \
  -f apps/shop/compose.yml -f apps/shop/compose.dev.yml run --rm seed
```

If production-like local behavior is needed, prefer the e2e stack instead of the deprecated per-app prod compose shortcuts:

```bash
cd apps/shop && npm run e2e:fresh
```

## 7.4 Brief architecture description or diagram

- Service-oriented monorepo overview: [infra-monorepo](../docs/backend/architecture/infra-monorepo.md)
- AWS deployment topology: [infra-aws](../docs/backend/architecture/infra-aws.md)
- Docker/compose topology: [infra-docker-compose](../docs/backend/architecture/infra-docker-compose.md)
- Main order lifecycle and async path: [feature-order-creation-flow](../docs/backend/architecture/feature-order-creation-flow.md)

Deployment / secrets note:

- AWS migration is the active production path; local Docker Compose remains for development, e2e, and performance workflows only.
- Deploy-time Pulumi secrets now come from Pulumi ESC environments `rd-shop/stage` and `rd-shop/production`.
- Runtime secrets/config are delivered through AWS Secrets Manager + SSM Parameter Store into ECS task definitions.
- Deploy-time secrets were rotated during the Pulumi ESC migration cutover.

Infrastructure screenshots:

- VPC: [project-evidences/aws-infrastructure/vpc.png](aws-infrastructure/vpc.png)
- ALB: [project-evidences/aws-infrastructure/alb.png](aws-infrastructure/alb.png)
- CloudFront: [project-evidences/aws-infrastructure/cloudfront.png](aws-infrastructure/cloudfront.png)
- ECS / EC2 capacity: [project-evidences/aws-infrastructure/ec2.png](aws-infrastructure/ec2.png)
- RDS: [project-evidences/aws-infrastructure/rds.png](aws-infrastructure/rds.png)
- S3: [project-evidences/aws-infrastructure/s3.png](aws-infrastructure/s3.png)
- ECR: [project-evidences/aws-infrastructure/ecr.png](aws-infrastructure/ecr.png)
- IAM roles / policies: [project-evidences/aws-infrastructure/iam-roles.png](aws-infrastructure/iam-roles.png), [project-evidences/aws-infrastructure/iam-policies.png](aws-infrastructure/iam-policies.png)

## 7.5 API description

Primary externally reviewed API surface is the `shop` service.

Core REST endpoints used by the end-to-end loop:

- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/signin`
- `GET /api/v1/products`
- `POST /api/v1/cart/items`
- `POST /api/v1/cart/checkout`
- `GET /api/v1/orders`
- `GET /health`, `GET /ready`, `GET /status`

Additional API surfaces:

- GraphQL endpoint: `/graphql` in all environments; only introspection and playground are disabled in production
- Swagger/OpenAPI UI: `/api-docs` when running locally in non-production mode

Representative API request/response evidence:

- Signup: [project-evidences/e2e-order-flow-production/00-signup-postman.png](e2e-order-flow-production/00-signup-postman.png)
- Signin: [project-evidences/e2e-order-flow-production/01-signin-postman.png](e2e-order-flow-production/01-signin-postman.png)
- Products query: [project-evidences/e2e-order-flow-production/02-get-products-postman.png](e2e-order-flow-production/02-get-products-postman.png)
- Add to cart: [project-evidences/e2e-order-flow-production/03-add-to-cart-postman.png](e2e-order-flow-production/03-add-to-cart-postman.png)
- Checkout: [project-evidences/e2e-order-flow-production/04-cart-checkout-postman.png](e2e-order-flow-production/04-cart-checkout-postman.png)
- Orders query: [project-evidences/e2e-order-flow-production/05-get-orders-postman.png](e2e-order-flow-production/05-get-orders-postman.png)

## 7.6 Logging and monitoring evidence

Application log evidence:

- Signup logs: [project-evidences/e2e-order-flow-production/00-signup-container-logs.png](e2e-order-flow-production/00-signup-container-logs.png)
- Signin logs: [project-evidences/e2e-order-flow-production/01-signin-container-logs.png](e2e-order-flow-production/01-signin-container-logs.png)
- Add-to-cart logs: [project-evidences/e2e-order-flow-production/03-add-to-cart-container-logs.png](e2e-order-flow-production/03-add-to-cart-container-logs.png)
- Checkout logs: [project-evidences/e2e-order-flow-production/04-cart-checkout-container-logs.png](e2e-order-flow-production/04-cart-checkout-container-logs.png)
- Payment authorization logs: [project-evidences/e2e-order-flow-production/04-authorize-payment-shop-container-logs.png](e2e-order-flow-production/04-authorize-payment-shop-container-logs.png)
- Orders query logs: [project-evidences/e2e-order-flow-production/05-get-orders-container-logs.png](e2e-order-flow-production/05-get-orders-container-logs.png)

Monitoring / observability evidence:

- CloudWatch overview: [project-evidences/aws-observability/cloudwatch-overview.png](aws-observability/cloudwatch-overview.png)
- Stage dashboard: [project-evidences/aws-observability/cloudwatch-stage-dashboard.png](aws-observability/cloudwatch-stage-dashboard.png)
- Production dashboard panels: [project-evidences/aws-observability/cloudwatch-prod-dashboard-00.png](aws-observability/cloudwatch-prod-dashboard-00.png), [project-evidences/aws-observability/cloudwatch-prod-dashboard-01.png](aws-observability/cloudwatch-prod-dashboard-01.png), [project-evidences/aws-observability/cloudwatch-prod-dashboard-02.png](aws-observability/cloudwatch-prod-dashboard-02.png)

## 7.7 Pipeline confirmation

- Pipeline architecture note: [infra-ci-pipeline](../docs/backend/architecture/infra-ci-pipeline.md)
- PR checks: [project-evidences/pipelines/pr-checks.png](pipelines/pr-checks.png)
- Build and push: [project-evidences/pipelines/build-and-push.png](pipelines/build-and-push.png)
- Stage deploy: [project-evidences/pipelines/deploy-stage.png](pipelines/deploy-stage.png)
- Stage validation e2e: [project-evidences/pipelines/stage-validation-e2e.png](pipelines/stage-validation-e2e.png)
- Production deploy: [project-evidences/pipelines/deploy-prod.png](pipelines/deploy-prod.png)

## Reviewer Quick Path

1. Read the main [README](../README.md) for local launch and test commands.
2. Use either deployed service for review:
   Stage: `https://dxkl8eocmyjhj.cloudfront.net`
   Production: `https://d1bupksw8nr8i8.cloudfront.net`
3. Prefer stage when you want pre-seeded reviewer data; production is useful for proving the same flow on the live stack.
4. Follow the order-flow evidence in [e2e-order-flow-production/](e2e-order-flow-production/).
5. Use the observability and pipeline screenshots above for section-7 proof points.
