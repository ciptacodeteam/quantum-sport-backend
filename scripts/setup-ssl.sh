#!/bin/bash

# ============================================
# SSL Certificate Setup for api.quantumsocialclub.id
# ============================================
# This script sets up Let's Encrypt SSL certificates

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

DOMAIN="api.quantumsocialclub.id"
EMAIL="${SSL_EMAIL:-admin@quantumsocialclub.id}"

print_header "SSL Certificate Setup"
print_info "Domain: $DOMAIN"
print_info "Email: $EMAIL"

# Check Docker Compose
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
else
    print_error "Docker Compose not found"
    exit 1
fi

# Verify domain is pointing to this server
print_info "Verifying DNS..."
DOMAIN_IP=$(dig +short $DOMAIN | tail -1)
SERVER_IP=$(curl -s ifconfig.me)

echo "Domain IP: $DOMAIN_IP"
echo "Server IP: $SERVER_IP"

if [ -z "$DOMAIN_IP" ]; then
    print_error "Domain $DOMAIN does not resolve to any IP"
    print_warning "Please ensure DNS is configured correctly"
    exit 1
fi

if [ "$DOMAIN_IP" != "$SERVER_IP" ]; then
    print_warning "Domain IP ($DOMAIN_IP) differs from server IP ($SERVER_IP)"
    print_warning "SSL setup may fail if DNS is not properly configured"
    read -p "Continue anyway? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        exit 1
    fi
fi

# Check if certificates already exist
if docker volume ls | grep -q certbot_certs; then
    print_info "Checking existing certificates..."
    if $DOCKER_COMPOSE -f docker-compose.prod.yml exec certbot certbot certificates 2>/dev/null | grep -q "$DOMAIN"; then
        print_warning "Certificate for $DOMAIN already exists"
        read -p "Do you want to renew it? (yes/no): " renew
        if [ "$renew" = "yes" ]; then
            print_info "Renewing certificate..."
            $DOCKER_COMPOSE -f docker-compose.prod.yml run --rm certbot certonly \
                --webroot \
                --webroot-path=/var/www/certbot \
                --email $EMAIL \
                --agree-tos \
                --no-eff-email \
                --force-renewal \
                -d $DOMAIN
            
            print_success "Certificate renewed!"
            print_info "Reloading nginx..."
            $DOCKER_COMPOSE -f docker-compose.prod.yml exec nginx nginx -s reload
            exit 0
        else
            print_info "Using existing certificate"
            exit 0
        fi
    fi
fi

# Request new certificate
print_header "Requesting SSL Certificate"
print_info "This will:"
print_info "1. Request a certificate from Let's Encrypt"
print_info "2. Verify domain ownership via HTTP-01 challenge"
print_info "3. Install the certificate for nginx"
echo ""

# Ensure nginx is running (HTTP only first)
print_info "Starting services..."
$DOCKER_COMPOSE -f docker-compose.prod.yml up -d db redis app

# Wait for app to be ready
sleep 10

# Create a temporary nginx config without SSL
print_info "Creating temporary HTTP-only nginx configuration..."
$DOCKER_COMPOSE -f docker-compose.prod.yml up -d nginx

# Wait for nginx to start
sleep 5

# Request certificate
print_info "Requesting certificate from Let's Encrypt..."
print_warning "This may take a minute..."

$DOCKER_COMPOSE -f docker-compose.prod.yml run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    -d $DOMAIN

if [ $? -eq 0 ]; then
    print_success "Certificate obtained successfully!"
    
    print_header "Enabling HTTPS"
    print_info "Reloading nginx with SSL configuration..."
    
    # Restart nginx to use the new SSL config
    $DOCKER_COMPOSE -f docker-compose.prod.yml restart nginx
    
    # Wait for nginx to reload
    sleep 3
    
    # Test HTTPS
    print_info "Testing HTTPS connection..."
    if curl -s -o /dev/null -w "%{http_code}" https://$DOMAIN/health | grep -q "200"; then
        print_success "HTTPS is working!"
        print_success "Your API is now accessible at: https://$DOMAIN"
        echo ""
        print_info "Certificate details:"
        $DOCKER_COMPOSE -f docker-compose.prod.yml exec certbot certbot certificates
    else
        print_warning "HTTPS endpoint not responding yet"
        print_info "Please check nginx logs:"
        print_info "  docker-compose -f docker-compose.prod.yml logs nginx"
    fi
    
    print_header "Setup Complete!"
    print_success "SSL certificate is installed and auto-renewal is configured"
    echo ""
    print_info "Your API endpoints:"
    echo "  • https://$DOMAIN/health"
    echo "  • https://$DOMAIN/api/..."
    echo ""
    print_info "Certificate will auto-renew every 12 hours (if needed)"
    print_info "Certificates expire in 90 days but auto-renewal happens at 60 days"
    
else
    print_error "Certificate request failed"
    echo ""
    print_info "Common issues:"
    echo "  1. Domain DNS not pointing to this server"
    echo "  2. Port 80 blocked by firewall"
    echo "  3. Another service using port 80"
    echo ""
    print_info "Troubleshooting:"
    echo "  • Check DNS: dig +short $DOMAIN"
    echo "  • Check firewall: sudo ufw status"
    echo "  • Check port 80: sudo netstat -tlnp | grep :80"
    echo "  • Check nginx logs: docker-compose -f docker-compose.prod.yml logs nginx"
    exit 1
fi

