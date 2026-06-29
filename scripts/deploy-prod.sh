#!/bin/bash
# ============================================
# Production Deployment Script
# ============================================
# This script helps deploy the application to production safely

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
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

print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
    print_warning "Running as root is not recommended"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

print_header "Quantum Sport Backend - Production Deployment"

# Step 1: Check prerequisites
print_info "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check for docker-compose command (V1 or V2)
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

print_success "Docker and Docker Compose are installed"

# Step 2: Check environment file
print_info "Checking environment configuration..."

ENV_FILE="${ENV_FILE:-.env}"

if [ ! -f "$ENV_FILE" ]; then
    print_warning "${ENV_FILE} file not found"
    print_info "Creating from template..."
    
    if [ -f "docker/env.production.template" ]; then
        cp docker/env.production.template "$ENV_FILE"
        print_warning "Please edit ${ENV_FILE} and set your configuration"
        print_info "Required variables: DB_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET"
        read -p "Press Enter after editing ${ENV_FILE} to continue..."
    else
        print_error "Template file not found: docker/env.production.template"
        exit 1
    fi
fi

# Check for required environment variables
REQUIRED_VARS=("DB_PASSWORD" "JWT_SECRET" "JWT_REFRESH_SECRET")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if ! grep -q "^${var}=" "$ENV_FILE" || grep -q "^${var}=your_" "$ENV_FILE"; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    print_error "Missing or invalid required variables in ${ENV_FILE}:"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    print_info "Please edit ${ENV_FILE} and set these variables"
    exit 1
fi

print_success "Environment configuration looks good"

# Step 3: Build or pull images
print_header "Building Docker Images"
print_info "This may take several minutes on first build..."

export DOCKER_BUILDKIT=1

if $DOCKER_COMPOSE -f docker-compose.prod.yml build; then
    print_success "Docker images built successfully"
else
    print_error "Failed to build Docker images"
    exit 1
fi

# Step 4: Check if services are already running
if $DOCKER_COMPOSE -f docker-compose.prod.yml ps | grep -q "Up"; then
    print_warning "Services are already running"
    read -p "Do you want to restart them? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Stopping existing services..."
        $DOCKER_COMPOSE -f docker-compose.prod.yml down
    else
        print_info "Updating running services..."
        $DOCKER_COMPOSE -f docker-compose.prod.yml up -d
        print_success "Services updated"
        exit 0
    fi
fi

# Step 5: Start services
print_header "Starting Services"
print_info "Starting database, redis, application, and workers..."

if $DOCKER_COMPOSE -f docker-compose.prod.yml up -d; then
    print_success "All services started"
else
    print_error "Failed to start services"
    print_info "Check logs with: $DOCKER_COMPOSE -f docker-compose.prod.yml logs"
    exit 1
fi

# Step 6: Wait for services to be healthy
print_info "Waiting for services to be healthy..."
sleep 10

# Check service health
print_info "Checking service status..."
$DOCKER_COMPOSE -f docker-compose.prod.yml ps

# Step 7: Verify database migrations
print_info "Verifying database migrations..."
if $DOCKER_COMPOSE -f docker-compose.prod.yml exec -T app bunx prisma migrate status; then
    print_success "Database migrations are up to date"
else
    print_warning "There might be pending migrations"
fi

# Step 8: Final checks
print_header "Deployment Complete!"
print_success "Application is running"
echo ""
print_info "Service Status:"
$DOCKER_COMPOSE -f docker-compose.prod.yml ps

echo ""
print_info "Useful commands:"
echo "  View logs:        $DOCKER_COMPOSE -f docker-compose.prod.yml logs -f"
echo "  Check status:     $DOCKER_COMPOSE -f docker-compose.prod.yml ps"
echo "  Restart:          $DOCKER_COMPOSE -f docker-compose.prod.yml restart"
echo "  Stop:             $DOCKER_COMPOSE -f docker-compose.prod.yml down"
echo "  Database shell:   $DOCKER_COMPOSE -f docker-compose.prod.yml exec db psql -U postgres quantum_sport"
echo "  App shell:        $DOCKER_COMPOSE -f docker-compose.prod.yml exec app sh"

echo ""
print_info "Health check:"
echo "  URL: http://localhost:3000/health"

echo ""
print_warning "Important: Make sure to configure SSL/TLS certificates for production use"
print_warning "Important: Set up regular database backups"

echo ""
print_success "Deployment completed successfully! 🚀"

