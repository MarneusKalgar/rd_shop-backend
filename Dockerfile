ARG APP=shop


# ============================================
# Stage: deps - Install dependencies
# ============================================
FROM node:24-alpine AS deps

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force


# ============================================
# Stage: build - Build the application
# ============================================
FROM node:24-alpine AS build

ARG APP=shop

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies)
RUN npm ci && \
    npm cache clean --force

# Copy source code and configuration files
COPY tsconfig.json ./
COPY tsconfig.build.json ./
COPY nest-cli.json ./
# COPY src ./src
COPY proto ./proto
COPY apps ./apps
COPY libs ./libs

# Copy proto file into app locations
RUN mkdir -p apps/${APP}/src/proto && \
    cp proto/payments.proto apps/${APP}/src/proto/payments.proto

# Build common lib first so @app/common declarations are available
RUN npm run build -- common

# Build the application
RUN npm run build -- ${APP}

# Create @app/common symlink for runtime module resolution
RUN mkdir -p dist/node_modules/@app && \
    ln -s ../../../libs/common dist/node_modules/@app/common

# Copy proto file into app locations
RUN cp proto/payments.proto dist/apps/${APP}/proto/payments.proto && \
    rm -rf proto apps/${APP}/src/proto


# ============================================
# Stage: prune - Remove devDependencies
# ============================================
FROM node:24-alpine AS prune

WORKDIR /app

COPY package*.json ./

# Copy all node_modules from build
COPY --from=build /app/node_modules ./node_modules

# Remove devDependencies
RUN npm prune --omit=dev --omit=optional && \
    npm cache clean --force


# ============================================
# Stage: prod-base (internal, not targeted directly)
# ============================================
FROM node:24-alpine AS prod-base

# Install tini for proper signal handling
RUN apk add --no-cache tini

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /app

# Copy production dependencies from prune stage
COPY --from=prune --chown=nestjs:nodejs /app/node_modules ./node_modules

# Copy built application from build stage
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/package.json ./
COPY --from=build --chown=nestjs:nodejs /app/apps/shop/package.json ./apps/shop/package.json
COPY --from=build --chown=nestjs:nodejs /app/apps/payments/package.json ./apps/payments/package.json

# Switch to non-root user
USER nestjs

# Expose application port
EXPOSE 3000

# Use tini to handle signals properly
ENTRYPOINT ["/sbin/tini", "--"]

# ============================================
# Stage: prod-shop
# ============================================
FROM prod-base AS prod-shop

CMD ["node", "dist/apps/shop/main.js"]

# ============================================
# Stage: prod-payments
# ============================================
FROM prod-base AS prod-payments

CMD ["node", "dist/apps/payments/main.js"]

# ============================================
# Stage: strip - Remove source maps (for distroless image)
# ============================================
FROM node:24-alpine AS strip

WORKDIR /app
COPY --from=build /app/dist ./dist
RUN find dist -name "*.js.map" -delete


# ============================================
# Stage: prod-distroless base - Production runtime (Distroless)
# ============================================
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS prod-distroless-base

WORKDIR /app

# Copy production dependencies from prune stage
COPY --from=prune --chown=nonroot:nonroot /app/node_modules ./node_modules

# Copy built application from build stage
COPY --from=strip --chown=nonroot:nonroot /app/dist ./dist
COPY --from=build --chown=nonroot:nonroot /app/package.json ./

# Distroless already uses nonroot user (UID 65532)
USER nonroot

# Expose application port
EXPOSE 3000

# ============================================
# Stage: prod-distroless-shop
# ============================================
FROM prod-distroless-base AS prod-distroless-shop

CMD ["dist/apps/shop/main.js"]

# ============================================
# Stage: prod-distroless-payments
# ============================================
FROM prod-distroless-base AS prod-distroless-payments

CMD ["dist/apps/payments/main.js"]
