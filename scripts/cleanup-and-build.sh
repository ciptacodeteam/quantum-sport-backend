#!/bin/bash

# ============================================
# Docker Cleanup and Memory-Optimized Build
# ============================================
# Use this script if you're experiencing OOM (Out of Memory) issues

set -e

# Colors
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

print_header "Docker Cleanup and Memory Optimization"

# Check memory
print_info "Checking system memory..."
free -h
AVAILABLE_MEM=$(free -m | awk 'NR==2{print $7}')
echo ""
print_info "Available memory: ${AVAILABLE_MEM}MB"

if [ "$AVAILABLE_MEM" -lt 1000 ]; then
    print_warning "Low memory detected (<1GB available)"
    print_warning "Build may fail due to insufficient memory"
    echo ""
    print_info "Recommendations:"
    echo "  1. Add swap space (see below)"
    echo "  2. Stop other services"
    echo "  3. Close unnecessary applications"
    echo ""
fi

# Stop containers
print_header "Stopping All Containers"
print_info "This will stop all running Docker containers to free memory..."
if docker stop $(docker ps -aq) 2>/dev/null; then
    print_success "Containers stopped"
else
    print_info "No containers to stop"
fi

# Cleanup
print_header "Cleaning Up Docker Resources"
print_info "Removing unused images, containers, and cache..."

# Show current usage
echo ""
print_info "Docker disk usage BEFORE cleanup:"
docker system df

echo ""
print_info "Running cleanup..."
docker system prune -a -f --volumes

echo ""
print_success "Cleanup completed"
print_info "Docker disk usage AFTER cleanup:"
docker system df

# Check if we need swap
print_header "Checking Swap Space"
SWAP_SIZE=$(free -m | awk 'NR==3{print $2}')
print_info "Current swap: ${SWAP_SIZE}MB"

if [ "$SWAP_SIZE" -lt 2000 ]; then
    print_warning "Limited or no swap space detected"
    echo ""
    print_info "To add 4GB swap space, run these commands:"
    echo ""
    echo "  sudo fallocate -l 4G /swapfile"
    echo "  sudo chmod 600 /swapfile"
    echo "  sudo mkswap /swapfile"
    echo "  sudo swapon /swapfile"
    echo "  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
    echo ""
    
    if [ "$AVAILABLE_MEM" -lt 2000 ]; then
        print_warning "Your system has limited RAM and swap"
        read -p "Do you want me to show swap creation commands again? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo ""
            echo "Run these commands to add swap:"
            echo "----------------------------------------"
            echo "sudo fallocate -l 4G /swapfile"
            echo "sudo chmod 600 /swapfile"
            echo "sudo mkswap /swapfile"
            echo "sudo swapon /swapfile"
            echo "echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
            echo "----------------------------------------"
            echo ""
            print_info "After adding swap, run this script again"
            exit 0
        fi
    fi
fi

# Memory-aware build
print_header "Building with Memory Optimization"

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# Check for docker compose command
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
else
    print_error "Docker Compose not found"
    exit 1
fi

print_info "Building with memory limits and optimization..."
print_info "This may take 10-15 minutes on low-memory systems..."
echo ""

# Build with memory limits
if $DOCKER_COMPOSE -f docker-compose.prod.yml build \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    --memory 2g \
    --memory-swap 4g; then
    print_success "Build completed successfully!"
else
    print_error "Build failed"
    echo ""
    print_info "Troubleshooting steps:"
    echo "  1. Check memory: free -h"
    echo "  2. Check swap: swapon --show"
    echo "  3. Add more swap if needed"
    echo "  4. Try building without cache: CLEAN_BUILD=true ./scripts/deploy.sh"
    echo "  5. Check logs: docker-compose -f docker-compose.prod.yml logs"
    exit 1
fi

print_header "Build Complete"
print_success "Docker images built successfully"
echo ""
print_info "Next steps:"
echo "  1. Deploy: ./scripts/deploy.sh"
echo "  2. Check status: docker-compose -f docker-compose.prod.yml ps"
echo "  3. View logs: docker-compose -f docker-compose.prod.yml logs -f"
echo ""

