# rd_shop — Monorepo & Microservices Structure

## Two-App NestJS Monorepo

| App        | Entry                       | Port | Transports                                         | Notes                       |
| ---------- | --------------------------- | ---- | -------------------------------------------------- | --------------------------- |
| `shop`     | `apps/shop/src/main.ts`     | 8080 | HTTP REST, GraphQL, RabbitMQ consumer, gRPC client | Primary user-facing service |
| `payments` | `apps/payments/src/main.ts` | 5001 | gRPC server only                                   | Internal payment processor  |

## nest-cli.json

Root `compilerOptions` apply to both apps. Two named projects (`shop`, `payments`) each with own `entryFile`, `sourceRoot`, and `assets` (proto copy).

## TypeScript configuration hierarchy

```
tsconfig.json (root)            CommonJS, ES2023, strictNullChecks, no-emit
  ↳ tsconfig.build.json         Excludes test/, dist/, **/*spec.ts
      ↳ apps/shop/tsconfig.app.json     @/* → src/*; outDir: dist/apps/shop
      ↳ apps/payments/tsconfig.app.json @/* → src/*; outDir: dist/apps/payments
```

Both apps share the same `@/*` alias pattern (resolves to their own `src/`).  
Test path aliases (`@test/*`) only exist in `apps/shop/test/tsconfig.json`.

## What is shared vs. separate

| Concern                  | Shared                    | Separate                                                 |
| ------------------------ | ------------------------- | -------------------------------------------------------- |
| `node_modules`           | ✅ single root            | —                                                        |
| `package.json` (scripts) | ✅ root coordinates       | Each app has own for dev scripts                         |
| TypeScript base config   | ✅ root `tsconfig.json`   | —                                                        |
| Proto source of truth    | ✅ `proto/payments.proto` | Copied to `apps/*/src/proto/` on build                   |
| Database                 | —                         | ✅ each app has its own Postgres instance                |
| Environment files        | —                         | ✅ each app: `.env.development`, `.env.production`, etc. |
| Migrations               | —                         | ✅ separate migration directories                        |

## Build

```bash
npm run build          # builds both apps
nest build shop        # single app
nest build payments    # single app
```

Output: `dist/apps/shop/` and `dist/apps/payments/`  
Proto files copied to `dist/apps/{app}/proto/` via `nest-cli.json` assets.

## Communication between services

```
shop ──gRPC──► payments   (PaymentsGrpcService → PAYMENTS_GRPC_CLIENT → port 5001)
```

In production, both apps join the shared Docker network `rd_shop_backend_prod_shared` (defined in payments compose, referenced as external in shop compose).

## No shared NestJS library / no shared modules

Each app is fully self-contained — no `libs/` directory. The only cross-app contract is the gRPC proto file loaded at runtime.
