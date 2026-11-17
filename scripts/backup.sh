#!/usr/bin/env bash
# Daily backup of the database and uploaded files; keeps the last 14 days.
#
#   bash scripts/backup.sh
# cron (every night at 02:30):
#   30 2 * * * cd /opt/todo-strapi && bash scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p backups

# consistent copy of the live SQLite database (safe while Strapi is running)
docker compose exec -T strapi node -e "
  require('better-sqlite3')('/app/data/data.db', { readonly: true })
    .backup('/app/data/backup-tmp.db')
    .then(() => console.log('db ok'))
    .catch((e) => { console.error(e); process.exit(1); });
"
mv data/db/backup-tmp.db "backups/db-${STAMP}.db"
gzip -f "backups/db-${STAMP}.db"

tar -czf "backups/uploads-${STAMP}.tar.gz" -C data uploads

find backups -name 'db-*.db.gz' -mtime +14 -delete
find backups -name 'uploads-*.tar.gz' -mtime +14 -delete

echo "$(date -Is) backup done: db-${STAMP}.db.gz, uploads-${STAMP}.tar.gz"
