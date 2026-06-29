#!/bin/bash
# Daily PostgreSQL backup → Vercel Blob
# Only touches: <BLOB_BACKUP_PREFIX>/ (default: quantum-sport/db/)
#
# Usage:
#   ./scripts/backup-db.sh
#   ./scripts/backup-db.sh --dry-run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

DRY_RUN=false

if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
fi

LOG_TAG="[backup-db $(date '+%Y-%m-%d %H:%M:%S')]"
log() { echo "$LOG_TAG $1"; }

fail_backup() {
  print_error "$1"
  exit 1
}

print_header "Quantum Sport — Database Backup"

require_project_root
require_docker
validate_env_file
export_compose_env
load_backup_env
resolve_local_backup_dir
blob_assert_safe_prefix
blob_validate_credentials

timestamp="$(date +%Y%m%d_%H%M%S)"
dump_file="quantum_sport_${timestamp}.dump"
local_path="${LOCAL_BACKUP_DIR}/${dump_file}"
remote_label="${BLOB_BACKUP_PREFIX}/${dump_file}"

log "Database: ${DB_NAME}"
log "Local staging: ${LOCAL_BACKUP_DIR}"
log "Blob destination: ${remote_label}"
log "Retention: ${BACKUP_RETENTION_DAYS} days"

if ! compose -f docker-compose.prod.yml ps db 2>/dev/null | grep -q "Up"; then
  fail_backup "Database container is not running"
fi

if ! compose -f docker-compose.prod.yml ps app 2>/dev/null | grep -q "Up"; then
  fail_backup "App container is not running (required for Vercel Blob upload)"
fi

if [ "$DRY_RUN" = true ]; then
  print_warning "Dry run — no dump or upload will be performed"
  print_info "Would dump ${DB_NAME} → ${local_path}"
  print_info "Would upload to Vercel Blob: ${remote_label}"
  print_info "Would prune backups older than ${BACKUP_RETENTION_DAYS} days"
  exit 0
fi

print_header "Creating database dump"
if ! compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$local_path"; then
  rm -f "$local_path"
  fail_backup "pg_dump failed for database '${DB_NAME}'"
fi

dump_size="$(du -h "$local_path" | awk '{print $1}')"
print_success "Dump created (${dump_size})"

print_header "Uploading to Vercel Blob"
if ! blob_cli upload-stdin "$dump_file" < "$local_path"; then
  fail_backup "Failed to upload backup to Vercel Blob (${remote_label})"
fi

print_header "Pruning old backups"
if ! blob_cli prune "$BACKUP_RETENTION_DAYS"; then
  fail_backup "Failed to prune old backups under ${BLOB_BACKUP_PREFIX}/"
fi

find "$LOCAL_BACKUP_DIR" -name 'quantum_sport_*.dump' -type f -mtime +1 -delete 2>/dev/null || true

print_header "Backup Complete"
print_success "Latest backup: ${remote_label}"
blob_cli list
