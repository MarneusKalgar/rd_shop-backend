#!/usr/bin/env bash

COMPOSE="docker compose -p rd_shop_perf -f compose.perf.yml"

$COMPOSE --profile seed run --rm seed-perf
STATUS=$?

$COMPOSE rm -f migrate-perf 2>/dev/null || true
docker rmi rd_shop_perf_seed_tmp rd_shop_perf_migrate_tmp 2>/dev/null || true

exit $STATUS
