#!/bin/bash
# Deploy a pre-built image from GHCR (used by GitHub Actions).
# Requires: APP_IMAGE and .env on the VPS (override with ENV_FILE).
# Optional: SKIP_PULL_CODE=true, CHANGED_FILES, AUTO_DEPLOY=true

set -e

if [ "${DEBUG:-}" = "true" ]; then
  set -x
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

print_header "Quantum Sport Backend - Registry Deployment"

require_project_root
require_docker
validate_env_production
export_compose_env

if [ -z "${APP_IMAGE:-}" ]; then
  print_error "APP_IMAGE is required (e.g. ghcr.io/owner/quantum-sport-backend:sha)"
  exit 1
fi

export ENV_FILE="${ENV_FILE:-.env}"

export APP_IMAGE

if [ "${SKIP_PULL_CODE:-}" != "true" ]; then
  print_info "Pulling latest code..."
  if git pull origin main; then
    print_success "Code updated"
  else
    print_warning "Git pull failed or no changes; continuing"
  fi
fi

print_header "Pulling container images"
print_info "Image: ${APP_IMAGE}"
compose -f docker-compose.prod.yml pull app email-worker scheduler-worker

print_header "Starting services"
compose -f docker-compose.prod.yml up -d --no-build --remove-orphans

reload_nginx_if_needed "${CHANGED_FILES:-}"

if ! wait_for_app_healthy 12; then
  exit 1
fi

print_header "Deployment Complete"
compose -f docker-compose.prod.yml ps
print_success "Registry deployment finished — ${APP_IMAGE}"
