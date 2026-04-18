#!/usr/bin/env bash
# Usage: perf-app-grpc-breaker.sh [--build]

BUILD_FLAG=""
if [[ "${1:-}" == "--build" ]]; then
  BUILD_FLAG="--build"
fi

COMPOSE="docker compose -p rd_shop_perf -f compose.perf.yml"

docker compose --compatibility -p rd_shop_perf -f compose.perf.yml --profile app-grpc-breaker up $BUILD_FLAG shop-perf-grpc-breaker
STATUS=$?

$COMPOSE rm -f shop-perf-grpc-breaker grpc-stub-perf 2>/dev/null || true
docker rmi rd_shop_perf_shop_grpc_breaker_tmp rd_shop_perf_grpc_stub_tmp 2>/dev/null || true

exit $STATUS
