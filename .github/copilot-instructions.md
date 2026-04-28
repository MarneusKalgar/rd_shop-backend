# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED

Any terminal command containing `curl` or `wget` will be intercepted and blocked. Do NOT retry.
Instead use:

- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED

Any terminal command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` will be intercepted and blocked. Do NOT retry with terminal.
Instead use:

- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch / fetch — BLOCKED

Direct web fetching tools are blocked. Use the sandbox equivalent.
Instead use:

- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Terminal / run_in_terminal (>20 lines output)

Terminal is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:

- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### read_file (for analysis)

If you are reading a file to **edit** it → read_file is correct (edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context.

### grep / search (large results)

Search results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command       | Action                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| `ctx stats`   | Call the `ctx_stats` MCP tool and display the full output verbatim                    |
| `ctx doctor`  | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist  |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |

Note: Do not try to run `aws` CLI or `pulumi` CLI commands directly in terminal. Only print the relevant summary information to context.

# rd_shop — Project Instructions

## Structure

NestJS monorepo. Two independently deployed services:

- `apps/shop` — HTTP REST + GraphQL (Apollo) + RabbitMQ consumer; port 8080
- `apps/payments` — gRPC only; port 5001

## Key Conventions

- Path alias `@/*` → `apps/<service>/src/*` in both app and test code
- Path alias `@test/*` → `apps/shop/test/*` (test code only, depth-independent)
- DTOs use `class-validator`; all controllers use `ValidationPipe` with `whitelist: true`
- URI versioning, default `v1`; global prefix `api` (health endpoints bypass it)

## Commands

```
npm test                        # unit tests (shop + payments)
npm run test:integration:shop   # integration tests — requires Docker
npm run lint:ci                 # ESLint (no --fix)
npm run type-check              # tsc --noEmit for both services
npm run build                   # nest build
```

## Test Tiers

| Tier        | Suffix                  | Location                      | Notes                                                    |
| ----------- | ----------------------- | ----------------------------- | -------------------------------------------------------- |
| Unit        | `*.spec.ts`             | `apps/*/src/`                 | All deps mocked                                          |
| Integration | `*.integration-spec.ts` | `apps/shop/test/integration/` | Real Postgres via Testcontainers; RabbitMQ + gRPC mocked |
| e2e         | `*.e2e-spec.ts`         | `apps/shop/test/e2e/`         | TBD — full stack, zero mocks                             |

## Infrastructure Mocked in Integration Tests

`RabbitMQService`, `PAYMENTS_GRPC_CLIENT`, `PaymentsGrpcService`, `PaymentsHealthIndicator` — all overridden in `Test.createTestingModule`. Reason: RabbitMQ connects eagerly; proto file (`apps/shop/src/proto/`) is a gitignored build artifact absent on CI.

## CI (GitHub Actions)

PR gate: `install → code-quality → [integration-tests ‖ docker-preview-build] → all-checks-passed`
`node_modules` cached by `actions/cache@v4` keyed on `hash(package-lock.json)`.

## Knowledge Base

Detailed architecture notes live in `docs/architecture/`. Read the relevant file(s) before working on each area:

- `monorepo.md` — two-app structure, tsconfig hierarchy, shared vs. separate, build, inter-service network
- `order-creation-flow.md` — complete order lifecycle: HTTP → RabbitMQ → worker → gRPC → PAID, all idempotency layers
- `order-querying-flow.md` — REST + GraphQL querying, filters, cursor pagination, payment status via gRPC
- `test-infrastructure.md` — test tiers, bootstrap pattern, always-overridden providers
- `db-layer.md` — entity graph, FK constraints, order status flow, adapter pattern, migrations
- `grpc-payments.md` — proto contract, PaymentsGrpcModule/Service, error mapping, health check
- `auth-rbac.md` — JWT strategy, 4 guards, decorators, userId-from-token rule
- `graphql-dataloader.md` — Apollo setup, cursor pagination, 4 DataLoaders
- `rabbitmq-async.md` — queue topology, worker flow, idempotency, mock shape
- `files-s3.md` — 3-step presigned upload flow, FileRecord lifecycle, S3Service, env vars
- `users.md` — User entity, profile CRUD, password change, avatar flow, cursor pagination, search, soft-delete, GraphQL
- `docker-compose.md` — multi-stage Dockerfile, all compose services, networks, dev vs. prod
- `ci-pipeline.md` — 4 workflows, job graph, 7 composite actions, image tag strategy

## Communication Style

Use **caveman mode** (terse, no fluff, technical substance exact) with context-aware intensity:

- **Questions / Explanations** (no code writing) → `lite` intensity
  - Keep articles + full sentences, professional but tight, no filler
  - Example: "Component re-renders because you create a new object reference each render. Wrap it in `useMemo`."

- **Implementation / Code Changes** → `full` or `ultra` intensity
  - **`full`**: Drop articles, fragments OK, short synonyms, classic caveman
  - **`ultra`**: Abbreviate (`DB`/`auth`/`config`/`req`/`res`), strip conjunctions, arrows (`X → Y`), one word when possible

Default: `full` for code work. Switch mid-conversation: `/caveman lite` or `/caveman ultra`.
Stop at any time: "stop caveman" or "normal mode".

## Notes

- Newer ask to install deps. Only inform about new packages to add to `package.json` if needed.
- Focus on writing the implementation code, do not:
  - Do not fix import/object keys ordering or formatting issues.
  - Do not try to fix ESLint/Prettier unless you are specifically instructed to do so.
  - Do not try to launch type-check and test scripts. These are expected to fail until the relevant code is implemented.
  - Do not try to generate a migration file if you create new TypeORM entity. Focus on defining the entity and its relations correctly. Also register it in the `apps/shop/src/config/typeORM.ts` or `apps/payments/src/config/typeORM.ts` depending on the service.
- Never throw from controllers; throw from the service layer instead.
- Each new env var should be added to `apps/shop/.env.example`/`apps/shop/.env.development` or `apps/payments/.env.example`/`apps/payments/.env.development` with a default value and register in the `apps/shop/src/core/environment/schema.ts` or `apps/payments/src/core/environment/schema.ts` depending on the service.
- If you need to create constants - create `constants/index.ts` file in the relevant domain and export them from there. Do not create multiple constants files unless there is a very good reason to do so.
