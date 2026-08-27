#!/usr/bin/env bash
# Nightly database backup, run from cron on the VPS.
#
# Writes a restorable .sql dump (schema + data) to /root/bdcrm-backups and keeps
# the last 30 days. The dump is read-only against production — it only SELECTs.
#
# Install (already done on the VPS, kept here so it can be recreated):
#   crontab -e
#   15 3 * * * /opt/farahi-lead-scraper/scripts/backup-nightly.sh >> /root/bdcrm-backups/backup.log 2>&1
set -euo pipefail

APP_DIR="/opt/farahi-lead-scraper"
DEST="/root/bdcrm-backups"
KEEP_DAYS=30

mkdir -p "$DEST"
cd "$APP_DIR"

echo "=== $(date -Is) starting backup ==="

# db-dump.mjs always writes into ./backups; move the result to $DEST afterwards.
node scripts/migration/db-dump.mjs

latest="$(ls -t backups/farahi-prod-*.sql 2>/dev/null | head -1 || true)"
if [ -z "$latest" ]; then
  echo "ERROR: no dump file was produced" >&2
  exit 1
fi

# A dump that is suspiciously small means the export failed part-way; keep it,
# but say so loudly rather than letting it quietly replace good backups.
size=$(stat -c%s "$latest")
if [ "$size" -lt 100000 ]; then
  echo "WARNING: dump is only ${size} bytes — check the database before trusting it" >&2
fi

gzip -f "$latest"
mv "${latest}.gz" "$DEST/"
echo "saved $DEST/$(basename "${latest}").gz ($(du -h "$DEST/$(basename "${latest}").gz" | cut -f1))"

# Rotate: drop anything older than KEEP_DAYS.
deleted=$(find "$DEST" -name 'farahi-prod-*.sql.gz' -mtime "+${KEEP_DAYS}" -print -delete | wc -l)
[ "$deleted" -gt 0 ] && echo "rotated out $deleted backup(s) older than ${KEEP_DAYS} days"

echo "=== $(date -Is) done — $(ls -1 "$DEST"/farahi-prod-*.sql.gz | wc -l) backups on disk ==="
