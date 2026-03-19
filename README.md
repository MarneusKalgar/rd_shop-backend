# RD Shop Backend - NestJS REST API

A production-ready, type-safe REST API built with NestJS, featuring comprehensive environment management, graceful shutdown handling, and standardized error responses.

## 🚀 Features

- **Database Integration** - TypeORM with PostgreSQL, supporting multiple providers (Neon, standard PostgreSQL)
- **Database Migrations** - Version-controlled schema management with TypeORM migrations
- **Database Seeding** - Idempotent seed data for development and testing
- **Entity Relationships** - Complete domain model with User, Order, OrderItem, and Product entities
- **Type-Safe Environment Management** - Runtime validation with class-validator
- **Graceful Shutdown** - Proper cleanup of resources and connections
- **Global Error Handling** - Consistent error responses with request tracing
- **Request/Response Interceptors** - Standardized API response format
- **Validation** - Automatic DTO validation with class-validator
- **API Versioning** - URI-based versioning (default: v1)
- **Request Tracing** - X-Request-ID header for distributed tracing
- **Configurable Logging** - Environment-based log levels
- **Cross-Platform Support** - Works on Windows, macOS, and Linux
- **GraphQL API** - Code-first GraphQL implementation with Apollo Server (see [homework07.md](homework07.md))
- **DataLoader Integration** - N+1 query prevention with request-scoped DataLoaders (90% query reduction)
- **File Upload System** - Presigned S3 URLs for secure file uploads with two-phase workflow (see [homework09.md](homework09.md))
- **Product Images** - Support for product main image association with AWS S3 storage
- **Docker Support** - Production-ready multi-stage builds with distroless images (see [homework10.md](homework10.md))
- **Container Security** - Non-root users, minimal base images, and network isolation
- **Hot Reload in Docker** - Development environment with source code bind mounts
- **RabbitMQ Integration** - Asynchronous order processing with manual ack, retry policy, and dead-letter queue (see [homework12.md](homework12.md))
- **Idempotent Message Processing** - Duplicate message prevention via `ProcessedMessage` table and unique `messageId` constraint
- **Order Worker** - Dedicated NestJS module consuming `order.process` queue, updating order status to `PROCESSED` after DB commit
- **gRPC Payments Integration** - Independent payments-service communicating over gRPC; order worker authorizes payment after processing, updating order to `PAID` (see [homework14.md](homework14.md))
- **GraphQL Authentication** - JWT-protected GraphQL queries via `GqlJwtAuthGuard`; user identity derived from Bearer token
- **CI/CD Pipeline** - Four-workflow GitHub Actions pipeline with PR quality gates, immutable image build, automatic stage deploy, and manual production deploy with approval gate (see [homework17.md](homework17.md))
- **Health Check System** - Three-tier health endpoints (`/health`, `/ready`, `/status`) built with `@nestjs/terminus`; custom indicators for PostgreSQL, RabbitMQ, MinIO, and payments-service gRPC; liveness/readiness/full-status probes with Kubernetes-compatible semantics

## 🛠️ Technology Stack

### Core Framework

- **[NestJS](https://nestjs.com/)** ^11.0.1 - Progressive Node.js framework
- **[TypeScript](https://www.typescriptlang.org/)** ^5.7.3 - Type-safe JavaScript
- **[Node.js](https://nodejs.org/)** - Runtime environment
- **[Express](https://expressjs.com/)** - HTTP server

### GraphQL

- **[@nestjs/graphql](https://docs.nestjs.com/graphql/quick-start)** - NestJS GraphQL integration
- **[@nestjs/apollo](https://www.apollographql.com/)** - Apollo Server v4 driver
- **[graphql](https://graphql.org/)** - GraphQL.js implementation
- **[dataloader](https://github.com/graphql/dataloader)** - Batching and caching layer for N+1 prevention

### Database

- **[TypeORM](https://typeorm.io/)** ^0.3.21 - ORM for TypeScript and JavaScript
- **[PostgreSQL](https://www.postgresql.org/)** - Relational database
- **[pg](https://node-postgres.com/)** - PostgreSQL client for Node.js

### File Storage

- **[@aws-sdk/client-s3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/)** - AWS SDK v3 for S3 operations
- **[@aws-sdk/s3-request-presigner](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/)** - Presigned URL generation for secure uploads

### Validation & Configuration

- **[class-validator](https://github.com/typestack/class-validator)** - Decorator-based validation
- **[class-transformer](https://github.com/typestack/class-transformer)** - Object transformation
- **[@nestjs/config](https://docs.nestjs.com/techniques/configuration)** - Configuration management

### Development & Code Quality

- **[ESLint](https://eslint.org/)** - Code linting
- **[Prettier](https://prettier.io/)** - Code formatting
- **[Husky](https://typicode.github.io/husky/)** - Git hooks
- **[lint-staged](https://github.com/okonet/lint-staged)** - Run linters on staged files

### Testing

- **[Jest](https://jestjs.io/)** - Testing framework
- **[Supertest](https://github.com/visionmedia/supertest)** - HTTP assertions

### Messaging

- **[RabbitMQ](https://www.rabbitmq.com/)** - Message broker for async order processing
- **[amqplib](https://github.com/amqp-node/amqplib)** - AMQP 0-9-1 client for Node.js

### gRPC

- **[@nestjs/microservices](https://docs.nestjs.com/microservices/grpc)** - NestJS microservices with gRPC transport
- **[@grpc/grpc-js](https://github.com/grpc/grpc-node)** - Pure JavaScript gRPC implementation
- **[@grpc/proto-loader](https://github.com/grpc/grpc-node/tree/master/packages/proto-loader)** - Dynamic proto file loading

### Infrastructure

- **[Docker](https://www.docker.com/)** - Containerization platform
- **[Docker Compose](https://docs.docker.com/compose/)** - Multi-container orchestration
- **[Distroless Images](https://github.com/GoogleContainerTools/distroless)** - Minimal base images from Google
- **[MinIO](https://min.io/)** - S3-compatible object storage for local development

## 📋 Prerequisites

### Required

- Node.js (v18+ recommended)
- npm or yarn
- Git

### Optional (for Docker setup)

- Docker Desktop or Docker Engine (v20.10+)
- Docker Compose (v2.0+)

## Description

NestJS monorepo with two independently deployed services: **shop-service** (HTTP REST + GraphQL + RabbitMQ consumer) and **payments-service** (gRPC only).

## 🔧 Installation

```bash
# Clone the repository
git clone <repository-url>
cd rd_shop

# Install dependencies (shared across both services)
npm install

# Create environment files for each service
touch apps/shop/.env.development
touch apps/payments/.env.development

# Fill in the required variables (see Environment Configuration below)
```

## 🌍 Environment Configuration

Each service has its own environment file under `apps/<service>/`:

- `apps/shop/.env.development` / `.env.production`
- `apps/payments/.env.development` / `.env.production`

### shop-service key variables

```bash
PORT=8080
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/rd_shop_dev
JWT_ACCESS_SECRET=<hex>
JWT_ACCESS_EXPIRES_IN=1h
RABBITMQ_HOST=rabbitmq
RABBITMQ_PORT=5672
PAYMENTS_GRPC_HOST=payments
PAYMENTS_GRPC_PORT=5001
PAYMENTS_GRPC_TIMEOUT_MS=5000
```

### payments-service key variables

```bash
PAYMENTS_GRPC_HOST=0.0.0.0
PAYMENTS_GRPC_PORT=5001
DATABASE_URL=postgresql://user:password@localhost:5432/rd_shop_payments_dev
```

## 🚀 Running the Application

Both services are run via Docker Compose. See the **Docker Support** section below.

For local development without Docker (each from project root):

```bash
# shop-service
cd apps/shop && npm run start:dev

# payments-service (separate terminal)
cd apps/payments && npm run start:dev

# Build all
npm run build
```

## Docker Support

The application uses per-service Docker Compose files with a **shared bridge network** (`rd_shop_backend_dev_shared`) for inter-service gRPC communication.

### Prerequisites

```bash
# Create the shared network once
docker network create rd_shop_backend_dev_shared
```

### Starting services (development)

```bash
# payments-service first (shop depends on it)
cd apps/payments && npm run docker:start:dev
# or: docker compose -p rd_shop_backend_payments_dev -f apps/payments/compose.yml -f apps/payments/compose.dev.yml up

# shop-service
cd apps/shop && npm run docker:start:dev
# or: docker compose -p rd_shop_backend_shop_dev -f apps/shop/compose.yml -f apps/shop/compose.dev.yml up
```

### Migrations & Seeding

```bash
# shop-service
cd apps/shop && npm run docker:migrate:dev
cd apps/shop && npm run docker:seed:dev

# payments-service
cd apps/payments && npm run docker:migrate:dev
```

### Teardown

```bash
cd apps/shop && npm run docker:down:dev
cd apps/payments && npm run docker:down:dev
docker network rm rd_shop_backend_dev_shared
```

### Production (WIP)

```bash
# payments-service
cd apps/payments && npm run docker:start:prod

# shop-service
cd apps/shop && npm run docker:start:prod
```

### Docker Features

- **Multi-stage builds** - Optimized image sizes (67% reduction: 1.2 GB → 384 MB)
- **Distroless images** - Minimal attack surface with no shell or package manager
- **Non-root users** - All containers run as non-root (UID 1001 or 65532)
- **Hot reload** - Development environment with source code bind mounts
- **Service isolation** - PostgreSQL on internal-only networks per service
- **Health checks** - Automatic dependency management
- **MinIO integration** - S3-compatible object storage for local development (shop only)
- **Shared network** - `rd_shop_backend_dev_shared` bridge network for gRPC communication

### Available Endpoints

| Service          | Endpoint                        | Description             |
| ---------------- | ------------------------------- | ----------------------- |
| shop-service     | `http://localhost:8080/api/v1`  | REST API                |
| shop-service     | `http://localhost:8080/graphql` | GraphQL Playground      |
| shop-service     | `http://localhost:8080/health`  | Liveness probe          |
| shop-service     | `http://localhost:8080/ready`   | Readiness probe         |
| shop-service     | `http://localhost:8080/status`  | Full status (soft deps) |
| shop-service     | `http://localhost:15672`        | RabbitMQ Management UI  |
| payments-service | `grpc://localhost:5001`         | gRPC (internal only)    |

For comprehensive Docker documentation, see [homework10.md](homework10.md).

## 🏥 Health Checks

Three dedicated endpoints expose runtime health information without requiring authentication or a versioned URL prefix:

| Endpoint  | Probe type  | Hard deps checked           | Soft deps checked | Failure response |
| --------- | ----------- | --------------------------- | ----------------- | ---------------- |
| `/health` | Liveness    | —                           | —                 | —                |
| `/ready`  | Readiness   | PostgreSQL, RabbitMQ, MinIO | —                 | 503              |
| `/status` | Full status | PostgreSQL, RabbitMQ, MinIO | payments-service  | always 200       |

**Probe semantics:**

- **`/health`** — Lightweight liveness probe. Returns `200 { status: "ok" }` as long as the Node.js process is running. No I/O performed.
- **`/ready`** — Readiness probe. Checks hard dependencies (PostgreSQL via `TypeOrmHealthIndicator.pingCheck`, RabbitMQ by asserting the `order.process` queue, and MinIO via an S3 `HeadBucket` call). Returns `503` if any check fails — used by load balancers and Kubernetes to gate traffic.
- **`/status`** — Full status dashboard. Runs all hard-dep checks plus the gRPC `Ping` RPC to payments-service. Always returns `200` so monitoring systems can diff the body without alerting on the HTTP status; soft-dependency failures appear in the `error` key of the response.

**Custom health indicators (`@nestjs/terminus`):**

- `RabbitMQHealthIndicator` — verifies the AMQP channel is open and the `order.process` queue is reachable
- `MinioHealthIndicator` — calls `S3Service.healthCheck()` which issues an S3 `HeadBucket` request
- `PaymentsHealthIndicator` — fires a gRPC `Ping` RPC with the configured `PAYMENTS_GRPC_TIMEOUT_MS`; soft dependency only

The payments-service exposes a `Ping` gRPC method that in turn runs its own PostgreSQL ping check, making the `/status` endpoint a single call that reflects the health of the entire service graph.

## 🐇 Asynchronous Order Processing (RabbitMQ)

After a successful order creation the HTTP response is returned immediately while processing continues asynchronously:

```
POST /api/v1/orders
       │
       ├─ DB transaction: reserve stock, create order (status: PENDING)
       ├─ Publish → order.process queue
       └─ Return 201 (non-blocking)

order.process queue
       │
       └─ OrderWorkerService.handleMessage()
              ├─ processOrderMessage() inside DB transaction
              ├─ ack only after commit
              ├─ on failure: retry up to 3×  (2s delay)
              └─ on exhaustion: publish → orders.dlq
```

**Queue topology:**

| Queue           | Purpose                                            |
| --------------- | -------------------------------------------------- |
| `order.process` | Main processing queue (durable)                    |
| `orders.dlq`    | Dead-letter queue for exhausted messages (durable) |

**Idempotency:** each message carries a unique `messageId`; the `ProcessedMessage` table with a unique index on `message_id` prevents duplicate processing even under retries or network replays.

For full details, reproduction steps, and log evidence see [homework12.md](homework12.md).

## �🗄️ Database Management

### Database Schema

The application includes a complete e-commerce data model:

```
User (1) ──────< (N) Order (1) ──────< (N) OrderItem (N) >────── (1) Product
         orders              items                    product
```

**Entities:**

- **User** - Customer accounts with email and timestamps
- **Order** - Customer orders with status tracking (CREATED, PAID, CANCELLED)
- **OrderItem** - Line items with quantity and price at purchase
- **Product** - Product catalog with pricing and active status

**Features:**

- Idempotent (safe to run multiple times)
- Production safety (prevents accidental seeding in production)
- Relationship resolution (maintains foreign key integrity)

### Database Adapter Pattern

The application uses an adapter pattern for database flexibility:

- **NeonAdapter** - Optimized for Neon Database (serverless PostgreSQL)
- **BasePostgresAdapter** - Standard PostgreSQL configuration
- Auto-detection based on DATABASE_URL
- Easy to extend for other providers

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate test coverage
npm run test:cov

# Run e2e tests
npm run test:e2e

# Debug tests
npm run test:debug
```

## 🏗️ Architecture Overview

### Services

The system is a **monorepo** with two independently deployable services:

```
┌──────────────────────────────────────────────────────┐
│  shop-service  (HTTP :8080 + RabbitMQ consumer)      │
│                                                      │
│   REST API  →  OrdersService  →  RabbitMQ publish    │
│   GraphQL   →  OrdersService  →  RabbitMQ publish    │
│                                        │             │
│   OrderWorkerService  ◄────────────────┘             │
│        │  mark PROCESSED                             │
│        ▼                                             │
│   PaymentsGrpcService.authorize()  ──── gRPC ──►     │
└──────────────────────────────────────────────────────┘
                                          │
                        ┌─────────────────▼──────────┐
                        │  payments-service (:5001)  │
                        │  gRPC: Authorize           │
                        │  gRPC: GetPaymentStatus    │
                        └────────────────────────────┘
```

### Design Patterns

#### 1. **Layered Architecture**

```
┌─────────────────────────────────────────┐
│         Controllers Layer               │  ← HTTP/REST/GraphQL endpoints
├─────────────────────────────────────────┤
│         Services Layer                  │  ← Business logic
├─────────────────────────────────────────┤
│         Repository Layer                │  ← Data access
├─────────────────────────────────────────┤
│         Database Layer                  │  ← PostgreSQL
└─────────────────────────────────────────┘
```

#### 2. **Dependency Injection**

- NestJS built-in IoC container
- Constructor-based injection
- Provider pattern for services

#### 3. **Middleware Pattern**

```
Request → Middleware → Guards → Interceptors → Controller → Interceptors → Response
                                                     ↓
                                            Exception Filters
```

#### 4. **DTO (Data Transfer Object) Pattern**

- Request/response data validation
- Type safety with TypeScript
- Automatic transformation

#### 5. **Exception Handling Strategy**

- Global exception filter
- Standardized error responses
- Request ID tracking
- Environment-specific logging

### Request/Response Flow

```
┌──────────────┐
│   Request    │
└──────┬───────┘
       │
       ↓
┌──────────────────────┐
│ RequestIdMiddleware  │  ← Adds X-Request-ID header
└──────┬───────────────┘
       │
       ↓
┌──────────────────────┐
│   ValidationPipe     │  ← Validates & transforms DTOs
└──────┬───────────────┘
       │
       ↓
┌──────────────────────┐
│    Controller        │  ← Route handlers
└──────┬───────────────┘
       │
       ↓
┌──────────────────────┐
│     Service          │  ← Business logic
└──────┬───────────────┘
       │
       ↓
┌──────────────────────┐
│ TransformInterceptor │  ← Wraps response in { data: ... }
└──────┬───────────────┘
       │
       ↓
┌──────────────────────┐
│   Response: 200      │
│   {                  │
│     "data": {...}    │
│   }                  │
└──────────────────────┘

       If Error ↓

┌──────────────────────┐
│ GlobalExceptionFilter│  ← Catches & formats errors
└──────┬───────────────┘
       │
       ↓
┌──────────────────────┐
│   Response: 4xx/5xx  │
│   {                  │
│     "statusCode": n, │
│     "message": "...",│
│     "error": "...",  │
│     "errorCode": ".. │
│     "path": "...",   │
│     "timestamp": "..."│
│     "requestId": "..."│
│   }                  │
└──────────────────────┘
```

## 📁 Project Structure

```
rd_shop/
├── apps/
│   ├── shop/                      # shop-service (HTTP :8080)
│   │   ├── src/
│   │   │   ├── auth/              # JWT auth, guards, decorators
│   │   │   ├── common/            # Filters, interceptors, middlewares
│   │   │   ├── config/            # App configuration
│   │   │   ├── core/              # Environment, Swagger, process handlers
│   │   │   ├── db/                # Migrations, seed, adapters
│   │   │   ├── files/             # S3 file upload module
│   │   │   ├── graphql/           # GraphQL module, resolvers, loaders
│   │   │   ├── orders/            # Orders feature module
│   │   │   ├── orders-worker/     # RabbitMQ consumer
│   │   │   ├── payments/          # gRPC client for payments-service
│   │   │   ├── products/          # Products feature module
│   │   │   ├── rabbitmq/          # RabbitMQ service & processed messages
│   │   │   ├── users/             # Users feature module
│   │   │   └── utils/             # Utility functions
│   │   ├── compose.yml            # Production Compose
│   │   ├── compose.dev.yml        # Development Compose overrides
│   │   └── package.json
│   │
│   └── payments/                  # payments-service (gRPC :5001)
│       ├── src/
│       │   ├── config/            # App configuration
│       │   ├── db/                # Migrations
│       │   ├── proto/             # Copied proto file (generated at startup)
│       │   └── utils/             # Utility functions
│       ├── compose.yml            # Production Compose
│       ├── compose.dev.yml        # Development Compose overrides
│       └── package.json
│
├── proto/
│   └── payments.proto             # Single source of truth for gRPC contract
│
├── Dockerfile                     # Multi-stage production build
├── Dockerfile.dev                 # Development build
└── package.json                   # Root — shared dependencies & tooling
```

## 🔌 API Endpoints

### REST API Base URL

```
http://localhost:8080/api/v1
```

### GraphQL Endpoint

```
http://localhost:8080/graphql
```

**GraphQL Playground:** Available at `http://localhost:8080/graphql`

**Authentication required:** All GraphQL queries require a Bearer token in the `Authorization` header.

**Example Query:**

```graphql
query GetOrders {
  orders(filter: { status: PAID }, pagination: { limit: 10 }) {
    nodes {
      id
      status
      createdAt
      user {
        email
      }
      items {
        quantity
        product {
          title
          price
        }
      }
    }
    pageInfo {
      hasNextPage
      nextCursor
    }
  }
}
```

For comprehensive GraphQL documentation, see [homework07.md](homework07.md).

### Users Module

All responses are wrapped in a standard format:

```json
{
  "data": {
    /* actual response */
  }
}
```

### Error Response Format

All errors follow this standardized format:

```json
{
  "statusCode": 404,
  "message": "User not found",
  "error": "Not Found Error",
  "path": "/api/v1/users/123",
  "timestamp": "2026-01-20T10:30:00.000Z",
  "requestId": "abc-123-def"
}
```

## 🔐 Environment Management

### Type-Safe Configuration

The application uses a schema-based approach to environment variables:

```typescript
// src/core/environment/schema.ts
export class EnvironmentVariables {
  @IsString()
  NODE_ENV?: string;

  @IsNumber()
  PORT: number;

  @IsOptional()
  @IsString()
  APP_LOG_LEVEL?: string;
}
```

### Using Configuration in Services

```typescript
import { Injectable } from '@nestjs/common';
import { InjectConfig, TypedConfigService } from '@/core/environment';

@Injectable()
export class MyService {
  constructor(@InjectConfig() private config: TypedConfigService) {}

  getPort() {
    return this.config.get('PORT', { infer: true }); // Type-safe!
  }
}
```

## 🛡️ Error Handling

### Standard Error Codes

| Status | Error Code            | Description             |
| ------ | --------------------- | ----------------------- |
| 400    | BAD_REQUEST           | Invalid request format  |
| 401    | UNAUTHORIZED          | Authentication required |
| 403    | FORBIDDEN             | Permission denied       |
| 404    | NOT_FOUND             | Resource not found      |
| 409    | CONFLICT              | Resource conflict       |
| 422    | UNPROCESSABLE_ENTITY  | Validation failed       |
| 429    | TOO_MANY_REQUESTS     | Rate limit exceeded     |
| 500    | INTERNAL_SERVER_ERROR | Server error            |
| 503    | SERVICE_UNAVAILABLE   | Service unavailable     |

## 📝 Code Quality

### Linting & Formatting

```bash
# Run ESLint
npm run lint

# Format code with Prettier
npm run format

# Type checking
npm run type-check
```

### Pre-commit Hooks

The project uses Husky and lint-staged to enforce code quality:

- Automatic linting and formatting on commit
- Type checking before push
- Prevents committing code with errors

## 🚢 Deployment

### Building for Production

```bash
# Build the application
npm run build

# The compiled output will be in the dist/ folder
```

### Running in Production

```bash
# Set NODE_ENV to production
export NODE_ENV=production

# Run the built application
npm run start:prod
```

### Environment Variables for Production

Ensure the following are set in your production environment:

- `NODE_ENV=production`
- `PORT=<your-port>`
- `APP_LOG_LEVEL=log` (or appropriate level)

## � CI/CD Pipeline

The project ships a four-workflow GitHub Actions pipeline. A single immutable Docker image is built once on every push to `development` and promoted through environments without rebuilding.

### Workflow overview

| Workflow                | Trigger                                  | Purpose                                                                 |
| ----------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| **PR Checks**           | `pull_request` → dev / main / release/\* | Lint, type-check, unit tests, Docker preview build                      |
| **Build and Push**      | `push` → `development`                   | Build + push both service images to GHCR, produce release manifest      |
| **Deploy — Stage**      | `workflow_run` (build success)           | Pull pre-built images, SSH deploy to stage VM, smoke test               |
| **Deploy — Production** | `workflow_dispatch` (manual)             | Pull pre-built images, SSH deploy to prod VM, approval gate, smoke test |

### Key design decisions

- **Build once, deploy many** — images tagged `sha-<full-sha>` (immutable) are the deployment unit; no rebuilds during promotion.
- **Release manifest** — a JSON artifact carrying image references and digests is the handoff contract between build and deploy workflows.
- **Rollback** — re-running the production workflow with a past `run_id` / `sha` restores both images and compose configuration in sync.
- **Sentinel check** — `All Checks Passed` job aggregates all PR results into one required status check entry in branch protection.
- **Seven reusable composite actions** encapsulate install, code-quality, manifest parsing, deployment, smoke testing, and summary writing.

For full pipeline architecture, action dependency maps, artifact flow diagrams, secrets reference, and security notes see [homework17.md](homework17.md).

## �🔄 Graceful Shutdown

The application handles graceful shutdown automatically:

- Closes HTTP server
- Waits for active requests to complete
- Cleans up resources (database connections, Redis, etc.)
- Exits cleanly on SIGTERM/SIGINT

Configuration per environment in `src/config/graceful-shutdown.ts`

## 📚 Next Steps

See [TODO.md](TODO.md) for planned features:

- [x] Database integration (TypeORM + PostgreSQL)
- [x] Database migrations and seeding
- [x] GraphQL API with DataLoader (see [homework07.md](homework07.md))
- [x] Docker support with multi-stage builds (see [homework10.md](homework10.md))
- [x] RabbitMQ async order processing with retry and DLQ (see [homework12.md](homework12.md))
- [x] gRPC payments integration with independent payments-service (see [homework14.md](homework14.md))
- [x] Authentication & Authorization (JWT) for REST and GraphQL
- [x] CI/CD pipeline with GitHub Actions (PR checks, build & push, stage/production deploy) (see [homework17.md](homework17.md))
- [ ] Complete service layer implementation (CRUD operations)
- [x] Health check endpoint (`/health`, `/ready`, `/status` with custom Terminus indicators)
- [ ] Rate limiting
- [ ] Redis caching
- [ ] API documentation (Swagger)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Resources

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework
- For questions and support, visit the [Discord channel](https://discord.gg/G7Qnnhy)

## 📄 License

This project is licensed under the UNLICENSED license.

---

**Built with ❤️ using NestJS**
