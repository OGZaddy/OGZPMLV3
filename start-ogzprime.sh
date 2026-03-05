#!/bin/bash
# OGZ PRIME - Unified Startup Script
# Usage: ./start-ogzprime.sh [start|stop|restart|status]

PROJECT_ROOT="/opt/ogzprime/OGZPMLV2"
cd "$PROJECT_ROOT" || exit 1

# Load environment (strip comments including inline comments)
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source <(grep -v '^#' "$PROJECT_ROOT/.env" | sed 's/\s*#.*$//' | grep '=')
    set +a
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

setup() {
    echo -e "${YELLOW}[Setup] Creating TRAI inference server symlinks...${NC}"
    ln -sf "$PROJECT_ROOT/trai_brain/inference_server.py" "$PROJECT_ROOT/core/inference_server.py" 2>/dev/null
    ln -sf "$PROJECT_ROOT/trai_brain/inference_server_ct.py" "$PROJECT_ROOT/core/inference_server_ct.py" 2>/dev/null
    ln -sf "$PROJECT_ROOT/trai_brain/inference_server_gguf.py" "$PROJECT_ROOT/core/inference_server_gguf.py" 2>/dev/null

    echo -e "${YELLOW}[Setup] Fixing web file permissions...${NC}"
    chmod 644 "$PROJECT_ROOT/public/trai-widget.js" 2>/dev/null

    echo -e "${YELLOW}[Setup] Clearing stale locks...${NC}"
    rm -f "$PROJECT_ROOT/.ogz-prime-v14.lock" 2>/dev/null

    # Check Python dependencies for TRAI
    echo -e "${YELLOW}[Setup] Checking TRAI Python dependencies...${NC}"
    if ! python3 -c "import sentence_transformers" 2>/dev/null; then
        echo -e "${YELLOW}[Setup] Installing sentence-transformers...${NC}"
        pip3 install sentence-transformers --quiet
    else
        echo -e "${GREEN}[Setup] TRAI dependencies OK${NC}"
    fi

    # Verify model
    if [ -f "/opt/ogzprime/trai/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf" ]; then
        echo -e "${GREEN}[Setup] TRAI LLM model found${NC}"
    else
        echo -e "${YELLOW}[Setup] TRAI LLM model not found - using rule-based${NC}"
    fi
}

# Wait for a port to be ready (max 30s)
wait_for_port() {
    local port=$1
    local max_wait=30
    local waited=0
    echo -e "${YELLOW}[Wait] Waiting for port $port to be ready...${NC}"
    while ! curl -s -o /dev/null -w "" "http://localhost:$port/" 2>/dev/null; do
        sleep 1
        waited=$((waited + 1))
        if [ $waited -ge $max_wait ]; then
            echo -e "${RED}[Wait] Timeout waiting for port $port${NC}"
            return 1
        fi
    done
    echo -e "${GREEN}[Wait] Port $port ready (${waited}s)${NC}"
    return 0
}

start() {
    echo -e "\n${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}                 🚀 STARTING OGZ PRIME                          ${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}\n"

    setup

    echo -e "\n${YELLOW}[Start] WebSocket server...${NC}"
    pm2 start ogz-websocket --update-env 2>/dev/null || pm2 restart ogz-websocket --update-env
    wait_for_port 3010

    echo -e "\n${YELLOW}[Start] Stripe checkout server...${NC}"
    pm2 start public/stripe-checkout.js --name ogz-stripe --update-env 2>/dev/null || pm2 restart ogz-stripe --update-env
    wait_for_port 3001

    # Reload nginx to clear stale upstream connections
    echo -e "${YELLOW}[Start] Reloading nginx...${NC}"
    sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx && echo -e "${GREEN}[Start] nginx reloaded${NC}"

    # NOTE: Dashboard served via ogz-websocket (port 3010) - no separate dashboard server needed

    echo -e "${YELLOW}[Start] Trading bot + TRAI...${NC}"
    pm2 start ogz-prime-v2 --update-env 2>/dev/null || pm2 restart ogz-prime-v2 --update-env

    pm2 save
    sleep 3
    status
}

stop() {
    echo -e "\n${YELLOW}[Stop] Stopping all services...${NC}"
    pm2 stop ogz-prime-v2 ogz-websocket 2>/dev/null
    echo -e "${GREEN}[Stop] All services stopped${NC}"
}

status() {
    echo -e "\n${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}                      SERVICE STATUS                           ${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}\n"

    pm2 list | grep -E "ogz-|id.*name"

    echo -e "\n${YELLOW}TRAI Status:${NC}"
    if pm2 logs ogz-prime-v2 --lines 30 --nostream 2>/dev/null | grep -q "TRAI LLM Ready\|TRAI Server Ready"; then
        echo -e "  ${GREEN}✓ TRAI LLM loaded and ready${NC}"
    else
        echo -e "  ${YELLOW}⚠ TRAI status unknown (check logs)${NC}"
    fi

    echo -e "\n${YELLOW}URLs:${NC}"
    echo "  Dashboard:  https://ogzprime.com/unified-dashboard.html"
    echo "  WebSocket:  wss://ogzprime.com/ws"
    echo ""
}

case "${1:-start}" in
    start)   start ;;
    stop)    stop ;;
    restart) stop; sleep 2; start ;;
    status)  status ;;
    setup)   setup ;;
    *)       echo "Usage: $0 {start|stop|restart|status|setup}"; exit 1 ;;
esac
