#!/bin/bash
# Deploy a pre-built image from GHCR (used by GitHub Actions).
# On health-check failure, automatically rolls back to the previous image.
#
# Requires: APP_IMAGE and .env on the VPS (override with ENV_FILE).
# Optional: SKIP_PULL_CODE=true, CHANGED_FILES, AUTO_DEPLOY=true

set -e

if [ "${DEBUG:-}" = "true" ]; then
  set -x
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
export ENV_FILE="${ENV_FILE:-.env}"

print_header "Quantum Sport Backend - Registry Deployment"

require_project_root
require_docker
validate_env_production
export_compose_env

if [ -z "${APP_IMAGE:-}" ]; then
  print_error "APP_IMAGE is required (e.g. ghcr.io/owner/quantum-sport-backend:sha)"
  exit 1
fi

TARGET_APP_IMAGE="$APP_IMAGE"

PREVIOUS_APP_IMAGE="$(read_running_app_image)"
if [ -z "$PREVIOUS_APP_IMAGE" ]; then
  PREVIOUS_APP_IMAGE="$(read_persisted_app_image)"
fi
if [ -z "$PREVIOUS_APP_IMAGE" ]; then
  PREVIOUS_APP_IMAGE="$(read_last_good_app_image)"
fi

if [ -n "$PREVIOUS_APP_IMAGE" ]; then
  print_info "Rollback image (if needed): $PREVIOUS_APP_IMAGE"
fi
print_info "Deploy target: $TARGET_APP_IMAGE"

# Do not persist the new tag until health checks pass.
export APP_IMAGE="$TARGET_APP_IMAGE"

if [ "${AUTO_DEPLOY:-}" != "true" ]; then
  read -r -p "Pull and deploy this image? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
  fi
fi

if [ "${SKIP_PULL_CODE:-}" != "true" ]; then
  sync_repo_for_deploy
fi

print_header "Pulling application image"
compose -f docker-compose.prod.yml pull app

print_header "Restarting application"
compose -f docker-compose.prod.yml up -d --no-deps app

print_info "Waiting for container health + HTTP /health ..."
DEPLOY_OK=false
if wait_for_app_healthy 30 && probe_app_http_health "$(resolve_app_port)" 12; then
  DEPLOY_OK=true
fi

if [ "$DEPLOY_OK" != true ]; then
  print_error "New deployment failed health checks"
  compose -f docker-compose.prod.yml logs --tail=30 app || true

  if [ -n "$PREVIOUS_APP_IMAGE" ] && [ "$PREVIOUS_APP_IMAGE" != "$TARGET_APP_IMAGE" ]; then
    if rollback_app_deployment "$PREVIOUS_APP_IMAGE"; then
      print_warning "Deploy rejected — rolled back to $PREVIOUS_APP_IMAGE"
      exit 1
    fi
  else
    print_warning "No previous image available for automatic rollback"
  fi

  exit 1
fi

print_success "New version healthy"
persist_app_image "$TARGET_APP_IMAGE"
save_last_good_app_image "$TARGET_APP_IMAGE"

print_header "Restarting workers"
compose -f docker-compose.prod.yml pull email-worker scheduler-worker 2>/dev/null || true
compose -f docker-compose.prod.yml up -d --no-deps email-worker scheduler-worker

reload_nginx_if_needed "${CHANGED_FILES:-}"

print_header "Deployment Complete"
compose -f docker-compose.prod.yml ps
print_success "Registry deployment finished — ${TARGET_APP_IMAGE}"
