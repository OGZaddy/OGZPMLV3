#!/bin/bash

# =============================================================================
# 🚀 OGZ PRIME V14 FINAL MERGED - COMPLETE LAUNCHER
# =============================================================================
# Starts all required services for the trading system:
#   - Dashboard (port 3000) 
#   - WebSocket Server (port 3010)
#   - Trading Bot (main application with embedded TRAI)
#
# CHANGE 2025-12-11: Unified launcher for production deployment
# =============================================================================

echo "
╔═══════════════════════════════════════════════════════════════════════════╗
║              🚀 OGZ PRIME V14 - FINAL MERGED - UNIFIED LAUNCHER             ║
║                          Houston Fund: \$25,000 Target                       ║
╚═══════════════════════════════════════════════════════════════════════════╝
"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root
PROJECT_ROOT="/opt/ogzprime/OGZPMLV2"
cd "$PROJECT_ROOT" || exit 1

# Function to check if a service is running
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Function to start dashboard
start_dashboard() {
    echo -e "${YELLOW}🔄 Starting Dashboard on port 3000...${NC}"
    
    if check_port 3000; then
        echo -e "${YELLOW}⚠️  Port 3000 already in use, skipping dashboard${NC}"
        return 1
    fi
    
    # Check if dashboard file exists
    if [ ! -f "$PROJECT_ROOT/public/unified-dashboard.html" ]; then
        echo -e "${RED}❌ Dashboard file not found at public/unified-dashboard.html${NC}"
        return 1
    fi

    # Start simple HTTP server for dashboard
    (cd "$PROJECT_ROOT/public" && python3 -m http.server 3000 >/dev/null 2>&1 &)

    sleep 2

    if check_port 3000; then
        echo -e "${GREEN}✅ Dashboard: http://localhost:3000/unified-dashboard.html${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to start dashboard${NC}"
        return 1
    fi
}

# Function to start websocket server
start_websocket() {
    echo -e "${YELLOW}🔄 Starting WebSocket server on port 3010...${NC}"
    
    if check_port 3010; then
        echo -e "${YELLOW}⚠️  Port 3010 already in use, skipping WebSocket server${NC}"
        return 1
    fi
    
    # Check if websocket server exists
    if [ ! -f "$PROJECT_ROOT/core/WebSocketServer.js" ] && [ ! -f "$PROJECT_ROOT/websocket-server.js" ]; then
        echo -e "${YELLOW}⚠️  WebSocket server file not found, bot will auto-create it${NC}"
        return 0
    fi
    
    # Start websocket in background
    (cd "$PROJECT_ROOT" && node core/WebSocketServer.js >/dev/null 2>&1 &)
    
    sleep 2
    
    if check_port 3010; then
        echo -e "${GREEN}✅ WebSocket: ws://localhost:3010/ws${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠️  WebSocket port not listening yet (bot may create it)${NC}"
        return 0
    fi
}

# Clean up any stale lock files
echo -e "${YELLOW}🧹 Cleaning up stale lock files...${NC}"
rm -f "$PROJECT_ROOT/.ogz-prime-v14.lock" 2>/dev/null || true

# Attempt to start dashboard
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                    INITIALIZING SERVICES                        ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

start_dashboard || echo -e "${YELLOW}ℹ️  Dashboard startup deferred - bot may serve it${NC}"
start_websocket || echo -e "${YELLOW}ℹ️  WebSocket startup deferred - bot will create it${NC}"

# Startup summary
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                    SERVICE STARTUP SUMMARY                     ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}📊 Dashboard:      http://localhost:3000${NC}"
echo -e "${GREEN}🌐 WebSocket:      ws://localhost:3010${NC}"
echo -e "${GREEN}🧠 TRAI LLM:       Loads in trading bot process${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# Start the main trading bot
echo ""
echo -e "${GREEN}🎯 Starting OGZ Prime V14 Final Merged Trading Bot...${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
echo ""

# Set environment
export BACKTEST_MODE=false
export BOT_TIER=ml
export TRADING_PROFILE=balanced
export ENABLE_LIVE_TRADING=false

# Trap to cleanup on exit
trap 'echo -e "\n${YELLOW}Shutting down bot...${NC}"; exit' INT TERM

# Run the bot (shows output directly)
node run-empire-v2.js
