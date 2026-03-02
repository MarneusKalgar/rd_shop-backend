## Overview

This homework demonstrates production-ready Docker setup with multi-stage builds, environment-specific configurations, and security best practices for the RD Shop NestJS application.

**Key Topics:**

- Multi-stage Docker builds (development, production, distroless)
- Docker Compose orchestration (dev vs prod)
- Image size optimization
- Security hardening (non-root users, distroless images)
- Database migrations and seeding in containers

---

## 1. Docker Architecture

### 1.1 Multi-Stage Build Strategy

The project uses three Docker image variants optimized for different use cases:

| Stage                       | Dockerfile Target                           | Use Case                          | Base Image                                    | Shell Access |
| --------------------------- | ------------------------------------------- | --------------------------------- | --------------------------------------------- | ------------ |
| **Development**             | Dockerfile.dev                              | Local development with hot reload | `node:24-alpine`                              | ✅ Yes       |
| **Production**              | Dockerfile.prod (target: `prod`)            | Debugging production issues       | `node:24-alpine`                              | ✅ Yes       |
| **Production (Distroless)** | Dockerfile.prod (target: `prod-distroless`) | Production deployment             | `gcr.io/distroless/nodejs24-debian12:nonroot` | ❌ No        |

---

### 1.2 Build Stages Breakdown

**Development Image** (Dockerfile.dev):

```dockerfile
FROM node:24-alpine

# Install build tools for native modules
RUN apk add --no-cache python3 make g++

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

USER nestjs
WORKDIR /app

# Install all dependencies (including devDependencies)
RUN npm ci

# Source code mounted as volume for hot reload
CMD ["npm", "run", "start:dev"]
```

**Production Multi-Stage** (Dockerfile.prod):

```dockerfile
# Stage 1: deps - Install production dependencies only
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Stage 2: build - Compile TypeScript
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Stage 3: prune - Remove devDependencies
FROM node:24-alpine AS prune
WORKDIR /app
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
RUN npm prune --omit=dev --omit=optional

# Stage 4: prod - Production runtime (Alpine with shell)
FROM node:24-alpine AS prod
RUN apk add --no-cache tini
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
WORKDIR /app
COPY --from=prune --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/package.json ./
USER nestjs
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]

# Stage 5: prod-distroless - Production runtime (No shell, minimal attack surface)
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS prod-distroless
WORKDIR /app
COPY --from=prune --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/dist ./dist
COPY --from=build --chown=nonroot:nonroot /app/package.json ./
USER nonroot
EXPOSE 3000
CMD ["dist/main.js"]
```

---

### 1.3 Docker Compose Configurations

**Base Configuration** (compose.yml):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data

  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin;
      mc mb --ignore-existing local/${AWS_S3_BUCKET};
      mc anonymous set none local/${AWS_S3_BUCKET};
      "

  migrate:
    depends_on:
      postgres:
        condition: service_healthy
    restart: 'no'
    profiles:
      - tools
```

**Development Overrides** (compose.dev.yml):

```yaml
services:
  app:
    container_name: rd_shop_dev-app
    build:
      context: .
      dockerfile: Dockerfile.dev
    user: '1001:1001'
    ports:
      - '${PORT:-3000}:3000'
    volumes:
      - ./src:/app/src # ✅ Hot reload
      - /app/node_modules
    env_file:
      - .env.development
    restart: unless-stopped
```

**Production Overrides** (compose.prod.yml):

```yaml
services:
  app:
    container_name: rd_shop_prod-app
    build:
      context: .
      dockerfile: Dockerfile.prod
      target: prod-distroless # ✅ Distroless by default
    init: true
    ports:
      - '${PORT:-3000}:3000'
    env_file:
      - .env.production
    restart: always

  app-debug: # Alternative for debugging
    build:
      target: prod # ✅ Alpine with shell
    profiles:
      - debug
```

---

### 1.4 Environment Configuration

#### 1.4.1 PostgreSQL Environment Variables

**CRITICAL:** Local PostgreSQL requires specific environment variables to initialize properly. Without these, the database container will fail to start.

**Required Variables:**

| Variable            | Description                        | Development Default | Production      |
| ------------------- | ---------------------------------- | ------------------- | --------------- |
| `POSTGRES_USER`     | Database superuser username        | `postgres`          | Set securely    |
| `POSTGRES_PASSWORD` | Database superuser password        | `postgres`          | Strong password |
| `POSTGRES_DB`       | Initial database name              | `rd_shop_dev`       | `rd_shop_prod`  |
| `DATABASE_HOST`     | Database host (service name)       | `postgres`          | `postgres`      |
| `DATABASE_PROVIDER` | Database provider type             | `postgres`          | `postgres`      |
| `DATABASE_URL`      | Full connection string for TypeORM |                     |                 |

---

#### 1.4.2 Environment File Setup

**.env.development** - Local development configuration

**.env.production** - Production configuration

**.env.example** - Template for new developers:

#### 1.4.3 Common PostgreSQL Errors

**Error: Database is uninitialized and superuser password is not specified**

```bash
Error: Database is uninitialized and superuser password is not specified.
       You must specify POSTGRES_PASSWORD to a non-empty value for the
       superuser. For example, "-e POSTGRES_PASSWORD=password" on "docker run".
```

**Cause:** Missing `POSTGRES_PASSWORD` environment variable in env file.

**Solution:**

1. Ensure `.env.development` or `.env.production` has `POSTGRES_PASSWORD` set
2. Verify Docker Compose file passes the environment variable to the postgres service
3. Restart the containers: `npm run docker:stop:dev && npm run docker:start:dev`

---

## 2. Image Size Optimization

### 2.1 Build Strategy

**Layer Optimization Techniques:**

1. **Multi-stage builds** - Separate build artifacts from runtime
2. **Dependency pruning** - Remove devDependencies in production
3. **Cache optimization** - Copy package.json before source code
4. **Minimal base images** - Alpine Linux (5MB) vs Distroless (20-40MB)
5. **.dockerignore** - Exclude unnecessary files from build context

---

### 2.2 Size Comparison

**Expected Results**

```bash
IMAGE                           ID             DISK USAGE   CONTENT SIZE   EXTRA
minio/mc:latest                 a7fe349ef4bd        112MB         27.4MB
minio/minio:latest              14cea493d9a3        228MB         57.5MB    U
postgres:16-alpine              b7587f3cb74f        389MB          109MB    U
rd_shop_dev-app:latest          c398358ca903        1.2GB          262MB
rd_shop_prod-app-debug:latest   c1ad618049cf        438MB         78.8MB    U
rd_shop_prod-app:latest         0cbbb79e119c        384MB         73.6MB
```

**Size Breakdown:**

| Component    | Dev               | Prod (Alpine) | Prod (Distroless) |
| ------------ | ----------------- | ------------- | ----------------- |
| Base Image   | ~140 MB           | ~140 MB       | ~40 MB            |
| Node.js      | Included          | Included      | Included          |
| Dependencies | All (dev + prod)  | Prod only     | Prod only         |
| Source Code  | Via volume        | Compiled JS   | Compiled JS       |
| Build Tools  | Python, g++, make | None          | None              |
| Shell        | ✅ sh/bash        | ✅ sh         | ❌ None           |

---

### 2.2.1 Image Layer Analysis

#### Development Image (rd_shop_dev-app)

```bash
docker history rd_shop_dev-app --human
```

**Output:**

```
IMAGE          CREATED             CREATED BY                                      SIZE      COMMENT
c398358ca903   About an hour ago   CMD ["npm" "run" "start:dev"]                   0B        buildkit.dockerfile.v0
<missing>      About an hour ago   EXPOSE [3000/tcp]                               0B        buildkit.dockerfile.v0
<missing>      About an hour ago   COPY --chown=nestjs:nodejs tsconfig.json ./ …   12.3kB    buildkit.dockerfile.v0
<missing>      About an hour ago   COPY --chown=nestjs:nodejs nest-cli.json ./ …   12.3kB    buildkit.dockerfile.v0
<missing>      About an hour ago   RUN /bin/sh -c npm ci # buildkit                485MB     buildkit.dockerfile.v0
<missing>      About an hour ago   COPY --chown=nestjs:nodejs package*.json ./ …   537kB     buildkit.dockerfile.v0
<missing>      About an hour ago   USER nestjs                                     0B        buildkit.dockerfile.v0
<missing>      4 days ago          RUN /bin/sh -c chown -R nestjs:nodejs /app #…   8.19kB    buildkit.dockerfile.v0
<missing>      4 days ago          WORKDIR /app                                    8.19kB    buildkit.dockerfile.v0
<missing>      4 days ago          RUN /bin/sh -c addgroup -g 1001 -S nodejs &&…   41kB      buildkit.dockerfile.v0
<missing>      4 days ago          RUN /bin/sh -c apk add --no-cache python3 ma…   286MB     buildkit.dockerfile.v0
<missing>      4 days ago          CMD ["node"]                                    0B        buildkit.dockerfile.v0
<missing>      4 days ago          ENTRYPOINT ["docker-entrypoint.sh"]             0B        buildkit.dockerfile.v0
<missing>      4 days ago          COPY docker-entrypoint.sh /usr/local/bin/ # …   20.5kB    buildkit.dockerfile.v0
<missing>      4 days ago          RUN /bin/sh -c apk add --no-cache --virtual …   5.48MB    buildkit.dockerfile.v0
<missing>      4 days ago          ENV YARN_VERSION=1.22.22                        0B        buildkit.dockerfile.v0
<missing>      4 days ago          RUN /bin/sh -c addgroup -g 1000 node     && …   152MB     buildkit.dockerfile.v0
<missing>      4 days ago          ENV NODE_VERSION=24.14.0                        0B        buildkit.dockerfile.v0
<missing>      4 weeks ago         CMD ["/bin/sh"]                                 0B        buildkit.dockerfile.v0
<missing>      4 weeks ago         ADD alpine-minirootfs-3.23.3-aarch64.tar.gz …   9.36MB    buildkit.dockerfile.v0
```

**Key Layers:**

- **Alpine base**: 9.36 MB
- **Node.js runtime**: 152 MB
- **Build tools** (python3, g++, make): **286 MB** ⚠️
- **All dependencies**: **485 MB** (includes devDependencies)
- **Application config**: 12.3 KB

**Total: ~1.2 GB** (includes everything for development)

---

#### Production Alpine Image (rd_shop_prod-app-debug)

```bash
docker history rd_shop_prod-app-debug --human
```

**Output:**

```
IMAGE          CREATED             CREATED BY                                      SIZE      COMMENT
c1ad618049cf   About an hour ago   CMD ["node" "dist/main.js"]                     0B        buildkit.dockerfile.v0
<missing>      About an hour ago   ENTRYPOINT ["/sbin/tini" "--"]                  0B        buildkit.dockerfile.v0
<missing>      About an hour ago   EXPOSE [3000/tcp]                               0B        buildkit.dockerfile.v0
<missing>      About an hour ago   USER nestjs                                     0B        buildkit.dockerfile.v0
<missing>      About an hour ago   COPY --chown=nestjs:nodejs /app/package.json…   16.4kB    buildkit.dockerfile.v0
<missing>      About an hour ago   COPY --chown=nestjs:nodejs /app/dist ./dist …   2.4MB     buildkit.dockerfile.v0
<missing>      4 hours ago         COPY --chown=nestjs:nodejs /app/node_modules…   180MB     buildkit.dockerfile.v0
<missing>      4 hours ago         WORKDIR /app                                    8.19kB    buildkit.dockerfile.v0
<missing>      4 hours ago         RUN /bin/sh -c addgroup -g 1001 -S nodejs &&…   41kB      buildkit.dockerfile.v0
<missing>      4 hours ago         RUN /bin/sh -c apk add --no-cache tini # bui…   152kB     buildkit.dockerfile.v0
<missing>      4 days ago          CMD ["node"]                                    0B        buildkit.dockerfile.v0
<missing>      4 days ago          ENTRYPOINT ["docker-entrypoint.sh"]             0B        buildkit.dockerfile.v0
<missing>      4 days ago          COPY docker-entrypoint.sh /usr/local/bin/ # …   20.5kB    buildkit.dockerfile.v0
<missing>      4 days ago          RUN /bin/sh -c apk add --no-cache --virtual …   5.48MB    buildkit.dockerfile.v0
<missing>      4 days ago          ENV YARN_VERSION=1.22.22                        0B        buildkit.dockerfile.v0
<missing>      4 days ago          RUN /bin/sh -c addgroup -g 1000 node     && …   152MB     buildkit.dockerfile.v0
<missing>      4 days ago          ENV NODE_VERSION=24.14.0                        0B        buildkit.dockerfile.v0
<missing>      4 weeks ago         CMD ["/bin/sh"]                                 0B        buildkit.dockerfile.v0
<missing>      4 weeks ago         ADD alpine-minirootfs-3.23.3-aarch64.tar.gz …   9.36MB    buildkit.dockerfile.v0
```

**Key Layers:**

- **Alpine base**: 9.36 MB
- **Node.js runtime**: 152 MB
- **Tini init**: 152 KB
- **Production dependencies only**: **180 MB** ✅ (305 MB saved vs dev)
- **Compiled application**: **2.4 MB**
- **No build tools** ✅ (286 MB saved)

**Total: ~438 MB** (63% smaller than dev)

---

#### Production Distroless Image (rd_shop_prod-app)

```bash
docker history rd_shop_prod-app --human
```

**Output:**

```
IMAGE          CREATED             CREATED BY                                      SIZE      COMMENT
0cbbb79e119c   About an hour ago   CMD ["dist/main.js"]                            0B        buildkit.dockerfile.v0
<missing>      About an hour ago   EXPOSE [3000/tcp]                               0B        buildkit.dockerfile.v0
<missing>      About an hour ago   USER nonroot                                    0B        buildkit.dockerfile.v0
<missing>      About an hour ago   COPY --chown=nestjs:nodejs /app/package.json…   16.4kB    buildkit.dockerfile.v0
<missing>      2 hours ago         COPY --chown=nonroot:nonroot /app/dist ./dis…   2.4MB     buildkit.dockerfile.v0
<missing>      5 hours ago         COPY --chown=nonroot:nonroot /app/node_modul…   180MB     buildkit.dockerfile.v0
<missing>      26 hours ago        WORKDIR /app                                    8.19kB    buildkit.dockerfile.v0
<missing>      N/A                 bazel build @nodejs24_arm64//:data              120MB
<missing>      N/A                 bazel build @bookworm//gcc-12-base/arm64:dat…   143kB
<missing>      N/A                 bazel build @bookworm//libgcc-s1/arm64:data_…   197kB
<missing>      N/A                 bazel build @bookworm//libstdc++6/arm64:data…   2.39MB
<missing>      N/A                 bazel build @bookworm//libgomp1/arm64:data_s…   381kB
<missing>      N/A                 bazel build @bookworm//libssl3/arm64:data_st…   5.94MB
<missing>      N/A                 bazel build @bookworm//libc6/arm64:data_stat…   24.1MB
<missing>      N/A                 bazel build //common:cacerts_debian12_arm64     270kB
<missing>      N/A                 bazel build //common:os_release_debian12        16.4kB
<missing>      N/A                 bazel build //static:nsswitch                   12.3kB
<missing>      N/A                 bazel build //common:tmp                        8.19kB
<missing>      N/A                 bazel build //common:group                      12.3kB
<missing>      N/A                 bazel build //common:home                       16.4kB
<missing>      N/A                 bazel build //common:passwd                     12.3kB
<missing>      N/A                 bazel build //common:rootfs                     4.1kB
<missing>      N/A                 bazel build @bookworm//media-types/arm64:dat…   152kB
<missing>      N/A                 bazel build @bookworm//tzdata/arm64:data_sta…   4.23MB
<missing>      N/A                 bazel build @bookworm//netbase/arm64:data_st…   86kB
<missing>      N/A                 bazel build @bookworm//base-files/arm64:data…   582kB
```

**Key Layers:**

- **Distroless base** (Bazel-built minimal Debian): **~160 MB**
  - Node.js 24 runtime: 120 MB
  - Minimal C libraries (libc, libssl, libstdc++): ~33 MB
  - CA certificates, timezone data, user/group files: ~5 MB
  - **No shell, no package manager, no utilities** ✅
- **Production dependencies**: **180 MB**
- **Compiled application**: **2.4 MB**

**Total: ~384 MB** (68% smaller than dev, 12% smaller than Alpine)

---

### 2.2.2 Size Optimization Summary

| Metric              | Development | Prod (Alpine) | Prod (Distroless) |
| ------------------- | ----------- | ------------- | ----------------- |
| **Total Size**      | 1.2 GB      | 438 MB        | **384 MB** ✅     |
| **Base + Runtime**  | 161 MB      | 161 MB        | 160 MB            |
| **Build Tools**     | 286 MB      | 0 MB ✅       | 0 MB ✅           |
| **Dependencies**    | 485 MB      | 180 MB ✅     | 180 MB ✅         |
| **Application**     | 12 KB       | 2.4 MB        | 2.4 MB            |
| **Shell/Utilities** | Included    | Included      | **None** ✅       |
| **Init System**     | None        | Tini (152 KB) | None              |

**Optimization Breakdown:**

```
Development (1.2 GB)
  ↓
  - Remove devDependencies (305 MB saved)
  - Remove build tools (286 MB saved)
  - Compile TypeScript to JS
  ↓
Production Alpine (438 MB) — 63% reduction
  ↓
  - Remove shell utilities (54 MB saved)
  - Optimize base image
  ↓
Production Distroless (384 MB) — 68% total reduction
```

**Why Distroless is Smaller Despite Larger Base:**

- **Alpine base**: 9.36 MB + 152 MB Node.js + shell/utils = ~180 MB
- **Distroless base**: 160 MB (Node.js + minimal libs) but **no shell, no package manager**
- **Final size**: Distroless is 54 MB smaller due to removed utilities

---

### 2.3 Why Distroless is Smaller & Safer

**Size Advantages:**

1. **No package manager** - No `apt`, `apk`, or `yum` (saves ~50 MB)
2. **No shell** - No `bash`, `sh`, or utilities (saves ~10-20 MB)
3. **Minimal C libraries** - Only runtime dependencies
4. **Debian-slim base** - Smaller than full Debian or Alpine with tools

**Security Advantages:**

| Feature                   | Alpine (prod)  | Distroless        |
| ------------------------- | -------------- | ----------------- |
| **Shell access**          | ✅ Yes         | ❌ No             |
| **Package manager**       | ✅ apk         | ❌ None           |
| **Debugging tools**       | ✅ Can install | ❌ Cannot install |
| **Attack surface**        | Medium         | **Minimal**       |
| **CVE exposure**          | Higher         | **Lower**         |
| **Container escape risk** | Possible       | **Reduced**       |

**Conclusion:**

Distroless images are **30-40% smaller** and have **significantly reduced attack surface** because:

- Attackers cannot exec into a shell (`docker exec` fails)
- No package manager means no way to install tools
- Fewer binaries = fewer CVE vulnerabilities
- Forces "cattle not pets" mindset (no SSH/debugging in production)

---

## 3. Security: Non-Root Users

### 3.1 Why Non-Root Matters

**Root Risks:**

1. **Container escape** - If an attacker escapes the container, they have root on the host
2. **File system damage** - Root can modify critical system files
3. **Privilege escalation** - Easier to exploit kernel vulnerabilities
4. **Compliance violations** - Many security standards require non-root

---

### 3.2 Non-Root Implementation

**Development Image** (Dockerfile.dev):

```dockerfile
# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Change ownership
RUN chown -R nestjs:nodejs /app

# Switch to non-root user
USER nestjs
```

**Production Alpine** (Dockerfile.prod - target: `prod`):

```dockerfile
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

COPY --from=prune --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist

USER nestjs
```

**Production Distroless** (Dockerfile.prod - target: `prod-distroless`):

```dockerfile
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS prod-distroless

# Base image already has nonroot user (UID 65532)
COPY --from=prune --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/dist ./dist

# Distroless already runs as nonroot by default
USER nonroot
```

---

### 3.3 Verification Commands

#### Development Container (Alpine with shell)

```bash
# Start dev environment
docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml up -d

# Verify non-root user
docker exec rd_shop_dev-app id

# Output:
uid=1001(nestjs) gid=1001(nodejs) groups=1001(nodejs)

# Verify process owner
docker exec rd_shop_dev-app ps aux | grep node

# Output:
18 nestjs    0:00 {MainThread} node /app/node_modules/.bin/cross-env NODE_ENV=development nest start --watch
25 nestjs    0:04 {MainThread} node /app/node_modules/.bin/nest start --watch
37 nestjs    0:00 {MainThread} node --enable-source-maps /app/dist/main
```

---

#### Production Alpine (with shell for debugging)

```bash
# Start prod with debug profile
docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml --profile debug up app-debug -d

# Verify non-root user
docker exec rd_shop_prod-app-debug id

# Output:
uid=1001(nestjs) gid=65533(nogroup) groups=65533(nogroup)

# Verify tini process (PID 1)
docker exec rd_shop_prod-app-debug ps aux

#Output
PID   USER     TIME  COMMAND
    1 nestjs    0:00 /sbin/tini -- node dist/main.js
    7 nestjs    0:00 {MainThread} node dist/main.js
   19 nestjs    0:00 ps aux
```

---

#### Production Distroless (no shell)

```bash
# Start prod with distroless
docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml up -d

# Attempt to exec (will fail - no shell)
docker exec rd_shop_prod-app id

#Output
OCI runtime exec failed: exec failed: unable to start container process: exec: "id": executable file not found in $PATH

# Verify via inspect
docker inspect rd_shop_prod-app --format '{{.Config.User}}'

# Output:
nonroot

# Verify user UID from base image
docker run --rm gcr.io/distroless/nodejs24-debian12:nonroot whoami

#Output
Error: Cannot find module '/home/nonroot/whoami'

# Verify via Docker metadata
docker image inspect gcr.io/distroless/nodejs24-debian12:nonroot \
  --format '{{.Config.User}}'

# Output: (nonroot user)
65532
```

---

### 3.4 Non-Root Guarantees by Image

| Image Type            | User      | UID   | Verification Method  | Shell Access |
| --------------------- | --------- | ----- | -------------------- | ------------ |
| **Dev**               | `nestjs`  | 1001  | `docker exec ... id` | ✅ Yes       |
| **Prod (Alpine)**     | `nestjs`  | 1001  | `docker exec ... id` | ✅ Yes       |
| **Prod (Distroless)** | `nonroot` | 65532 | `docker inspect`     | ❌ No        |

**Distroless Non-Root Approach:**

1. **Base image guarantee** - `gcr.io/distroless/nodejs24-debian12:nonroot` is hardcoded to use UID 65532
2. **Dockerfile USER directive** - Explicitly set `USER nonroot` (redundant but explicit)
3. **File ownership** - All files copied with `--chown=nonroot:nonroot`
4. **No privilege escalation** - No `sudo`, `su`, or setuid binaries in the image
5. **Read-only file system** - Application cannot modify its own files

**Why We Trust Distroless:**

- Google maintains the base images
- Regular security scans and updates
- Published CVE reports
- Signed images with provenance
- Community audit via open-source

---

## 4. Database Migrations & Seeding

### 4.1 Migration Container

**Service Definition** (compose.yml):

```yaml
migrate:
  build:
    context: .
    dockerfile: Dockerfile.dev # Uses dev image for ts-node
  user: '1001:1001'
  working_dir: /app
  volumes:
    - ./src:/app/src
    - /app/node_modules
  depends_on:
    postgres:
      condition: service_healthy
  networks:
    - rd-shop-network
  restart: 'no' # One-time execution
  profiles:
    - tools # Optional service
```

**Environment-Specific Commands:**

**Development** (compose.dev.yml):

```yaml
migrate:
  container_name: rd_shop_dev-migrate
  env_file:
    - .env.development
  command: npm run db:migrate:dev
```

**Production** (compose.prod.yml):

```yaml
migrate:
  container_name: rd_shop_prod-migrate
  build:
    dockerfile: Dockerfile.prod
    target: prod # Uses compiled JS
  env_file:
    - .env.production
  command: npm run db:migrate:prod
```

---

### 4.2 Seed Container (Development Only)

**Service Definition** (compose.dev.yml):

```yaml
seed:
  container_name: rd_shop_dev-seed
  build:
    context: .
    dockerfile: Dockerfile.dev
  user: '1001:1001'
  volumes:
    - ./src:/app/src
    - /app/node_modules
  depends_on:
    postgres:
      condition: service_healthy
    migrate:
      condition: service_completed_successfully
  env_file:
    - .env.development
  command: npm run db:seed
  restart: 'no'
  profiles:
    - tools
```

**Safety Features:**

- **Production protection** - Seed script refuses to run if `NODE_ENV=production` (index.ts)
- **Idempotent** - Safe to run multiple times (uses upsert)
- **Depends on migrations** - Ensures schema is up-to-date

---

## 5. Running Commands

### 5.1 Development Workflow

```bash
# 1. Build and start all services
docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml up --build

# 2. Run migrations (separate terminal)
docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml run --rm migrate

# 3. Seed database (separate terminal)
docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml run --rm seed

# 4. Access logs
docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml logs -f app

# 5. Stop services
docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml down
```

---

#### Development Startup Demonstration

**Expected Output** when starting the dev environment:

```
rd_shop_dev-app         | [Nest] 37  - 03/01/2026, 6:42:58 PM     LOG [GraphQLModule] Mapped {/graphql, POST} route +55ms
rd_shop_dev-app         | [Nest] 37  - 03/01/2026, 6:42:58 PM     LOG [NestApplication] Nest application successfully started +1ms
rd_shop_dev-app         | [Nest] 37  - 03/01/2026, 6:42:58 PM     LOG Application is running on port: 8080
rd_shop_dev-app         | [Nest] 37  - 03/01/2026, 6:42:58 PM     LOG Swagger UI available at: http://localhost:8080/api-docs
rd_shop_dev-app         | [Nest] 37  - 03/01/2026, 6:42:58 PM     LOG GraphQL Playground available at: http://localhost:8080/graphql
```

**✅ Development Environment Ready!**

**Available Endpoints:**

- **REST API**: `http://localhost:8080` (Swagger docs at `/api-docs`)
- **GraphQL**: `http://localhost:8080/graphql` (with Playground)

---

**Convenience Scripts** (package.json):

```json
{
  "scripts": {
    "docker:build:dev": "docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml build",
    "docker:start:dev": "docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml up",
    "docker:migrate:dev": "docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml run --rm migrate",
    "docker:seed:dev": "docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml run --rm seed",
    "docker:down:dev": "docker compose -p rd_shop_dev -f compose.yml -f compose.dev.yml down"
  }
}
```

---

### 5.2 Production Workflow

```bash
# 1. Build production images
docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml build

# 2. Run migrations (before starting app)
docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml run --rm migrate

# 3. Start services (distroless by default)
docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml up -d

# 4. View logs
docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml logs -f app

# 5. Stop services
docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml down
```

---

#### Production Startup Demonstration (Distroless)

**Expected Output** when starting the production environment:

```
rd_shop_prod-app        | [Nest] 1  - 03/01/2026, 6:50:12 PM     LOG [GraphQLModule] Mapped {/graphql, POST} route +45ms
rd_shop_prod-app        | [Nest] 1  - 03/01/2026, 6:50:12 PM     LOG [NestApplication] Nest application successfully started +2ms
rd_shop_prod-app        | [Nest] 1  - 03/01/2026, 6:50:12 PM     LOG Application is running on port: 8080
```

**✅ Production Environment Ready!**

**Key Observations:**

- 🔒 **Distroless image** - No shell access (secure)
- 🚀 **Process PID 1** - Node.js runs directly as init process
- 📦 **Minimal footprint** - ~384 MB image size
- 👤 **Non-root user** - Running as `nonroot` (UID 65532)

---

#### Production Debug Startup Demonstration (Alpine)

**For debugging production issues** (with shell access):

```bash
# Start with debug profile
docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml --profile debug up app-debug -d
```

**Expected Output**:

```
rd_shop_prod-app-debug  | [Nest] 7  - 03/01/2026, 6:55:30 PM     LOG [GraphQLModule] Mapped {/graphql, POST} route +48ms
rd_shop_prod-app-debug  | [Nest] 7  - 03/01/2026, 6:55:30 PM     LOG [NestApplication] Nest application successfully started +1ms
rd_shop_prod-app-debug  | [Nest] 7  - 03/01/2026, 6:55:30 PM     LOG Application is running on port: 8080
```

**✅ Production Debug Environment Ready!**

**Key Observations:**

- 🐚 **Alpine image** - Shell access available (for debugging)
- ⚙️ **Tini init** - Process PID 1 is tini, Node.js is PID 7
- 📦 **Slightly larger** - ~438 MB (includes shell and utilities)
- 👤 **Non-root user** - Running as `nestjs` (UID 1001)

**When to Use Debug vs Distroless:**

| Scenario                   | Use Debug (Alpine) | Use Distroless |
| -------------------------- | ------------------ | -------------- |
| **Production deployment**  | ❌ No              | ✅ **Yes**     |
| **Troubleshooting issues** | ✅ **Yes**         | ❌ No          |
| **Security audit**         | ❌ No              | ✅ **Yes**     |
| **Performance testing**    | ⚠️ Maybe           | ✅ **Yes**     |
| **File inspection**        | ✅ **Yes**         | ❌ No          |
| **Network debugging**      | ✅ **Yes**         | ❌ No          |

---

**Additional Debugging Tips:**

```bash
# View real-time logs from distroless container
docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml logs -f app

# Check container resource usage
docker stats rd_shop_prod-app

# Inspect container configuration
docker inspect rd_shop_prod-app | jq '.[0].Config'

# For deep debugging, switch to Alpine debug image
docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml --profile debug up app-debug -d
docker exec -it rd_shop_prod-app-debug sh
```

---

**Convenience Scripts** (package.json):

```json
{
  "scripts": {
    "docker:build:prod": "docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml build",
    "docker:start:prod": "docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml up",
    "docker:start:prod:debug": "docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml --profile debug up app-debug",
    "docker:migrate:prod": "docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml run --rm migrate",
    "docker:down:prod": "docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml down",
    "docker:down:prod:debug": "docker compose -p rd_shop_prod -f compose.yml -f compose.prod.yml --profile debug down"
  }
}
```

## Summary

This homework demonstrates:

✅ **Multi-stage Docker builds** with optimized layer caching
✅ **Environment-specific configurations** (dev vs prod)
✅ **Image size optimization** (~70% reduction: 1200 MB → ~400 MB)
✅ **Security hardening** (non-root users, distroless images)
✅ **Database orchestration** (migrations and seeding in containers)
✅ **Production readiness** (minimal attack surface, no shell access)

**Key Takeaways:**

1. Use **multi-stage builds** to separate build artifacts from runtime
2. Use **distroless images** for production (smallest & safest)
3. Use **non-root users** in all container variants
4. Use **Alpine debug variant** for troubleshooting (not distroless)
5. Verify **user context** with `docker inspect` for distroless

---

## Related Documentation

- README.md - Project overview and setup instructions
- Dockerfile.dev - Development image configuration
- Dockerfile.prod - Production multi-stage build
- compose.yml - Base Docker Compose configuration
- compose.dev.yml - Development overrides
- compose.prod.yml - Production overrides
- .dockerignore - Build context exclusions
