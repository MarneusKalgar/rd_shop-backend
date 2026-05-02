#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYMENTS_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

COMPOSE_PROJECT_BASE_NAME="${COMPOSE_PROJECT_NAME:-rd_shop_backend}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_BASE_NAME}_payments_dev"
export COMPOSE_PROJECT_NAME

DEV_MIGRATE_IMAGE="${COMPOSE_PROJECT_NAME}_migrate_tmp"

COMPOSE=(
  docker
  compose
  --project-name
  "$COMPOSE_PROJECT_NAME"
  -f
  "$PAYMENTS_DIR/compose.yml"
  -f
  "$PAYMENTS_DIR/compose.dev.yml"
)

cleanup_dev_tool_images() {
  docker rmi "$@" 2>/dev/null || true
}