# rd_shop — Service-Oriented Monorepo

## Classification

`rd_shop` is best described as a **service-oriented monorepo**.

- **Repository/tooling level:** true monorepo
- **Runtime level:** two coarse-grained backend services
- **Delivery level:** one coordinated release, not independently deployable microservices

That distinction matters. The repo layout is genuinely a monorepo, but the runtime/deploy model is **not** a pure microservices setup yet.

## Why the monorepo label is correct

This is a real monorepo in the normal engineering sense:

- one git repository
- one root `package.json` and root dependency graph
- one root TypeScript base config
- one shared library in `libs/common`
- one shared proto source of truth in `proto/`
- one CI surface for app and infra validation

So the inaccurate label here is not `monorepo`. The inaccurate label is the stronger claim that the backend is already a set of fully independent microservices.

## Why `microservices` is too strong

The system has meaningful service boundaries, but autonomy is still partial.

- `shop` and `payments` run as separate processes
- they communicate over a real network contract (gRPC)
- they own separate databases and migrations
- but they are still versioned and promoted together

Current delivery flow shows the coupling clearly:

- `build-and-push.yml` builds **both** images and writes one `release-manifest.json`
- `deploy-stage.yml` and `deploy-production.yml` inject **both** image URIs into the Pulumi stack before apply
- deploy workflows quiesce **both** ECS services, apply infra, run init tasks, then restore **both** services
- there is no first-class per-service promotion, rollback, or release cadence today

`shop` also explicitly knows about `payments` through the gRPC contract, service discovery, and payment workflow. That is not wrong, but it means the phrase “independent apps that do not know about each other” would be misleading.

## Two-App NestJS Monorepo

| App        | Entry                       | Port | Transports                                         | Notes                       |
| ---------- | --------------------------- | ---- | -------------------------------------------------- | --------------------------- |
| `shop`     | `apps/shop/src/main.ts`     | 8080 | HTTP REST, GraphQL, RabbitMQ consumer, gRPC client | Primary user-facing service |
| `payments` | `apps/payments/src/main.ts` | 5001 | gRPC server only                                   | Internal payment processor  |

## What this architecture is and is not

| Layer      | Best description                  | What it is not                      |
| ---------- | --------------------------------- | ----------------------------------- |
| Repository | Monorepo                          | Polyrepo                            |
| Runtime    | Two-service distributed backend   | Modular monolith                    |
| Delivery   | Coordinated multi-service release | Independent microservice deployment |

## Why this shape is a good fit for current project size

For a backend of this size, this is a pragmatic middle ground.

- **Lower operational overhead:** two services are easier to reason about than a larger microservice fleet with independent pipelines, registries, versioning rules, and rollback choreography.
- **Atomic cross-service changes:** order flow changes often span `shop`, `payments`, the gRPC proto, tests, and infra. One repo and one coordinated release keep those changes easy to ship safely.
- **Fast local development:** one workspace, one toolchain, one CI setup, shared types/utilities, and simpler onboarding.
- **Useful domain boundary without over-fragmentation:** payments still has a separate runtime and separate database, so the codebase gets some service isolation where it matters.
- **Cheaper delivery model:** current AWS setup is intentionally small and budget-aware. Coordinated deploys fit that constraint better than full service independence.

## Costs and risks of this approach

The tradeoff is delivery coupling.

- **Bigger release blast radius:** changes that only touch one service still move through a release artifact that contains both services.
- **Weaker service autonomy:** payments cannot yet evolve with a truly separate deploy cadence or rollback path.
- **Shared-library coupling risk:** `libs/common` is useful, but it can quietly pull behavior and assumptions across service boundaries if left unchecked.
- **Contract drift can be hidden:** when client and server live in one repo and ship together, teams can get away with tighter lockstep changes than a true independent-service setup would tolerate.
- **Distributed-monolith risk at the delivery layer:** separate runtimes alone do not buy full microservice benefits if versioning, deployment, and rollback stay coordinated.

For this repo, those costs are acceptable today, but they are real.

## When to call it “true microservices” later

The label becomes more defensible when the services can evolve independently at the delivery layer.

- independent image promotion per service
- independent deploy and rollback workflows
- backward-compatible contract rollout as a hard rule, not just a convenience
- less reliance on broad shared libraries
- clearer team/service ownership boundaries

Until then, `service-oriented monorepo` is the more accurate description.

## `nest-cli.json`

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

## What is shared vs. separate

| Concern          | Shared                                                                     | Separate                                  |
| ---------------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| `node_modules`   | single root dependency tree                                                | —                                         |
| Root toolchain   | root `package.json`, root `tsconfig.json`, shared ESLint/Jest/infra wiring | app-local dev scripts                     |
| Shared code      | `libs/common`                                                              | app-specific domain code                  |
| Proto contract   | `proto/payments.proto` source of truth                                     | copied runtime/build artifacts per app    |
| Database         | —                                                                          | separate Postgres database per service    |
| Migrations       | —                                                                          | separate migration directories            |
| Runtime process  | —                                                                          | separate NestJS processes                 |
| Release artifact | one release manifest containing both service image refs                    | no per-service promotion artifact today   |
| Deploy workflow  | coordinated stage/prod Pulumi apply                                        | no independent service rollout path today |

## Build order

`libs/common` must be compiled before the apps so `dist/libs/common/*.d.ts` declarations exist. This prevents TypeScript from pulling in raw source and expanding `rootDir`:

```bash
nest build common        # produces dist/libs/common/
nest build shop          # reads dist/libs/common *.d.ts — rootDir stays src/
nest build payments      # same
```

`npm run build` runs `nest build` which handles this automatically. The `start:dev` script in each app's `package.json` also runs `nest build common` first.

## Build output

```bash
npm run build          # builds common + both apps
nest build common      # library only
nest build shop        # single app (requires common built first)
nest build payments    # single app (requires common built first)
```

Output: `dist/apps/shop/`, `dist/apps/payments/`, `dist/libs/common/`
Proto files copied to `dist/apps/{app}/proto/` via `nest-cli.json` assets.

NestJS CLI (`nest build`) automatically rewrites TypeScript path aliases (for example `@app/common`) to relative paths in the compiled JS output. No `tsconfig-paths` registration or `node_modules` symlink is needed at runtime.

## Communication between services

```text
shop ──gRPC──► payments   (PaymentsGrpcService → PAYMENTS_GRPC_CLIENT → port 5001)
```

In current AWS deployment, both services run under the same coordinated platform release even though they are separate services at runtime.
