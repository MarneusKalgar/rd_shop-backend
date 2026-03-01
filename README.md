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

Production-ready NestJS API with comprehensive type-safe environment management and standardized error handling.

## 🔧 Installation

```bash
# Clone the repository
git clone <repository-url>
cd rd_shop

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.development

# Configure environment variables
# Edit .env.development with your settings
```

## 🌍 Environment Configuration

The application uses environment-specific configuration files:

- `.env` - Default configuration (base template)
- `.env.development` - Development environment
- `.env.production` - Production environment
- `.env.test` - Test environment
- `.env.local` - Local overrides (not committed to git)

### Environment Variables

```bash
# Server Configuration
PORT=4000
NODE_ENV=development
NODE_HOSTNAME=localhost

# Logging
APP_LOG_LEVEL=log  # Options: error, warn, log, debug, verbose

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/rd_shop
DATABASE_PROVIDER=neon  # Options: neon, postgres
```

The application automatically loads the appropriate `.env.{NODE_ENV}` file based on the `NODE_ENV` variable.

## 🚀 Running the Application

```bash
# Development mode with hot reload
npm run start:dev

# Debug mode
npm run start:debug

# Production mode
npm run start:prod

# Build the project
npm run build
```

The API will be available at `http://localhost:8080` (or your configured PORT).

## � Docker Support

The application includes production-ready Docker setup with multi-stage builds, environment-specific configurations, and security best practices.

### Quick Start with Docker

```bash
# Development environment (with hot reload)
docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml up --build

# Run migrations
docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml run --rm migrate

# Seed database
docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml run --rm seed

# Production environment (distroless)
docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml up --build
```

### Docker Features

- **Multi-stage builds** - Optimized image sizes (67% reduction: 1.2 GB → 384 MB)
- **Distroless images** - Minimal attack surface with no shell or package manager
- **Non-root users** - All containers run as non-root (UID 1001 or 65532)
- **Hot reload** - Development environment with source code bind mounts
- **Service isolation** - PostgreSQL on internal-only network
- **Health checks** - Automatic dependency management with health checks
- **MinIO integration** - S3-compatible object storage for local development

### Available Endpoints

- **REST API**: `http://localhost:8080` (Swagger docs at `/api-docs`)
- **GraphQL**: `http://localhost:8080/graphql` (with Playground)
- **Health Check**: `http://localhost:8080/health`

For comprehensive Docker documentation, see [homework10.md](homework10.md).

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

### Running Migrations

Migrations track and version your database schema changes:

```bash
# Run pending migrations (development)
npm run db:migrate:dev

# Run pending migrations (production)
npm run db:migrate:prod

# Generate a new migration after entity changes
npm run db:generate -- AddUserRoleColumn

# Revert the last migration (development)
npm run db:revert:dev

# Revert the last migration (production)
npm run db:revert:prod
```

### Seeding the Database

Populate your database with test data:

```bash
# Run seed data (dev/test only)
npm run db:seed
```

**Seed Data Includes:**

- 5 test users
- 12 products (various prices and states)
- 8 orders with multiple items

**Features:**

- Idempotent (safe to run multiple times)
- Production safety (prevents accidental seeding in production)
- Relationship resolution (maintains foreign key integrity)

### Database Commands Reference

```bash
# Migration commands
npm run db:migrate:dev       # Apply migrations (development)
npm run db:migrate:prod      # Apply migrations (production)
npm run db:generate -- Name  # Generate new migration
npm run db:revert:dev        # Rollback last migration (dev)
npm run db:revert:prod       # Rollback last migration (prod)

# Seed command
npm run db:seed              # Seed database with test data

# TypeORM CLI (advanced)
npm run typeorm -- migration:show  # Show all migrations
npm run typeorm -- query "SELECT * FROM users"  # Run SQL query
```

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

### Design Patterns

#### 1. **Layered Architecture**

```
┌─────────────────────────────────────────┐
│         Controllers Layer               │  ← HTTP/REST endpoints
├─────────────────────────────────────────┤
│         Services Layer                  │  ← Business logic
├─────────────────────────────────────────┤
│         Repository Layer (TODO)         │  ← Data access
├─────────────────────────────────────────┤
│         Database Layer (TODO)           │  ← PostgreSQL
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
├── src/
│   ├── common/                    # Shared utilities & components
│   │   ├── constants/             # Application constants
│   │   ├── dto/                   # Common DTOs
│   │   ├── errors/                # Custom error classes
│   │   ├── filters/               # Exception filters
│   │   ├── interceptors/          # Request/response interceptors
│   │   └── middlewares/           # HTTP middlewares
│   │
│   ├── config/                    # Application configuration
│   │
│   ├── core/                      # Core utilities
│   │   ├── environment/           # Environment management
│   │   ├── process/               # Process error handlers
│   │   └── swagger/               # API documentation setup
│   │
│   ├── db/                        # Database layer
│   │   ├── adapters/              # Database adapter pattern
│   │   ├── migrations/            # TypeORM migrations
│   │   └── seed/                  # Database seeding
│   │
│   ├── users/                     # Users feature module
│   │   ├── dto/                   # User DTOs
│   │   ├── interfaces/            # User interfaces
│   │   └── v1/                    # API version 1 controllers
│   │
│   ├── orders/                    # Orders feature module
│   │
│   ├── products/                  # Products feature module
│   │
│   └── utils/                     # Utility functions
│
└── test/                          # E2E tests
```

### Folder Descriptions

#### `/src/common/` - Shared Components

Reusable components across the application including filters, interceptors, middlewares, DTOs, and error classes.

#### `/src/config/` - Application Configuration

Application-level configuration for graceful shutdown, logging, TypeORM, and environment-specific settings.

#### `/src/core/` - Core Utilities

Framework-level utilities including environment management, process handlers, and Swagger configuration.

#### `/src/db/` - Database Layer

Database configuration with adapter pattern for provider flexibility, TypeORM migrations, and seeding system.

#### `/src/users/`, `/src/orders/`, `/src/products/` - Feature Modules

Domain-driven feature modules containing entities, DTOs, services, controllers, and business logic.

#### `/src/utils/` - Utility Functions

Helper functions and utilities used across the application.

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

## 🔄 Graceful Shutdown

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
- [ ] Complete service layer implementation (CRUD operations)
- [ ] Authentication & Authorization (JWT)
- [ ] Health check endpoint
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
