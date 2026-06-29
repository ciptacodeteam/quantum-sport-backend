#!/bin/bash

# ============================================
# Production Deployment Script
# ============================================

# Exit on error, but allow debugging
set -e

# Enable error tracing for debugging
if [ "${DEBUG:-}" = "true" ]; then
    set -x
fi

# Enable Docker BuildKit for faster builds and cache mounts
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# Prefer Docker Compose v2 (`docker compose`) with fallback to legacy `docker-compose`
compose() {
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        docker compose "$@"
    elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose "$@"
    else
        echo "Error: docker compose/docker-compose not found. Install Docker Engine and the compose plugin:"
        echo "  sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin"
        exit 1
    fi
}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print functions
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

print_header "Quantum Sport Backend - Production Deployment"

# Verify we're in the right directory
if [ ! -f "package.json" ] || [ ! -f "Dockerfile" ]; then
    print_error "Error: Must run scripts/deploy.sh from the project root directory"
    print_info "Current directory: $(pwd)"
    exit 1
fi

# Check if Docker is available
if ! command -v docker >/dev/null 2>&1; then
    print_error "Docker is not installed or not in PATH"
    print_info "Install Docker: sudo apt-get update && sudo apt-get install -y docker.io"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info >/dev/null 2>&1; then
    print_error "Docker daemon is not running"
    print_info "Start Docker: sudo systemctl start docker"
    exit 1
fi

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
    print_warning "Running as root is not recommended"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

ENV_FILE="${ENV_FILE:-.env}"

# Check if env file exists
if [ ! -f "$ENV_FILE" ]; then
    print_error "${ENV_FILE} file not found!"
    echo ""
    print_info "Creating from template..."
    
    if [ -f "docker/env.production.template" ]; then
        cp docker/env.production.template "$ENV_FILE"
        print_warning "Please edit ${ENV_FILE} and set your configuration"
        print_info "Required variables: DB_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET"
        echo ""
        read -p "Press Enter after editing ${ENV_FILE} to continue..."
    else
        print_error "Template file not found: docker/env.production.template"
        exit 1
    fi
fi

# Validate required environment variables
print_info "Validating environment configuration..."
REQUIRED_VARS=("DB_PASSWORD" "JWT_SECRET" "JWT_REFRESH_SECRET")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if ! grep -q "^${var}=" "$ENV_FILE" || grep -q "^${var}=your_" "$ENV_FILE" || grep -q "^${var}=$" "$ENV_FILE"; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    print_error "Missing or invalid required variables in ${ENV_FILE}:"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    echo ""
    print_info "Please edit ${ENV_FILE} and set these variables"
    print_info "See docker/env.production.template for reference"
    exit 1
fi

print_success "Environment configuration validated"

# Load DB credentials safely for docker compose ($ in passwords breaks compose .env parsing)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
export_compose_env

# Confirm deployment (skip if AUTO_DEPLOY is set)
if [ "${AUTO_DEPLOY:-}" != "true" ]; then
    echo ""
    print_warning "This will deploy to PRODUCTION environment"
    read -p "Are you sure you want to continue? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "Deployment cancelled."
        exit 0
    fi
else
    print_info "AUTO_DEPLOY=true, skipping confirmation prompt"
fi

BASE_URL="$(read_env_value BASE_URL 2>/dev/null || true)"

print_header "Pulling Latest Code"
print_info "Fetching latest changes from repository..."
if git pull origin main; then
    print_success "Code updated successfully"
else
    print_warning "Git pull failed or no changes. Continuing anyway..."
fi

print_header "Building Docker Images"
# Use --no-cache only if explicitly requested via CLEAN_BUILD env var
if [ "${CLEAN_BUILD}" = "true" ]; then
    print_warning "Performing clean build (no cache)..."
    print_info "This may take several minutes..."
    print_info "Build command: compose -f docker-compose.prod.yml build --no-cache"
    if compose -f docker-compose.prod.yml build --no-cache; then
        print_success "Clean build completed"
    else
        print_error "Build failed!"
        print_info "Check build logs above for details"
        print_info "Common issues:"
        print_info "  - Missing bun.lock file"
        print_info "  - Insufficient disk space"
        print_info "  - Network issues downloading dependencies"
        exit 1
    fi
else
    print_info "Building with cache for faster builds..."
    print_info "Tip: Set CLEAN_BUILD=true for a clean build if needed"
    print_info "Build command: compose -f docker-compose.prod.yml build"
    if compose -f docker-compose.prod.yml build; then
        print_success "Build completed"
    else
        print_error "Build failed!"
        print_info "Check build logs above for details"
        print_info "Try running with CLEAN_BUILD=true if cache is corrupted"
        exit 1
    fi
fi

print_header "Starting Services"
print_info "Starting database, Redis, application, and workers..."
print_info "Note: Migrations will run automatically on startup"

if compose -f docker-compose.prod.yml up -d; then
    print_success "All services started"
else
    print_error "Failed to start services"
    print_info "Check logs with: docker compose -f docker-compose.prod.yml logs"
    exit 1
fi

# Wait for services to be healthy
print_info "Waiting for services to become healthy (this may take up to 60 seconds)..."
sleep 15

# Check container status
print_header "Deployment Status"
compose -f docker-compose.prod.yml ps

# Check if app is healthy
print_info "Checking application health..."
APP_HEALTHY=false
for i in {1..10}; do
    if compose -f docker-compose.prod.yml ps | grep "quantum-sport-app-prod" | grep -q "(healthy)"; then
        APP_HEALTHY=true
        break
    fi
    echo "  Waiting for app to be healthy... (attempt $i/10)"
    sleep 3
done

if [ "$APP_HEALTHY" = true ]; then
    print_success "Application is healthy"
else
    print_warning "Application is not yet healthy, but may still be starting up"
    print_info "Check logs with: docker compose -f docker-compose.prod.yml logs -f app"
fi

# Check database migrations
print_info "Checking database migration status..."
if compose -f docker-compose.prod.yml exec -T app bunx prisma migrate status 2>/dev/null; then
    print_success "Database migrations are up to date"
else
    print_warning "Could not verify migration status (app may still be starting)"
fi

# Show recent logs
echo ""
print_info "Recent application logs:"
compose -f docker-compose.prod.yml logs --tail=30 app

print_header "Deployment Complete!"
print_success "All services are running"

if [ -n "$BASE_URL" ]; then
    echo ""
    print_info "🌐 Application URL: ${BASE_URL}"
fi

echo ""
print_info "Useful commands:"
echo ""
echo "  📋 View logs:"
echo "     docker compose -f docker-compose.prod.yml logs -f app"
echo ""
echo "  🔄 Restart service:"
echo "     docker compose -f docker-compose.prod.yml restart app"
echo ""
echo "  🛑 Stop services:"
echo "     docker compose -f docker-compose.prod.yml down"
echo ""
echo "  💻 Access app shell:"
echo "     docker compose -f docker-compose.prod.yml exec app sh"
echo ""
echo "  🗄️  Database shell:"
echo "     docker compose -f docker-compose.prod.yml exec db psql -U postgres quantum_sport"
echo ""
echo "  🔍 Check health:"
echo "     curl http://localhost:3000/health"
echo ""

print_success "Deployment completed successfully! 🚀"
