#!/usr/bin/env bash

COMPOSE="docker compose -p rd_shop_perf -f compose.perf.yml"

$COMPOSE --profile migrate run --rm migrate-perf
STATUS=$?

docker rmi rd_shop_perf_migrate_tmp 2>/dev/null || true

exit $STATUS
