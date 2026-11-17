#!/usr/bin/env bash
# One-time: put the database and photos copied from the laptop into place.
# Expects the uploaded files in ~/import/data.db and ~/import/uploads/.
#
#   bash scripts/import-local-data.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:-$HOME/import}"
[ -f "$SRC/data.db" ] || { echo "Missing $SRC/data.db"; exit 1; }

docker compose stop strapi 2>/dev/null || true
mkdir -p data/db data/uploads

if [ -f data/db/data.db ]; then
  mv data/db/data.db "data/db/data.db.before-import-$(date +%s)"
fi
cp "$SRC/data.db" data/db/data.db
[ -d "$SRC/uploads" ] && cp -a "$SRC/uploads/." data/uploads/

# push subscriptions from localhost don't work with the server's new keys
docker compose run --rm --no-deps strapi node -e "
  const db = require('better-sqlite3')('/app/data/data.db');
  for (const t of ['push_subscriptions_user_lnk', 'push_subscriptions']) {
    try { db.prepare('DELETE FROM ' + t).run(); } catch (e) {}
  }
  console.log('old push subscriptions removed');
"

docker compose up -d strapi
echo "Import done. Users log in with their existing passwords."
