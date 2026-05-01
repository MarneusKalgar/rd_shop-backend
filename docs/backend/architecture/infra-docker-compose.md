# rd_shop — Docker & Compose

This page documents the container image pipeline and the compose profiles kept in the repo for local dev, e2e, perf, and self-hosted flows.
The deployed AWS stage/prod runtime is described in [infra-aws.md](infra-aws.md); the compose topology below is not the active cloud deployment surface.

## Dockerfile (multi-stage production)

```
deps          npm ci --omit=dev (prod deps only)
build         npm ci + nest build (all apps) + proto copied to dist/apps/*/proto/
prune         npm prune --omit=dev
prod-base     Non-root user nestjs:1001, tini init system
  ↳ prod-distroless-shop       Minimal runtime — default shop image
  ↳ prod-distroless-payments   Minimal runtime — default payments image
  ↳ prod-shop                  Debug profile variant (full shell, with --target prod-shop)
  ↳ prod-payments              Debug profile variant
```

Build arg `APP` selects which entrypoint is packaged (`shop` or `payments`).

## Dockerfile.dev

Single-stage; installs build tools (`python3`, `make`, `g++`) for native modules.  
Same non-root user `nestjs:1001`.  
Command is overridden in compose: proto copy → `npm run start:dev` (hot reload).

## Networks (compose production profile)

| Network                       | Scope                | Who joins                             |
| ----------------------------- | -------------------- | ------------------------------------- |
| `shop-network`                | External-facing      | shop, minio (S3 ports exposed)        |
| `shop-network-internal`       | Isolated             | shop, postgres, rabbitmq              |
| `payments-network-internal`   | Isolated             | payments, postgres (payments)         |
| `rd_shop_backend_prod_shared` | Inter-service bridge | shop + payments: gRPC cross-container |

`rd_shop_backend_prod_shared` is created by the payments compose and declared `external` in the shop compose — both must be started for gRPC to work.

## Shop compose (self-hosted production profile) — `apps/shop/compose.yml`

| Service      | Image                           | Key Config                                                                        |
| ------------ | ------------------------------- | --------------------------------------------------------------------------------- |
| `shop`       | distroless-shop                 | Port 8080. Healthcheck: `/health`. Depends on postgres (healthy), minio, rabbitmq |
| `shop-debug` | prod-shop (profile: debug)      | Same but full shell; no external shared network                                   |
| `postgres`   | postgres:16-alpine              | Internal only. Named volume `postgres_data`                                       |
| `minio`      | minio/minio:latest              | Ports 9000 (S3), 9001 (console). Named volume `minio_data`                        |
| `minio-init` | minio/mc                        | One-shot: creates bucket + policy on startup                                      |
| `rabbitmq`   | rabbitmq:3.13-management-alpine | Ports 5672, 15672 (mgmt). Named volume `rabbitmq_data`                            |
| `migrate`    | prod-shop (profile: tools)      | Runs DB migrations once, exits. Depends on postgres (healthy)                     |
| `seed`       | prod-shop (profile: tools)      | Seeds DB, exits. Depends on migrate completing                                    |

## Payments compose (self-hosted production profile) — `apps/payments/compose.yml`

| Service    | Image                          | Key Config                                                                 |
| ---------- | ------------------------------ | -------------------------------------------------------------------------- |
| `payments` | distroless-payments            | No exposed ports (gRPC internal only). Joins `rd_shop_backend_prod_shared` |
| `postgres` | postgres:16-alpine             | Separate DB from shop. Internal only                                       |
| `migrate`  | prod-payments (profile: tools) | Migrations for payments DB                                                 |

## Dev composes — `compose.dev.yml` (both apps)

- Uses `Dockerfile.dev` with bind mounts `/app/apps`, `/app/proto`
- `node_modules` is a named volume (not bind-mounted — prevents host pollution)
- Shop dev command: copy proto → `npm run start:dev`
- Payments dev command: copy proto → `npm run start:dev`
- Dev shared bridge: `rd_shop_backend_dev_shared` (separate from prod)
- MinIO console (9001) and RabbitMQ management (15672) exposed in dev

## Proto file handling in containers

```
Prod (build stage):    proto file copied to dist/apps/{app}/proto/ during nest build
Dev (runtime):         compose.dev.yml: cp /app/proto/payments.proto /app/apps/{app}/src/proto/
```

`apps/shop/src/proto/` and `apps/payments/src/proto/` are gitignored — always populated at build/boot time.
