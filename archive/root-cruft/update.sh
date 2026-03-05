#!/bin/bash
# =============================================================================
# OGZ PRIME V2 - UPDATE SYSTEM
# Updates deployed containers with latest code
# =============================================================================

echo "🔄 OGZ PRIME V2 - UPDATE MANAGER"
echo "================================="
echo ""

# Detect current deployment method
detect_deployment() {
    if docker ps | grep -q "ogz-prime-bot"; then
        echo "docker"
    elif pm2 list | grep -q "ogz-prime-v2"; then
        echo "pm2"
    else
        echo "none"
    fi
}

DEPLOYMENT=$(detect_deployment)
echo "📊 Current deployment: $DEPLOYMENT"
echo ""

# Function to backup current state
backup_current() {
    echo "📦 Creating backup..."
    BACKUP_DIR="backups/$(date +%Y%m%d-%H%M%S)"
    mkdir -p $BACKUP_DIR

    # Backup database and configs
    cp -r data/* $BACKUP_DIR/ 2>/dev/null
    cp .env $BACKUP_DIR/.env.backup 2>/dev/null
    cp profiles/trading/*.json $BACKUP_DIR/ 2>/dev/null

    echo "✅ Backup created: $BACKUP_DIR"
}

# Function to update via Git
update_from_git() {
    echo "📥 Pulling latest code from Git..."

    # Stash local changes
    git stash push -m "Auto-stash before update $(date)"

    # Pull latest
    git pull origin master

    # Check for conflicts
    if [ $? -ne 0 ]; then
        echo "⚠️  Git conflicts detected. Attempting merge..."
        git stash pop
        echo "Please resolve conflicts manually"
        return 1
    fi

    echo "✅ Code updated from Git"
    return 0
}

# Function to update Docker containers
update_docker() {
    echo "🐳 Updating Docker containers..."

    # Stop current containers
    docker-compose down

    # Rebuild with latest code
    docker-compose build --no-cache

    # Start with new version
    docker-compose up -d

    echo "✅ Docker containers updated"
}

# Function to update PM2 processes
update_pm2() {
    echo "⚡ Updating PM2 processes..."

    # Save current process list
    pm2 save

    # Stop processes
    pm2 stop all

    # Update dependencies
    npm install

    # Restart with new code
    pm2 restart all --update-env

    echo "✅ PM2 processes updated"
}

# Function to update running container without rebuild
update_live_container() {
    echo "🔥 Hot-updating running container..."

    CONTAINER_ID=$(docker ps -q -f name=ogz-prime-bot)

    if [ -z "$CONTAINER_ID" ]; then
        echo "❌ Container not running"
        return 1
    fi

    # Copy new code into running container
    docker cp ./run-empire-v2.js $CONTAINER_ID:/app/
    docker cp ./core $CONTAINER_ID:/app/
    docker cp ./brokers $CONTAINER_ID:/app/

    # Restart process inside container
    docker exec $CONTAINER_ID pm2 restart all

    echo "✅ Container hot-updated"
}

# Function to check update status
check_updates() {
    echo "🔍 Checking for updates..."

    # Fetch latest from remote
    git fetch origin

    # Compare with local
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/master)

    if [ "$LOCAL" = "$REMOTE" ]; then
        echo "✅ Already up to date"
        return 1
    else
        echo "📦 Updates available:"
        git log HEAD..origin/master --oneline
        return 0
    fi
}

# Main update menu
echo "🔄 UPDATE OPTIONS"
echo "================="
echo "1) Quick Update (restart with latest code)"
echo "2) Full Update (rebuild everything)"
echo "3) Hot Reload (update without stopping)"
echo "4) Check for Updates Only"
echo "5) Rollback to Previous Version"
echo ""
read -p "Select update method (1-5): " CHOICE

case $CHOICE in
    1)
        echo "⚡ QUICK UPDATE"
        backup_current
        update_from_git

        if [ "$DEPLOYMENT" = "docker" ]; then
            docker-compose restart
        elif [ "$DEPLOYMENT" = "pm2" ]; then
            pm2 restart all
        else
            echo "Starting fresh deployment..."
            ./run-latest.sh
        fi
        ;;

    2)
        echo "🔨 FULL UPDATE"
        backup_current
        update_from_git

        if [ "$DEPLOYMENT" = "docker" ]; then
            update_docker
        elif [ "$DEPLOYMENT" = "pm2" ]; then
            update_pm2
        else
            npm install
            ./deploy.sh
        fi
        ;;

    3)
        echo "🔥 HOT RELOAD"
        if [ "$DEPLOYMENT" = "docker" ]; then
            update_live_container
        elif [ "$DEPLOYMENT" = "pm2" ]; then
            # PM2 can reload without downtime
            pm2 reload all
        else
            echo "❌ No deployment to hot reload"
        fi
        ;;

    4)
        echo "🔍 CHECK ONLY"
        if check_updates; then
            read -p "Apply updates now? (y/n): " APPLY
            if [ "$APPLY" = "y" ]; then
                $0 # Re-run this script
            fi
        fi
        ;;

    5)
        echo "⏪ ROLLBACK"
        echo "Available backups:"
        ls -la backups/ 2>/dev/null | grep "^d" | tail -5
        read -p "Enter backup timestamp to restore: " TIMESTAMP

        if [ -d "backups/$TIMESTAMP" ]; then
            cp backups/$TIMESTAMP/.env.backup .env
            cp backups/$TIMESTAMP/*.json profiles/trading/
            echo "✅ Rolled back to $TIMESTAMP"

            # Restart services
            if [ "$DEPLOYMENT" = "docker" ]; then
                docker-compose restart
            elif [ "$DEPLOYMENT" = "pm2" ]; then
                pm2 restart all
            fi
        else
            echo "❌ Backup not found"
        fi
        ;;

    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

# Post-update checks
echo ""
echo "🔍 POST-UPDATE CHECKS"
echo "===================="

# Check if services are running
sleep 5
if [ "$DEPLOYMENT" = "docker" ]; then
    docker-compose ps
    echo ""
    echo "📊 Container logs:"
    docker-compose logs --tail=20 ogz-bot
elif [ "$DEPLOYMENT" = "pm2" ]; then
    pm2 status
    echo ""
    echo "📊 Process logs:"
    pm2 logs --lines 20 --nostream
fi

echo ""
echo "✅ UPDATE COMPLETE!"
echo ""
echo "🔍 Verify:"
echo "  - Dashboard: http://localhost:3011"
echo "  - WebSocket: ws://localhost:3010"
echo "  - Logs: docker-compose logs -f ogz-bot"
echo ""