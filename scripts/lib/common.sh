#!/bin/bash
# Shared helpers for deployment scripts.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

print_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
  echo -e "${RED}❌ $1${NC}"
}

compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    print_error "docker compose/docker-compose not found"
    exit 1
  fi
}

require_project_root() {
  if [ ! -f "package.json" ] || [ ! -f "Dockerfile" ]; then
    print_error "Run this script from the project root (current: $(pwd))"
    exit 1
  fi
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    print_error "Docker is not installed"
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    print_error "Docker daemon is not running"
    exit 1
  fi
}

ENV_FILE="${ENV_FILE:-.env}"

validate_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    print_error "${ENV_FILE} not found"
    exit 1
  fi

  local missing=()
  for var in DB_PASSWORD JWT_SECRET JWT_REFRESH_SECRET; do
    local val
    val="$(read_env_value "$var" 2>/dev/null || true)"
    if [ -z "$val" ] || [[ "$val" == your_* ]]; then
      missing+=("$var")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    print_error "Missing or invalid variables in ${ENV_FILE}:"
    printf '  - %s\n' "${missing[@]}"
    exit 1
  fi
}

# Backward-compatible alias used by deploy scripts
validate_env_production() {
  validate_env_file
}

# Pull latest code. If this fails on the VPS (usually CRLF/chmod drift on
# tracked files), recover with: git fetch origin main && git reset --hard origin/main
sync_repo_for_deploy() {
  local branch="${DEPLOY_BRANCH:-main}"

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    print_warning "Not a git repository; skipping code sync"
    return 0
  fi

  print_info "Pulling latest code from origin/${branch}..."
  if git pull origin "$branch"; then
    print_success "Code updated"
  else
    print_warning "git pull failed (often CRLF or local edits on tracked files)"
    print_info "Recover with: git fetch origin ${branch} && git reset --hard origin/${branch}"
    print_info "Continuing with current checkout..."
  fi
}

# Read a single KEY=value from the env file without shell expansion ($, !, etc.).
read_env_value() {
  local key="$1"
  local file="${2:-$ENV_FILE}"
  local line val

  line="$(grep -m1 "^${key}=" "$file" 2>/dev/null || true)"
  [ -z "$line" ] && return 1

  val="${line#*=}"
  val="${val%$'\r'}"

  case "$val" in
    \"*\") val="${val#\"}"; val="${val%\"}" ;;
    \'*\') val="${val#\'}"; val="${val%\'}" ;;
  esac

  printf '%s' "$val"
}

urlencode_component() {
  if command -v bun >/dev/null 2>&1; then
    bun -e 'console.log(encodeURIComponent(process.argv[1]))' "$1"
  elif command -v node >/dev/null 2>&1; then
    node -e 'console.log(encodeURIComponent(process.argv[1]))' "$1"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
  else
    print_error "Need bun, node, or python3 to URL-encode database credentials"
    exit 1
  fi
}

# Export variables for docker compose interpolation.
# Compose treats $ in .env values specially; export literals from the shell instead.
export_compose_env() {
  local db_password db_user db_name db_host db_port encoded_pass existing_url

  db_password="$(read_env_value DB_PASSWORD)" || {
    print_error "DB_PASSWORD is missing or empty in ${ENV_FILE}"
    exit 1
  }

  db_user="$(read_env_value DB_USER 2>/dev/null || true)"
  db_user="${db_user:-postgres}"
  db_name="$(read_env_value DB_NAME 2>/dev/null || true)"
  db_name="${db_name:-quantum_sport}"
  db_host="$(read_env_value DB_HOST 2>/dev/null || true)"
  db_host="${db_host:-db}"

  # Host-published port (for pgAdmin/SSH tunnel only). Decoupled from the
  # internal connection: Postgres always listens on 5432 inside the container,
  # and the app reaches it over the compose network as ${db_host}:5432.
  # Bound to 127.0.0.1 in docker-compose.prod.yml so it never conflicts with a
  # native Postgres on 5432 and is never exposed publicly.
  db_host_port="$(read_env_value DB_HOST_PORT 2>/dev/null || true)"
  db_host_port="${db_host_port:-5433}"

  export DB_PASSWORD="$db_password"
  export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$db_password}"
  export DB_USER="$db_user"
  export DB_NAME="$db_name"
  export DB_HOST="$db_host"
  export DB_HOST_PORT="$db_host_port"

  existing_url="$(read_env_value DATABASE_URL 2>/dev/null || true)"
  if [ -n "$existing_url" ]; then
    export DATABASE_URL="$existing_url"
    export DATABASE_URL_WORKER="$existing_url"
  else
    encoded_pass="$(urlencode_component "$db_password")"
    export DATABASE_URL="postgresql://${db_user}:${encoded_pass}@${db_host}:5432/${db_name}?schema=public&connection_limit=10&pool_timeout=20"
    export DATABASE_URL_WORKER="postgresql://${db_user}:${encoded_pass}@${db_host}:5432/${db_name}?schema=public&connection_limit=5&pool_timeout=20"
  fi

  if port="$(read_env_value PORT 2>/dev/null || true)" && [ -n "$port" ]; then
    export PORT="$port"
  fi
}

nginx_config_changed() {
  echo "${1:-}" | grep -qE '^docker/nginx/'
}

reload_nginx_if_needed() {
  local changed_files="${1:-}"
  if ! nginx_config_changed "$changed_files"; then
    return 0
  fi

  print_info "Nginx configuration changed — validating and reloading..."
  compose -f docker-compose.prod.yml exec -T nginx nginx -t
  compose -f docker-compose.prod.yml exec -T nginx nginx -s reload
  print_success "Nginx reloaded"
}

wait_for_app_healthy() {
  local max_attempts="${1:-12}"
  local attempt=1

  while [ "$attempt" -le "$max_attempts" ]; do
    if compose -f docker-compose.prod.yml ps app 2>/dev/null | grep -q "(healthy)"; then
      print_success "Application is healthy (attempt ${attempt}/${max_attempts})"
      return 0
    fi
    print_info "Waiting for app health... (attempt ${attempt}/${max_attempts})"
    sleep 5
    attempt=$((attempt + 1))
  done

  print_error "Application did not become healthy in time"
  compose -f docker-compose.prod.yml logs --tail=50 app || true
  return 1
}
