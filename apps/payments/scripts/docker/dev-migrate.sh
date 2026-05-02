#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_dev-compose-common.sh"

RUN_ARGS=(run --rm migrate)
if [[ "${1:-}" == "--build" ]]; then
  RUN_ARGS=(run --rm --build migrate)
fi

echo "▶ Running payments dev migrations with project: $COMPOSE_PROJECT_NAME"

if "${COMPOSE[@]}" "${RUN_ARGS[@]}"; then
  STATUS=0
else
  STATUS=$?
fi

cleanup_dev_tool_images "$DEV_MIGRATE_IMAGE"

exit "$STATUS"