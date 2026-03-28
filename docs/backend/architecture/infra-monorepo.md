# rd_shop — Monorepo & Microservices Structure

## Two-App NestJS Monorepo

| App        | Entry                       | Port | Transports                                         | Notes                       |
| ---------- | --------------------------- | ---- | -------------------------------------------------- | --------------------------- |
| `shop`     | `apps/shop/src/main.ts`     | 8080 | HTTP REST, GraphQL, RabbitMQ consumer, gRPC client | Primary user-facing service |
| `payments` | `apps/payments/src/main.ts` | 5001 | gRPC server only                                   | Internal payment processor  |

## nest-cli.json

Root `compilerOptions` apply to both apps. Three named projects (`shop`, `payments`, `common`) each with own `entryFile`/`sourceRoot`; `shop` and `payments` include `assets` config for proto copy.

## TypeScript configuration hierarchy

```
tsconfig.json (root)            CommonJS, ES2023, strictNullChecks, @app/common alias
  ↳ tsconfig.build.json         Excludes test/, dist/, **/*spec.ts
      ↳ apps/shop/tsconfig.app.json      @/* → src/*; @app/common → dist/libs/common (src fallback); outDir: dist/apps/shop
      ↳ apps/payments/tsconfig.app.json  @/* → src/*; @app/common → dist/libs/common (src fallback); outDir: dist/apps/payments
      ↳ libs/common/tsconfig.lib.json    rootDir: src; outDir: dist/libs/common
```

`@app/common` resolves to `dist/libs/common` first (declarations, keeps `rootDir` scoped) and falls back to `libs/common/src` for `ts-node`/IDE when `dist/` is absent. Both apps share the same `@/*` alias pattern (resolves to their own `src/`). Test path aliases (`@test/*`) only exist in `apps/shop/test/tsconfig.json`.

## Shared library — `libs/common`

```
libs/common/src/
  index.ts
  config/
    logger.ts               # log-level utility (shared)
  database/
    adapters/               # base, factory, interfaces, postgres-local
    logger/
      custom-typeorm-logger.ts  # base TypeORM logger (no query counting)
    typeorm-paths.ts
  environment/
    injectConfig.ts         # @InjectConfig() decorator
    utils.ts                # getEnvFile()
    validate.ts             # createValidate<T>(cls) factory
  utils/
    env.ts                  # isProduction / isDevelopment helpers
    misc.ts                 # omit() and other shared utils
```

Each app keeps its own `core/environment/` for app-specific schema, constants, and `getEnvVariable`. The app `validation.ts` is reduced to `export const validate = createValidate(EnvironmentVariables)`. The app `core/environment/index.ts` re-exports `getEnvFile` and `InjectConfig` from `@app/common/environment`.

### Build order

`libs/common` must be compiled before the apps so `dist/libs/common/*.d.ts` declarations exist. This prevents TypeScript from pulling in raw source and expanding `rootDir`:

```bash
nest build common        # produces dist/libs/common/
nest build shop          # reads dist/libs/common *.d.ts — rootDir stays src/
nest build payments      # same
```

`npm run build` runs `nest build` which handles this automatically. The `start:dev` script in each app's `package.json` also runs `nest build common` first.

## What is shared vs. separate

| Concern                  | Shared                           | Separate                                                 |
| ------------------------ | -------------------------------- | -------------------------------------------------------- |
| `node_modules`           | ✅ single root                   | —                                                        |
| `package.json` (scripts) | ✅ root coordinates              | Each app has own for dev scripts                         |
| TypeScript base config   | ✅ root `tsconfig.json`          | —                                                        |
| Shared library           | ✅ `libs/common` (`@app/common`) | —                                                        |
| Proto source of truth    | ✅ `proto/payments.proto`        | Copied to `apps/*/src/proto/` on build                   |
| Database                 | —                                | ✅ each app has its own Postgres instance                |
| Environment files        | —                                | ✅ each app: `.env.development`, `.env.production`, etc. |
| Migrations               | —                                | ✅ separate migration directories                        |

## Build

```bash
npm run build          # builds common + both apps
nest build common      # library only
nest build shop        # single app (requires common built first)
nest build payments    # single app (requires common built first)
```

Output: `dist/apps/shop/`, `dist/apps/payments/`, `dist/libs/common/`
Proto files copied to `dist/apps/{app}/proto/` via `nest-cli.json` assets.

A `dist/node_modules/@app/common` symlink is created during the production Docker build so Node.js resolves `require('@app/common')` at runtime without `tsconfig-paths`.

## Communication between services

```
shop ──gRPC──► payments   (PaymentsGrpcService → PAYMENTS_GRPC_CLIENT → port 5001)
```

In production, both apps join the shared Docker network `rd_shop_backend_prod_shared` (defined in payments compose, referenced as external in shop compose).
