#!/bin/sh
set -eu

project_dir=/opt/four-in-a-row
backup_dir=/var/backups/four-in-a-row
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
partial="$backup_dir/postgres-$timestamp.sql.gz.partial"
destination="$backup_dir/postgres-$timestamp.sql.gz"

install -d -m 0700 "$backup_dir"
trap 'rm -f "$partial"' EXIT INT TERM

cd "$project_dir"
docker compose --env-file .env -f docker-compose.production.yml exec -T postgres \
  pg_dump --clean --if-exists --no-owner -U four -d four | gzip -9 > "$partial"

mv "$partial" "$destination"
trap - EXIT INT TERM
find "$backup_dir" -maxdepth 1 -type f -name 'postgres-*.sql.gz' -mtime +14 -delete
