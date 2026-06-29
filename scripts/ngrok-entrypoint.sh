#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚇 Starting ngrok tunnel...${NC}"

# Check if NGROK_AUTHTOKEN is set
if [ -z "$NGROK_AUTHTOKEN" ]; then
    echo -e "${RED}❌ NGROK_AUTHTOKEN environment variable is not set${NC}"
    echo -e "${YELLOW}Please set your ngrok auth token in .env file${NC}"
    exit 1
fi

# Create ngrok config directory with proper permissions (use /tmp which is writable)
echo -e "${BLUE}🔑 Setting up ngrok configuration...${NC}"
mkdir -p /tmp/ngrok
chmod 755 /tmp/ngrok

# Wait for the main app to be ready
echo -e "${BLUE}⏳ Waiting for app to be ready on port 8000...${NC}"
while ! nc -z app 8000; do
    echo -e "${YELLOW}Waiting for app container...${NC}"
    sleep 2
done

echo -e "${GREEN}✅ App is ready, starting ngrok tunnel...${NC}"

# Create ngrok configuration file
cat > /tmp/ngrok/ngrok.yml << EOF
version: "2"
authtoken: ${NGROK_AUTHTOKEN}
web_addr: 0.0.0.0:4040
tunnels:
  webhook:
    proto: http
    addr: app:8000
EOF

chmod 644 /tmp/ngrok/ngrok.yml

# Check if custom domain is provided
if [ -n "$NGROK_DOMAIN" ] && [ "$NGROK_DOMAIN" != "replace" ]; then
    echo -e "${BLUE}🌐 Using custom domain: $NGROK_DOMAIN${NC}"
    cat >> /tmp/ngrok/ngrok.yml << EOF
    hostname: ${NGROK_DOMAIN}
EOF
else
    echo -e "${YELLOW}⚠️ No custom domain set, using random ngrok URL${NC}"
fi

# Start ngrok and capture the URL
echo -e "${BLUE}🚀 Starting ngrok tunnel...${NC}"

# Start ngrok in the background
ngrok start webhook --config /tmp/ngrok/ngrok.yml &
NGROK_PID=$!

# Wait a moment for ngrok to initialize
sleep 5

# Get the public URL
echo -e "${BLUE}🔍 Getting public URL...${NC}"
PUBLIC_URL=""
for i in {1..30}; do
    PUBLIC_URL=$(wget -qO- http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*' | head -1 | cut -d'"' -f4)
    if [ -n "$PUBLIC_URL" ]; then
        break
    fi
    echo -e "${YELLOW}Waiting for ngrok API... (attempt $i/30)${NC}"
    sleep 2
done

if [ -n "$PUBLIC_URL" ]; then
    echo -e "${GREEN}✅ Ngrok tunnel established!${NC}"
    echo -e "${GREEN}🌐 Public URL: $PUBLIC_URL${NC}"
    echo -e "${GREEN}📊 Ngrok Dashboard: http://localhost:4040${NC}"
    echo -e "${GREEN}🎯 Webhook URL: $PUBLIC_URL/webhooks/xendit${NC}"
    echo ""
    echo -e "${BLUE}📋 Copy this webhook URL to your Xendit dashboard:${NC}"
    echo -e "${YELLOW}$PUBLIC_URL/webhooks/xendit${NC}"
    echo ""
    
    # Save the URL to a file that can be read by other containers
    echo "$PUBLIC_URL" > /tmp/ngrok-url.txt
else
    echo -e "${RED}❌ Failed to get ngrok public URL${NC}"
    exit 1
fi

# Keep the process running and handle signals
cleanup() {
    echo -e "${YELLOW}🛑 Shutting down ngrok...${NC}"
    kill $NGROK_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGTERM SIGINT

# Wait for ngrok process
wait $NGROK_PID