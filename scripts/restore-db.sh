#!/bin/bash
# Restore PostgreSQL from a Vercel Blob backup.
# USE WITH CAUTION — overwrites existing data in the target database.
#
# Usage:
#   ./scripts/restore-db.sh
#   ./scripts/restore-db.sh quantum_sport_20260629_023000.dump

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

BACKUP_NAME="${1:-}"

print_header "Quantum Sport — Database Restore"

require_project_root
require_docker
validate_env_file
export_compose_env
load_backup_env
resolve_local_backup_dir
blob_assert_safe_prefix
blob_validate_credentials

if [ -z "$BACKUP_NAME" ]; then
  print_info "Available backups under ${BLOB_BACKUP_PREFIX}/:"
  blob_cli list
  echo ""
  print_info "Usage: ./scripts/restore-db.sh <backup-filename.dump>"
  exit 0
fi

if [[ "$BACKUP_NAME" != *.dump ]]; then
  print_error "Backup filename must end with .dump"
  exit 1
fi

if ! compose -f docker-compose.prod.yml ps db 2>/dev/null | grep -q "Up"; then
  print_error "Database container is not running"
  exit 1
fi

LOCAL_PATH="${LOCAL_BACKUP_DIR}/${BACKUP_NAME}"

print_warning "This will REPLACE all data in database '${DB_NAME}'"
read -r -p "Type the database name to confirm: " confirm
if [ "$confirm" != "$DB_NAME" ]; then
  print_error "Confirmation failed — restore cancelled"
  exit 1
fi

print_header "Downloading backup"
if ! blob_cli download "$BACKUP_NAME" > "$LOCAL_PATH"; then
  rm -f "$LOCAL_PATH"
  print_error "Failed to download ${BLOB_BACKUP_PREFIX}/${BACKUP_NAME}"
  exit 1
fi
print_success "Downloaded to ${LOCAL_PATH}"

print_header "Restoring database"
compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists < "$LOCAL_PATH"

print_success "Restore complete from ${BACKUP_NAME}"
