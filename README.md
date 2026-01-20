# RD Shop Backend - NestJS REST API

A production-ready, type-safe REST API built with NestJS, featuring comprehensive environment management, graceful shutdown handling, and standardized error responses.

## 🚀 Features

- **Type-Safe Environment Management** - Runtime validation with class-validator
- **Graceful Shutdown** - Proper cleanup of resources and connections
- **Global Error Handling** - Consistent error responses with request tracing
- **Request/Response Interceptors** - Standardized API response format
- **Validation** - Automatic DTO validation with class-validator
- **API Versioning** - URI-based versioning (default: v1)
- **Request Tracing** - X-Request-ID header for distributed tracing
- **Configurable Logging** - Environment-based log levels
- **Cross-Platform Support** - Works on Windows, macOS, and Linux

## 🛠️ Technology Stack

### Core Framework

- **[NestJS](https://nestjs.com/)** ^11.0.1 - Progressive Node.js framework
- **[TypeScript](https://www.typescriptlang.org/)** ^5.7.3 - Type-safe JavaScript
- **[Node.js](https://nodejs.org/)** - Runtime environment
- **[Express](https://expressjs.com/)** - HTTP server

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

## 📋 Prerequisites

- Node.js (v18+ recommended)
- npm or yarn
- Git

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

The API will be available at `http://localhost:4000` (or your configured PORT).

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
│   │   ├── filters/               # Exception filters
│   │   │   ├── http-exception.ts  # Global exception filter
│   │   │   └── index.ts
│   │   ├── interceptors/          # Request/response interceptors
│   │   │   ├── transform-response.ts  # Wraps responses
│   │   │   └── index.ts
│   │   └── middlewares/           # HTTP middlewares
│   │       ├── request-id.ts      # Adds X-Request-ID
│   │       └── index.ts
│   │
│   ├── config/                    # Application configuration
│   │   ├── graceful-shutdown.ts   # Graceful shutdown config
│   │   ├── logger.ts              # Log level management
│   │   └── index.ts
│   │
│   ├── core/                      # Core utilities
│   │   ├── environment/           # Environment management
│   │   │   ├── constants.ts       # Default values
│   │   │   ├── injectConfig.ts    # @InjectConfig decorator
│   │   │   ├── schema.ts          # Environment schema
│   │   │   ├── types.ts           # TypeScript types
│   │   │   ├── utils.ts           # Helper functions
│   │   │   ├── validation.ts      # Env validation
│   │   │   └── index.ts
│   │   └── process/               # Process error handlers
│   │       └── index.ts
│   │
│   ├── users/                     # Users feature module
│   │   ├── dto/                   # Data Transfer Objects
│   │   │   ├── create-user.ts
│   │   │   ├── update-user.ts
│   │   │   └── index.ts
│   │   ├── interfaces/            # TypeScript interfaces
│   │   │   └── index.ts
│   │   ├── users.controller.ts    # HTTP endpoints
│   │   ├── users.service.ts       # Business logic
│   │   └── users.module.ts        # Module definition
│   │
│   ├── utils/                     # Utility functions
│   │   ├── env.ts
│   │   └── index.ts
│   │
│   ├── app.controller.ts          # Root controller
│   ├── app.service.ts             # Root service
│   ├── app.module.ts              # Root module
│   └── main.ts                    # Application bootstrap
│
├── test/                          # E2E tests
├── .env.example                   # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

### Folder Descriptions

#### `/src/common/` - Shared Components

Contains reusable components used across the application:

- **filters/** - Exception filters for error handling
- **interceptors/** - Request/response transformation
- **middlewares/** - HTTP middleware (e.g., request ID)

#### `/src/config/` - Application Configuration

Application-level configuration files:

- Graceful shutdown settings
- Logger configuration
- Environment-specific settings

#### `/src/core/` - Core Utilities

Framework-level utilities and infrastructure:

- **environment/** - Complete environment management system with validation
- **process/** - Process-level error handlers

#### `/src/users/` - Feature Module Example

Example of a feature module structure:

- **dto/** - Request/response validation schemas
- **interfaces/** - TypeScript interfaces
- **controller** - HTTP route handlers
- **service** - Business logic
- **module** - Module configuration

#### `/src/utils/` - Utility Functions

Helper functions and utilities used across the app.

## 🔌 API Endpoints

### Base URL

```
http://localhost:4000/api/v1
```

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

- [ ] Database integration (TypeORM + PostgreSQL)
- [ ] Authentication & Authorization (JWT)
- [ ] Health check endpoint
- [ ] Rate limiting
- [ ] Redis caching
- [ ] API documentation (Swagger)
- [ ] Docker support

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
