#!/bin/bash
# Quick setup script for ngrok development environment
# Usage: ./scripts/start-ngrok-dev.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}"
echo "🚇 Quantum Sport Backend - Ngrok Development Setup"
echo "==============================================="
echo -e "${NC}"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  .env file not found. Creating from template...${NC}"
    cp .env.example .env
    echo -e "${RED}❌ Please edit .env file and add your NGROK_AUTHTOKEN${NC}"
    echo -e "${CYAN}💡 Get your token from: https://dashboard.ngrok.com/get-started/your-authtoken${NC}"
    exit 1
fi

# Check if NGROK_AUTHTOKEN is set
NGROK_TOKEN=$(grep NGROK_AUTHTOKEN .env | cut -d'=' -f2)
if [ -z "$NGROK_TOKEN" ] || [ "$NGROK_TOKEN" = "replace_with_your_ngrok_authtoken" ]; then
    echo -e "${RED}❌ NGROK_AUTHTOKEN not set in .env file${NC}"
    echo -e "${CYAN}💡 Get your token from: https://dashboard.ngrok.com/get-started/your-authtoken${NC}"
    echo -e "${YELLOW}Edit .env file and set: NGROK_AUTHTOKEN=your_token_here${NC}"
    exit 1
fi

echo -e "${GREEN}✅ .env file configured${NC}"

# Make scripts executable
chmod +x scripts/ngrok-entrypoint.sh 2>/dev/null || true
chmod +x scripts/get-ngrok-url.sh 2>/dev/null || true

echo -e "${BLUE}🚀 Starting development environment with ngrok...${NC}"

# Start services
docker-compose -f docker-compose.yml -f docker-compose.ngrok.yml up -d

echo -e "${YELLOW}⏳ Waiting for services to start...${NC}"
sleep 5

# Check service status
echo -e "${BLUE}📊 Service Status:${NC}"
docker-compose ps

echo -e "${BLUE}🔍 Getting ngrok URL...${NC}"
sleep 10

# Try to get the ngrok URL
for i in {1..6}; do
    echo -e "${YELLOW}⏳ Checking ngrok tunnel... (attempt $i/6)${NC}"
    
    if docker-compose logs ngrok-monitor | grep -q "Ngrok Public URL"; then
        echo -e "${GREEN}✅ Ngrok tunnel established!${NC}"
        echo ""
        docker-compose logs ngrok-monitor | tail -10
        break
    fi
    
    if [ $i -eq 6 ]; then
        echo -e "${RED}❌ Failed to get ngrok URL. Check logs:${NC}"
        echo -e "${CYAN}docker-compose logs ngrok${NC}"
    else
        sleep 5
    fi
done

echo ""
echo -e "${BLUE}🎯 Development Environment Ready!${NC}"
echo ""
echo -e "${CYAN}📋 Next Steps:${NC}"
echo -e "1. Copy the webhook URL from above"
echo -e "2. Go to your Xendit dashboard: ${YELLOW}https://dashboard.xendit.co${NC}"
echo -e "3. Add the webhook URL under Settings > Webhooks"
echo -e "4. Set callback token from your .env file"
echo ""
echo -e "${CYAN}🔧 Useful Commands:${NC}"
echo -e "View logs:           ${YELLOW}docker-compose logs -f app${NC}"
echo -e "Get webhook URL:     ${YELLOW}docker exec ngrok-dev sh /usr/local/bin/get-ngrok-url.sh${NC}"
echo -e "Ngrok dashboard:     ${YELLOW}http://localhost:4040${NC}"
echo -e "Stop services:       ${YELLOW}docker-compose down${NC}"
echo ""
echo -e "${GREEN}🎉 Happy webhook testing!${NC}"