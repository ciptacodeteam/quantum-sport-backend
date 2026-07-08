#!/bin/bash
# Install daily database backup cron job on the VPS.
#
# Usage:
#   ./scripts/setup-backup-cron.sh
#   ./scripts/setup-backup-cron.sh --remove

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

REMOVE=false
if [ "${1:-}" = "--remove" ]; then
  REMOVE=true
fi

CRON_SCHEDULE="${BACKUP_CRON_SCHEDULE:-30 2 * * *}"
CRON_LOG="${BACKUP_CRON_LOG:-${PROJECT_ROOT}/logs/backup.log}"
CRON_MARKER="# quantum-sport-db-backup"
BACKUP_SCRIPT="${PROJECT_ROOT}/scripts/backup-db.sh"
CRON_LINE="${CRON_SCHEDULE} cd ${PROJECT_ROOT} && ${BACKUP_SCRIPT} >> ${CRON_LOG} 2>&1 ${CRON_MARKER}"

print_header "Quantum Sport — Backup Cron Setup"

require_project_root
make_scripts_executable

if [ "$REMOVE" = true ]; then
  if crontab -l 2>/dev/null | grep -q "$CRON_MARKER"; then
    crontab -l 2>/dev/null | grep -v "$CRON_MARKER" | crontab -
    print_success "Removed backup cron job"
  else
    print_info "No backup cron job found"
  fi
  exit 0
fi

if [ ! -f "${ENV_FILE:-.env}" ]; then
  print_error "${ENV_FILE:-.env} missing — configure BLOB_READ_WRITE_TOKEN first"
  exit 1
fi

load_backup_env
blob_assert_safe_prefix
blob_validate_credentials

mkdir -p "$(dirname "$CRON_LOG")"
touch "$CRON_LOG"

print_header "Installing cron job"
print_info "Schedule: ${CRON_SCHEDULE} (daily at 02:30 server time)"
print_info "Log file: ${CRON_LOG}"
print_info "Destination: Vercel Blob (${BLOB_BACKUP_PREFIX})"

(
  crontab -l 2>/dev/null | grep -v "$CRON_MARKER" || true
  echo "$CRON_LINE"
) | crontab -

print_success "Cron job installed"
echo ""
print_info "Test now: ./scripts/backup-db.sh"
print_info "View logs: tail -f ${CRON_LOG}"
