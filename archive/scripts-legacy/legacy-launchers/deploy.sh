#!/bin/bash
# =============================================================================
# OGZ PRIME V2 - ONE-CLICK DEPLOYMENT
# =============================================================================

echo "🚀 OGZ PRIME V2 - DEPLOYMENT WIZARD"
echo "===================================="
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not installed. Installing..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
fi

# Check docker-compose
if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing docker-compose..."
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Configuration wizard
echo "📝 CONFIGURATION"
echo "================"

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env file..."

    read -p "Enter your broker (kraken/binance/coinbase): " BROKER_ID
    read -p "Enter your API Key: " API_KEY
    read -p "Enter your API Secret: " API_SECRET

    echo "
📊 Risk Settings:
1) Conservative (0.05 position, 0.02 stop loss)
2) Moderate (0.10 position, 0.03 stop loss)
3) Aggressive (0.15 position, 0.05 stop loss)
"
    read -p "Select risk profile (1-3): " RISK_PROFILE

    case $RISK_PROFILE in
        1)
            MAX_POSITION="0.05"
            STOP_LOSS="0.02"
            MIN_CONFIDENCE="0.70"
            ;;
        2)
            MAX_POSITION="0.10"
            STOP_LOSS="0.03"
            MIN_CONFIDENCE="0.60"
            ;;
        3)
            MAX_POSITION="0.15"
            STOP_LOSS="0.05"
            MIN_CONFIDENCE="0.50"
            ;;
        *)
            MAX_POSITION="0.10"
            STOP_LOSS="0.03"
            MIN_CONFIDENCE="0.60"
            ;;
    esac

    # Create .env
    cat > .env << EOF
# Broker Configuration
BROKER_ID=$BROKER_ID
KRAKEN_API_KEY=$API_KEY
KRAKEN_API_SECRET=$API_SECRET

# Trading Mode
LIVE_TRADING=false
CONFIRM_LIVE_TRADING=false
PAPER_TRADING=true

# Risk Management
MAX_POSITION_SIZE=$MAX_POSITION
STOP_LOSS_PERCENT=$STOP_LOSS
MIN_TRADE_CONFIDENCE=$MIN_CONFIDENCE
INITIAL_BALANCE=10000

# System
AUTH_TOKEN=ogz_$(openssl rand -hex 16)
WS_PORT=3010
EOF

    echo "✅ Configuration saved to .env"
fi

# Deployment options
echo ""
echo "🚀 DEPLOYMENT OPTIONS"
echo "===================="
echo "1) Quick Start (Paper Trading)"
echo "2) Production (Live Trading)"
echo "3) Development Mode"
echo ""
read -p "Select deployment mode (1-3): " MODE

case $MODE in
    1)
        echo "📊 Starting in PAPER TRADING mode..."
        docker-compose up -d ogz-bot ogz-websocket ogz-dashboard
        ;;
    2)
        echo "⚠️  WARNING: LIVE TRADING MODE"
        read -p "Are you SURE you want to trade with REAL MONEY? (yes/no): " CONFIRM
        if [ "$CONFIRM" = "yes" ]; then
            sed -i 's/LIVE_TRADING=false/LIVE_TRADING=true/' .env
            sed -i 's/CONFIRM_LIVE_TRADING=false/CONFIRM_LIVE_TRADING=true/' .env
            sed -i 's/PAPER_TRADING=true/PAPER_TRADING=false/' .env
            docker-compose up -d
        else
            echo "Cancelled. Starting in paper mode instead..."
            docker-compose up -d ogz-bot ogz-websocket ogz-dashboard
        fi
        ;;
    3)
        echo "🔧 Starting in development mode..."
        docker-compose up ogz-bot ogz-websocket ogz-dashboard
        ;;
    *)
        echo "Invalid selection"
        exit 1
        ;;
esac

# Wait for services
echo ""
echo "⏳ Starting services..."
sleep 5

# Check status
docker-compose ps

echo ""
echo "✅ DEPLOYMENT COMPLETE!"
echo "======================"
echo "📊 Dashboard: http://localhost:3011"
echo "📡 WebSocket: ws://localhost:3010"
echo ""
echo "📝 Commands:"
echo "  View logs:    docker-compose logs -f ogz-bot"
echo "  Stop bot:     docker-compose stop"
echo "  Start bot:    docker-compose start"
echo "  Status:       docker-compose ps"
echo ""
echo "⚠️  IMPORTANT:"
echo "  - Monitor closely for first 30 minutes"
echo "  - Check dashboard for live data"
echo "  - Verify trades are executing as expected"
echo ""