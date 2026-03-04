# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.7] - 2026-03-04

### Added

- **RabbitMQ Integration** - Asynchronous order processing via AMQP with `amqplib`
- **Order Worker Module** - Dedicated `OrderWorkerService` consuming the `order.process` queue with manual ack
- **Dead-Letter Queue** - `orders.dlq` queue for messages exceeding the retry limit
- **Retry Mechanism** - Fixed-delay retry policy (up to 3 attempts, 2s delay) with attempt counter tracked in message payload
- **Idempotent Processing** - `ProcessedMessage` entity with unique index on `message_id`; two-layer duplicate guard (pre-insert SELECT + unique constraint catching `23505`)
- **Non-Blocking Order Creation** - `POST /api/v1/orders` returns 201 immediately after publishing; processing runs entirely in the worker
- **Simulation Env Vars** - `RABBITMQ_SIMULATE_FAILURE` and `RABBITMQ_SIMULATE_DELAY` for reproducing retry/DLQ scenarios without modifying code
- **Order Status Migration** - Changed default order status from `CREATED` to `PENDING` (migration `1772641502231-UpdateOrderStatusDefault`)
- **RabbitMQ Documentation** - Full setup, topology, retry policy, and scenario reproduction guide ([homework12.md](homework12.md))

### Changed

- **Order Entity** - Default `status` updated to `OrderStatus.PENDING`
- **Worker Guard** - Added `status !== PENDING` guard in `processOrderMessage` to skip orders in unexpected states

### Security

- **Manual Ack Only** - `noAck: false` enforced; ack is performed strictly after DB transaction commit to prevent message loss

### Reliability

- **Predictable Retry** - Hard cap at `MAX_RETRY_ATTEMPTS = 3`; no infinite loops possible
- **DLQ Stability** - DLQ declared durable; full payload including `attempt` and `orderId` preserved for debugging
- **No Duplication** - Idempotency guard prevents order re-processing on retry or network replay

## [0.0.6] - 2026-03-01

### Added

- **Docker Multi-Stage Builds** - Development, production Alpine, and production distroless variants (5 build stages)
- **Distroless Production Images** - Google distroless base images with no shell or package manager for minimal attack surface
- **Docker Compose Orchestration** - Base compose.yml with environment-specific overrides (dev/prod)
- **Hot Reload in Docker** - Development environment with source code bind mounts and automatic restart
- **Containerized Migrations & Seeding** - One-off containers with health check dependencies
- **MinIO Integration** - S3-compatible object storage for local development
- **Docker Documentation** - Comprehensive guide covering architecture, security, and optimization ([homework10.md](homework10.md))

### Changed

- **Image Size Optimization** - 67% reduction: 1.2 GB (dev) → 384 MB (prod distroless)
- **API Port** - Standardized to 8080 for both development and production
- **PostgreSQL Isolation** - Database accessible only within internal Docker network (not exposed to host)

### Security

- **Non-Root Users** - All containers run as UID 1001 (nestjs) or UID 65532 (nonroot)
- **Distroless Runtime** - Zero shell access in production prevents container exploitation
- **Network Isolation** - Separate public and internal networks for service isolation

### Performance

- **Layer Caching** - Multi-stage builds optimize Docker layer caching for faster rebuilds
- **Dependency Pruning** - Production images contain only runtime dependencies (no devDependencies or build tools)

## [0.0.5] - 2026-02-23

### Added

- **File Upload System** - Presigned S3 URL-based file upload with two-phase workflow (presign → upload → complete)
- **FileRecord Entity** - Database entity for tracking uploaded files with status (PENDING, READY, FAILED)
- **Files Module** - Complete file management module with FilesService, S3Service, and REST API endpoints
- **Product Images** - Integration with Products module for main image association (Product.mainImageId)
- **Presigned URL Generation** - Secure 15-minute presigned PUT URLs for direct client-to-S3 uploads
- **File Verification** - Server-side S3 HEAD request verification before marking uploads as complete
- **AWS S3 Integration** - AWS SDK v3 with @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner
- **File Upload Documentation** - Comprehensive guide covering architecture, workflow, and S3 configuration ([homework09.md](homework09.md))
- **Upload Endpoints** - POST /v1/files/presigned-upload and POST /v1/files/complete-upload REST endpoints
- **File Status Tracking** - Lifecycle management (PENDING → READY) with automatic status transitions
- **Entity Association** - Generic file association pattern supporting products (and future user avatars)
- **S3 Key Management** - Structured key naming: `{entityType}/{entityId}/{fileType}/{uuid}.{ext}`

### Changed

- **Product Entity** - Added `mainImageId` nullable foreign key to FileRecord
- **Database Schema** - Added file_records table with foreign key relationship to products

### Security

- **Presigned URL Expiry** - 15-minute time-limited upload URLs to prevent unauthorized access
- **File Size Validation** - DTO validation for file size limits before presigned URL generation
- **Content-Type Enforcement** - Presigned URLs enforce specific content types during upload
- **S3 Bucket Permissions** - Server-only access to S3 credentials, clients never see AWS keys

### Performance

- **Direct S3 Upload** - Zero server load during file transfer, client uploads directly to S3
- **Minimal Server Processing** - Server only generates URLs and verifies, no file handling
- **Efficient Verification** - HEAD requests to S3 instead of downloading full files for verification

## [0.0.4] - 2026-02-18

### Added

- **GraphQL API** - Code-first GraphQL implementation using @nestjs/graphql with Apollo Server v4
- **GraphQL Module** - Configured with auto-schema generation, GraphiQL playground, and introspection
- **GraphQL Schemas** - Type-safe ObjectTypes for Order, OrderItem, Product, and User with proper decorators
- **GraphQL Inputs** - OrdersFilterInput and OrdersPaginationInput with shared validation decorators
- **Orders Query** - GraphQL query for fetching orders with filtering and cursor-based pagination
- **Field Resolvers** - Resolvers for nested relations (order.user, order.items, orderItem.product, orderItem.order)
- **DataLoader Integration** - Request-scoped DataLoaders for batching database queries (UserLoader, OrderLoader, OrderItemLoader, ProductLoader)
- **N+1 Query Prevention** - Eliminated N+1 problem using DataLoader batching (41 queries → 4 queries, 90% reduction)
- **GraphQL Error Handling** - Structured GraphQLError usage with error codes (USER_NOT_FOUND, ORDER_NOT_FOUND, PRODUCT_NOT_FOUND)
- **GraphQL Documentation** - Comprehensive guide covering schema design, DataLoader implementation, and N+1 resolution ([homework07.md](homework07.md))

### Changed

- **Business Logic Reuse** - GraphQL resolvers now use the same OrdersService as REST API endpoints
- **Error Format** - Field resolvers throw GraphQLError with extensions containing error codes and context
- **Query Performance** - 83% faster response times (150ms → 25ms) through DataLoader batching

### Performance

- **DataLoader Batching** - Reduced database round-trips by 10x (41 → 4 queries for 10 orders)
- **Query Optimization** - Batched `WHERE IN` queries instead of individual SELECT statements
- **Response Time** - Order queries improved from ~150ms to ~25ms with DataLoader

## [0.0.3] - 2026-02-13

### Added

- **Order Creation with Idempotency** - Production-ready order creation system with idempotency key support to prevent duplicate orders
- **Pessimistic Locking** - Transaction-safe order processing using `FOR UPDATE` locks to prevent stock oversell in concurrent scenarios
- **Order Querying & Filtering** - Advanced order retrieval with multiple filters (status, user email, product name, date range)
- **Cursor-Based Pagination** - Scalable pagination for orders using cursor-based approach instead of offset-based
- **Order Query Optimization** - Composite B-tree indexes for 90-95% query performance improvement
- **Stock Management** - Automatic stock decrement within order transactions with validation
- **Product Availability Checks** - Validation for product existence, active status, and sufficient stock before order creation
- **Order Relations** - Eager loading of user, order items, and product details in single query
- **Idempotency Repository Pattern** - Dedicated repository methods for idempotency key lookups
- **Query Builder Pattern** - Separated query construction logic in `OrdersQueryBuilder` class
- **Comprehensive Error Handling** - Specific error types for timeout, lock contention, and race conditions
- **Order Documentation** - Detailed docs for order creation ([ORDERS_CREATION.md](docs/ORDERS_CREATION.md)) and querying ([ORDERS_QUERYING.md](docs/ORDERS_QUERYING.md))
- **Query Performance Analysis** - SQL execution plan analysis and optimization guide ([QUERY_OPTIMIZATION.md](docs/QUERY_OPTIMIZATION.md))

### Changed

- **Order Entity** - Added `idempotencyKey` field (nullable, unique constraint)
- **Product Entity** - Added `stock` field with default value 0
- **Orders Response Format** - Changed from `data` to `items` array in GET response, removed `total` count for performance optimization
- **Database Indexes** - Added composite indexes: `IDX_orders_user_created`, `IDX_orders_status_created`, `IDX_order_items_order_product`
- **Transaction Timeouts** - Configured statement timeout (30s) and lock timeout (10s) for order transactions

### Fixed

- **Race Condition Handling** - Proper handling of duplicate idempotency key violations (PostgreSQL error 23505)
- **N+1 Query Problem** - Eliminated via eager loading with `leftJoinAndSelect` for all order relations
- **Cursor Pagination Consistency** - Prevents duplicate/missing items when data changes between requests

### Performance

- **Query Execution** - 90-95% faster order queries with optimized indexes
- **Row Scanning** - 95-99% fewer rows scanned with composite indexes
- **Join Strategy** - 10x faster joins using Nested Loop instead of Hash Join
- **Transaction Duration** - Typical order creation < 50ms

### Security

- **Concurrency Control** - Prevents stock oversell through pessimistic locking
- **Idempotency Protection** - Guards against double-submit and network retry scenarios
- **Input Validation** - Comprehensive DTO validation with class-validator
- **Timeout Protection** - Prevents resource exhaustion with statement and lock timeouts

## [0.0.2] - 2026-02-10

### Added

- **TypeORM Integration** - Full TypeORM setup with PostgreSQL support
- **Database Adapter Pattern** - Flexible database provider abstraction with NeonAdapter implementation
- **Entity Models** - User, Order, OrderItem, and Product entities with proper relationships
- **Migration System** - TypeORM migration support with environment-specific configurations
- **Database Seeding** - Idempotent seed data system with production safety checks
- **Database CLI Commands** - npm scripts for running migrations, generating migrations, and seeding
- **Environment-based Paths** - Dynamic entity and migration paths for development and production
- **Database Connection Validation** - Environment variable validation for DATABASE_URL and DATABASE_PROVIDER
- **Feature Modules** - UsersModule, OrdersModule, and ProductsModule with TypeORM integration

### Changed

- **Configuration System** - Enhanced with database adapter factory and provider detection
- **AppModule** - Added TypeOrmModule.forRootAsync with ConfigService integration
- **Environment Schema** - Extended with DATABASE_URL and DATABASE_PROVIDER validation

### Fixed

- **Migration Loading** - Separated migration configuration for CLI vs runtime to prevent ES module errors
- **TypeORM Configuration** - Split getDataSourceOptions() for CLI and getModuleOptions() for NestJS runtime

## [0.0.1] - 2026-01-20

### Added

- **RequestIdMiddleware** - Adds X-Request-ID header to all requests for distributed tracing
- **Error codes** - Machine-readable error codes (BAD_REQUEST, NOT_FOUND, etc.) in error responses
- **Environment-based logging** - APP_LOG_LEVEL environment variable with configurable log levels (error, warn, log, debug, verbose)
- **Cross-platform support** - Added cross-env package for NODE_ENV support on Windows/Mac/Linux
- **Comprehensive README** - Added detailed project documentation with architecture overview and folder structure
- **JSDoc comments** - Added JSDoc documentation to interceptors, filters, and core utilities

### Changed

- **GlobalExceptionFilter** - Enhanced with request ID tracking, removed duplicate logging, added error codes to responses
- **Environment file resolution** - Dynamic .env.{NODE_ENV} file loading without .local suffix
- **npm scripts** - Updated all scripts to set NODE_ENV explicitly using cross-env
- **Error message handling** - Improved formatMessage to handle arrays, objects, and edge cases
- **Logger configuration** - Refactored getLogLevels to use APP_LOG_LEVEL from environment

### Fixed

- **Type safety** - Fixed unsafe assignment of `any` values in transform-response interceptor
- **Error response format** - Standardized error responses with consistent structure and optional fields

### Improved

- **Error logging** - Lightweight logging for client errors (4xx), detailed stack traces for server errors (5xx)
- **Request tracing** - Request IDs now included in both error responses and server logs

## [0.0.1] - 2026-01-20

### Added

- Initial NestJS project setup with TypeScript
- Users module with CRUD operations (mock implementation)
- Type-safe environment management with class-validator
- Global exception filter for standardized error handling
- Transform interceptor for consistent response format
- Graceful shutdown configuration
- Validation pipeline with class-validator
- API versioning (URI-based, default v1)
- ESLint and Prettier configuration
- Husky and lint-staged for pre-commit hooks
- Jest testing setup

[0.0.7]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.7
[0.0.6]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.6
[0.0.5]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.5
[0.0.4]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.4
[0.0.3]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.3
[0.0.2]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.2
[0.0.1]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.1
