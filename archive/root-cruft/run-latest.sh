#!/bin/bash
# ALWAYS runs with latest code - no Docker build needed!

echo "🚀 OGZ PRIME V2 - LIVE CODE MODE"
echo "================================="
echo "This mode runs directly from your code directory"
echo "Any changes you make are immediately active!"
echo ""

# Method selection
echo "Choose run method:"
echo "1) PM2 with auto-reload (recommended)"
echo "2) Docker with volume mounts"
echo "3) Direct node execution"
echo ""
read -p "Select method (1-3): " METHOD

case $METHOD in
    1)
        echo "🔄 Starting with PM2 auto-reload..."
        pm2 delete all 2>/dev/null
        pm2 start ecosystem.watch.config.js
        pm2 logs --lines 50
        ;;
    2)
        echo "🐳 Starting Docker with live code..."
        docker compose -f docker-compose.dev.yml up
        ;;
    3)
        echo "🖥️  Starting direct execution..."
        node run-empire-v2.js
        ;;
    *)
        echo "Invalid selection"
        exit 1
        ;;
esac