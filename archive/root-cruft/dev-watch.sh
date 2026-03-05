#!/bin/bash
# Auto-restart on code changes

echo "🔄 Starting development mode with auto-reload..."

# Use development docker-compose
docker compose -f docker-compose.dev.yml up -d

echo "👀 Watching for code changes..."

# Install inotify-tools if not present
if ! command -v inotifywait &> /dev/null; then
    echo "Installing inotify-tools..."
    sudo apt-get update && sudo apt-get install -y inotify-tools
fi

# Watch for changes and restart
while true; do
    # Watch for JS file changes
    inotifywait -r -e modify,create,delete \
        --exclude 'node_modules|\.git|logs|data' \
        --include '.*\.js$|.*\.json$' \
        .

    echo "🔄 Code changed! Restarting containers..."

    # Restart the containers (they use volume mounts, so code is updated)
    docker compose -f docker-compose.dev.yml restart ogz-bot-dev

    echo "✅ Restarted with latest code"
    sleep 2
done