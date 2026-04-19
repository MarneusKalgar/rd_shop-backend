#!/usr/bin/env bash
# Runs shop + payments migrations against e2e databases.
# Called by: npm run e2e:migrate (from apps/shop/)
# Cleans up one-shot migrate images on exit.

set -uo pipefail

COMPOSE="docker compose -p rd_shop_e2e -f compose.e2e.yml"

echo "▶ Running shop migrations..."
if ! $COMPOSE --profile migrate run --rm migrate-shop-e2e; then
  echo "✗ Shop migrations failed"
  docker rmi rd_shop_e2e_migrate_shop_tmp rd_shop_e2e_migrate_payments_tmp 2>/dev/null || true
  exit 1
fi

echo "▶ Running payments migrations..."
if ! $COMPOSE --profile migrate run --rm migrate-payments-e2e; then
  docker rmi rd_shop_e2e_migrate_shop_tmp rd_shop_e2e_migrate_payments_tmp 2>/dev/null || true
  echo "✗ Payments migrations failed"
  exit 1
fi

docker rmi rd_shop_e2e_migrate_shop_tmp rd_shop_e2e_migrate_payments_tmp 2>/dev/null || true

echo "✓ All migrations completed"
