#!/bin/bash
# OGZ Prime Health Monitor - runs every 30 mins

LOG="/home/linuxuser/.pm2/logs/ogz-prime-v2-out.log"
REPORT="/opt/ogzprime/OGZPMLV2/ogz-meta/health-reports/$(date +%Y%m%d-%H%M).txt"

mkdir -p /opt/ogzprime/OGZPMLV2/ogz-meta/health-reports

echo "=== OGZ Prime Health Check $(date) ===" > $REPORT
echo "" >> $REPORT

# Check PM2 status
echo "📊 PM2 STATUS:" >> $REPORT
pm2 list | grep ogz-prime-v2 >> $REPORT
echo "" >> $REPORT

# Regime check
echo "🌡️ REGIME (last 50 occurrences):" >> $REPORT
tail -500 $LOG | grep -o "regime: '[^']*'" | sort | uniq -c | sort -rn >> $REPORT
echo "" >> $REPORT

# Confidence distribution
echo "📈 CONFIDENCE LEVELS (last 50):" >> $REPORT
tail -500 $LOG | grep -oE "confidence: [0-9]+" | sort | uniq -c | sort -rn | head -10 >> $REPORT
echo "" >> $REPORT

# NaN/undefined check
echo "⚠️ NaN/UNDEFINED COUNT:" >> $REPORT
NAN_COUNT=$(tail -1000 $LOG | grep -ci "nan\|undefined" || echo "0")
echo "  Found: $NAN_COUNT occurrences" >> $REPORT
echo "" >> $REPORT

# Error check
echo "❌ ERRORS (last 10):" >> $REPORT
tail -500 $LOG | grep -i "error" | tail -10 >> $REPORT
echo "" >> $REPORT

# Pattern saves with PnL
echo "🧠 PATTERNS WITH PnL:" >> $REPORT
tail -1000 $LOG | grep -i "pattern.*pnl\|TRAI.*save\|PatternMemory" | tail -10 >> $REPORT
echo "" >> $REPORT

# Trade decisions
echo "🎯 RECENT DECISIONS:" >> $REPORT
tail -200 $LOG | grep "DECISION:" | tail -10 >> $REPORT

echo "" >> $REPORT
echo "=== END REPORT ===" >> $REPORT

cat $REPORT
