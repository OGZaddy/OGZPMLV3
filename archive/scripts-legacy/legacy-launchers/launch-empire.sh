#!/bin/bash

# =============================================================================
# 🚀 OGZ PRIME V14 - UNIFIED LAUNCHER
# =============================================================================
# Starts all required services for the complete trading system:
#   - Dashboard (port 3000)
#   - WebSocket Server (port 3010)
#   - TRAI Brain (Mistral-7B AI)
#   - Trading Bot (main application)
#
# CHANGE 662: Unified launcher for all processes
# =============================================================================

echo "
╔═══════════════════════════════════════════════════════════════════════════╗
║                     🚀 OGZ PRIME V14 - UNIFIED LAUNCHER                     ║
║                          Houston Fund: \$25,000 Target                       ║
╚═══════════════════════════════════════════════════════════════════════════╝
"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 is not installed. Install with: npm install -g pm2${NC}"
    exit 1
fi

# Function to check if a service is running
check_service() {
    local service_name=$1
    if pm2 list | grep -q "$service_name.*online"; then
        echo -e "${GREEN}✅ $service_name is already running${NC}"
        return 0
    else
        return 1
    fi
}

# Function to start a service
start_service() {
    local service_name=$1
    local start_cmd=$2

    echo -e "${YELLOW}🔄 Starting $service_name...${NC}"

    if check_service "$service_name"; then
        echo -e "${BLUE}ℹ️  $service_name already running, restarting...${NC}"
        pm2 restart "$service_name" --update-env
    else
        eval "pm2 start $start_cmd"
    fi
}

# Kill any existing bot processes (not managed by PM2)
echo -e "${YELLOW}🧹 Cleaning up existing bot processes...${NC}"
pkill -f "node run-trading-bot" 2>/dev/null || true
rm -f .ogz-prime-v14.lock 2>/dev/null || true

# Start Dashboard
start_service "ogz-dashboard" "npm --prefix . run start:dashboard --name ogz-dashboard"

# Start WebSocket Server
start_service "ogz-websocket" "./ogzprime-ssl-server.js --name ogz-websocket"

# Start TRAI Server
start_service "trai-server" "python3 ./trai_brain/inference_server_ct.py --name trai-server"

# Wait for services to initialize
echo -e "${YELLOW}⏳ Waiting for services to initialize...${NC}"
sleep 5

# Check all services are running
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                    SERVICE STATUS CHECK                         ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

ALL_GOOD=true

# Check Dashboard
if check_service "ogz-dashboard"; then
    echo -e "${GREEN}✅ Dashboard: http://localhost:3000${NC}"
else
    echo -e "${RED}❌ Dashboard failed to start${NC}"
    ALL_GOOD=false
fi

# Check WebSocket
if check_service "ogz-websocket"; then
    echo -e "${GREEN}✅ WebSocket: ws://localhost:3010/ws${NC}"
    # Verify port is actually listening
    if ss -tlnp 2>/dev/null | grep -q ":3010"; then
        echo -e "${GREEN}   └─ Port 3010 confirmed listening${NC}"
    else
        echo -e "${YELLOW}   └─ Port 3010 may still be binding...${NC}"
    fi
else
    echo -e "${RED}❌ WebSocket failed to start${NC}"
    ALL_GOOD=false
fi

# Check TRAI
if check_service "trai-server"; then
    echo -e "${GREEN}✅ TRAI Brain: Mistral-7B loaded${NC}"
else
    echo -e "${RED}❌ TRAI server failed to start${NC}"
    ALL_GOOD=false
fi

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# Start the main trading bot if all services are running
if [ "$ALL_GOOD" = true ]; then
    echo ""
    echo -e "${GREEN}🎯 All services running! Starting trading bot...${NC}"
    echo ""

    # Set environment variables and start bot
    export WS_HOST=127.0.0.1
    export BACKTEST_MODE=false
    export MIN_TRADE_CONFIDENCE=${MIN_TRADE_CONFIDENCE:-0.03}

    echo -e "${BLUE}Configuration:${NC}"
    echo -e "  • WebSocket: ${WS_HOST}:3010"
    echo -e "  • Mode: LIVE/PAPER"
    echo -e "  • Min Confidence: ${MIN_TRADE_CONFIDENCE}"
    echo ""

    # Launch the bot (not with PM2 as it needs to show output)
    echo -e "${GREEN}🚀 Launching OGZ Prime V14 Trading Bot...${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
    echo ""

    # Trap to cleanup on exit
    trap 'echo -e "\n${YELLOW}Shutting down...${NC}"; pm2 stop all; exit' INT TERM

    # Run the bot
    node run-empire-v2.js

else
    echo ""
    echo -e "${RED}⚠️  Some services failed to start. Check logs:${NC}"
    echo -e "${YELLOW}   pm2 logs ogz-dashboard${NC}"
    echo -e "${YELLOW}   pm2 logs ogz-websocket${NC}"
    echo -e "${YELLOW}   pm2 logs trai-server${NC}"
    exit 1
fi