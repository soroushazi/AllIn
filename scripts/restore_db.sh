#!/usr/bin/env bash
# Restores a gzipped pg_dump produced by backup_db.sh into the running
# production database. DESTRUCTIVE - erases and replaces all current data
# (the dump was made with --clean --if-exists, so it drops existing tables
# first). Prompts for confirmation unless --yes is passed.
#
# Usage:
#   ./scripts/restore_db.sh ~/jiring-backups/jiring-2026-08-25-030000.sql.gz
#   ./scripts/restore_db.sh /path/to/downloaded-from-object-storage.sql.gz --yes

set -euo pipefail
cd "$(dirname "$0")/.."

dump_file="${1:?Usage: restore_db.sh <dump.sql.gz> [--yes]}"
[[ -f "$dump_file" ]] || { echo "No such file: $dump_file" >&2; exit 1; }

if [[ "${2:-}" != "--yes" ]]; then
  read -r -p "This will ERASE the current database and replace it with the contents of $dump_file. Type 'yes' to continue: " confirm
  [[ "$confirm" == "yes" ]] || { echo "Aborted."; exit 1; }
fi

COMPOSE="docker compose -f docker-compose.prod.yml"
gunzip -c "$dump_file" | $COMPOSE exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
echo "Restored from $dump_file"
