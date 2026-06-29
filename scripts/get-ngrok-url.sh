#!/bin/bash
# Ngrok URL monitor script
# This script monitors the ngrok tunnel and provides URL information

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Function to get ngrok URL
get_ngrok_url() {
    local url=""
    for i in {1..10}; do
        url=$(wget -qO- http://ngrok:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*' | head -1 | cut -d'"' -f4)
        if [ -n "$url" ]; then
            echo "$url"
            return 0
        fi
        sleep 2
    done
    return 1
}

# Function to check if ngrok is ready
check_ngrok_ready() {
    wget -qO- http://ngrok:4040/api/tunnels >/dev/null 2>&1
}

# Wait for ngrok to be ready
echo -e "${BLUE}🔍 Waiting for ngrok to be ready...${NC}"
for i in {1..30}; do
    if check_ngrok_ready; then
        echo -e "${GREEN}✅ Ngrok is ready!${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ Timeout waiting for ngrok${NC}"
        exit 1
    fi
    echo -e "${YELLOW}Waiting for ngrok... (attempt $i/30)${NC}"
    sleep 2
done

# Get and display the URL
PUBLIC_URL=$(get_ngrok_url)
if [ -n "$PUBLIC_URL" ]; then
    echo -e "${GREEN}🌐 Ngrok Public URL: $PUBLIC_URL${NC}"
    echo -e "${GREEN}📊 Ngrok Dashboard: http://localhost:4040${NC}"
    echo -e "${GREEN}🎯 Xendit Webhook URL: $PUBLIC_URL/webhooks/xendit${NC}"
    echo ""
    echo -e "${BLUE}📋 Configuration for Xendit:${NC}"
    echo -e "${YELLOW}Webhook URL: $PUBLIC_URL/webhooks/xendit${NC}"
    echo -e "${YELLOW}Callback Token: Check your .env file${NC}"
    echo ""
    
    # Save URL for other scripts
    echo "$PUBLIC_URL" > /tmp/ngrok-url.txt
    
    # Update environment variable if possible
    if [ -w /app/.env ]; then
        sed -i "s|WEBHOOK_BASE_URL=.*|WEBHOOK_BASE_URL=$PUBLIC_URL/webhooks|g" /app/.env 2>/dev/null || true
    fi
    
    exit 0
else
    echo -e "${RED}❌ Failed to get ngrok URL${NC}"
    exit 1
fi