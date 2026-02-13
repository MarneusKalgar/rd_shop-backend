# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.0.3]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.3
[0.0.2]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.2
[0.0.1]: https://github.com/yourusername/rd_shop/releases/tag/v0.0.1
