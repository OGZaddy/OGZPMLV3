#!/bin/bash
# =============================================================================
# OGZ PRIME V2 - AUTO UPDATER
# Automatically checks and applies updates
# =============================================================================

# Configuration
UPDATE_CHECK_INTERVAL=${UPDATE_CHECK_INTERVAL:-3600}  # Check every hour
AUTO_UPDATE=${AUTO_UPDATE:-false}  # Set to true for automatic updates
UPDATE_BRANCH=${UPDATE_BRANCH:-master}
LOG_FILE="logs/auto-updater.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a $LOG_FILE
}

# Check for updates
check_for_updates() {
    git fetch origin $UPDATE_BRANCH >/dev/null 2>&1

    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/$UPDATE_BRANCH)

    if [ "$LOCAL" != "$REMOTE" ]; then
        return 0  # Updates available
    else
        return 1  # No updates
    fi
}

# Apply update
apply_update() {
    log "📦 Applying update..."

    # Create backup
    BACKUP_DIR="backups/auto-$(date +%Y%m%d-%H%M%S)"
    mkdir -p $BACKUP_DIR
    cp -r data .env profiles/trading/*.json $BACKUP_DIR/ 2>/dev/null

    # Pull updates
    git pull origin $UPDATE_BRANCH

    # Detect deployment type
    if docker ps | grep -q "ogz-prime-bot"; then
        log "🐳 Updating Docker deployment..."

        # Method 1: Restart containers (fast)
        docker-compose restart

        # Method 2: Rebuild if needed (uncomment)
        # docker-compose up -d --build

    elif pm2 list | grep -q "ogz-prime-v2"; then
        log "⚡ Updating PM2 deployment..."
        npm install
        pm2 reload all

    else
        log "⚠️  No active deployment found"
    fi

    log "✅ Update applied successfully"
}

# Main loop
log "🔄 Auto-updater started"
log "   Check interval: ${UPDATE_CHECK_INTERVAL}s"
log "   Auto-update: ${AUTO_UPDATE}"
log "   Branch: ${UPDATE_BRANCH}"

while true; do
    if check_for_updates; then
        log "📦 Updates available!"

        if [ "$AUTO_UPDATE" = "true" ]; then
            apply_update
        else
            log "⚠️  Updates available but AUTO_UPDATE=false"
            log "   Run './update.sh' to apply manually"
        fi
    else
        log "✅ No updates available"
    fi

    sleep $UPDATE_CHECK_INTERVAL
done