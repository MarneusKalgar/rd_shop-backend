#!/usr/bin/env bash
# Seeds the shop database with products / users for e2e tests.
# Called by: npm run e2e:seed (from apps/shop/)
# Cleans up one-shot seed + migrate images on exit.

COMPOSE="docker compose -p rd_shop_e2e -f compose.e2e.yml"

$COMPOSE --profile seed run --rm seed-shop-e2e
STATUS=$?

$COMPOSE rm -f migrate-shop-e2e migrate-payments-e2e 2>/dev/null || true
docker rmi rd_shop_e2e_seed_shop_tmp rd_shop_e2e_migrate_shop_tmp rd_shop_e2e_migrate_payments_tmp 2>/dev/null || true

exit $STATUS
