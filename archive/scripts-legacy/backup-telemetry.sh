#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# OGZPRIME Telemetry & Pattern Memory Backup Script
# Run daily via cron: 0 0 * * * /opt/ogzprime/OGZPMLV2/scripts/backup-telemetry.sh
# ═══════════════════════════════════════════════════════════════════════════

BACKUP_DIR="/backups/ogzprime"
DATE=$(date +%Y-%m-%d_%H%M%S)
SRC_DIR="/opt/ogzprime/OGZPMLV2"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup JSONL telemetry logs
if [ -d "$SRC_DIR/logs" ]; then
  cp "$SRC_DIR/logs/trai-decisions.log" "$BACKUP_DIR/trai-decisions_$DATE.log" 2>/dev/null || true
  cp "$SRC_DIR/logs/trade-outcomes.log" "$BACKUP_DIR/trade-outcomes_$DATE.log" 2>/dev/null || true
fi

# Backup PatternMemoryBank files (all modes)
for mode in paper live backtest; do
  SRC="$SRC_DIR/data/pattern-memory.$mode.json"
  [ -f "$SRC" ] && cp "$SRC" "$BACKUP_DIR/pattern-memory.$mode_$DATE.json" 2>/dev/null || true
done

# Also backup legacy learned_patterns.json if exists
[ -f "$SRC_DIR/learned_patterns.json" ] && cp "$SRC_DIR/learned_patterns.json" "$BACKUP_DIR/learned_patterns_$DATE.json" 2>/dev/null || true

# Cleanup backups older than 30 days
find "$BACKUP_DIR" -name "*.log" -mtime +30 -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "*.json" -mtime +30 -delete 2>/dev/null || true

echo "[$(date)] Backup complete: $BACKUP_DIR"
