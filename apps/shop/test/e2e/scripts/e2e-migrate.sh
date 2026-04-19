#!/usr/bin/env bash
# Runs shop + payments migrations against e2e databases.
# Called by: npm run e2e:migrate (from apps/shop/)
# Cleans up one-shot migrate images on exit.

set -euo pipefail

COMPOSE="docker compose -p rd_shop_e2e -f compose.e2e.yml"

echo "▶ Running shop migrations..."
$COMPOSE --profile migrate run --rm migrate-shop-e2e
STATUS_SHOP=$?

if [ $STATUS_SHOP -ne 0 ]; then
  echo "✗ Shop migrations failed (exit $STATUS_SHOP)"
  docker rmi rd_shop_e2e_migrate_shop_tmp rd_shop_e2e_migrate_payments_tmp 2>/dev/null || true
  exit $STATUS_SHOP
fi

echo "▶ Running payments migrations..."
$COMPOSE --profile migrate run --rm migrate-payments-e2e
STATUS_PAYMENTS=$?

docker rmi rd_shop_e2e_migrate_shop_tmp rd_shop_e2e_migrate_payments_tmp 2>/dev/null || true

if [ $STATUS_PAYMENTS -ne 0 ]; then
  echo "✗ Payments migrations failed (exit $STATUS_PAYMENTS)"
  exit $STATUS_PAYMENTS
fi

echo "✓ All migrations completed"
