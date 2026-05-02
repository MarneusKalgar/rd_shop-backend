#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_dev-compose-common.sh"

RUN_ARGS=(run --rm seed)
if [[ "${1:-}" == "--build" ]]; then
  RUN_ARGS=(run --rm --build seed)
fi

echo "▶ Running dev seed with project: $COMPOSE_PROJECT_NAME"

if "${COMPOSE[@]}" "${RUN_ARGS[@]}"; then
  STATUS=0
else
  STATUS=$?
fi

"${COMPOSE[@]}" rm -f migrate 2>/dev/null || true
cleanup_dev_tool_images "$DEV_SEED_IMAGE" "$DEV_MIGRATE_IMAGE"

exit "$STATUS"