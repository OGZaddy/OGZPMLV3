#!/bin/bash

# OGZ Prime V2 - Full Repository Dump Script
# Creates a complete text dump of all source files for GPT

OUTPUT_FILE="ogz-prime-full-repo-dump.txt"

echo "=== OGZ PRIME V2 FULL REPOSITORY DUMP ===" > $OUTPUT_FILE
echo "Generated: $(date)" >> $OUTPUT_FILE
echo "=" >> $OUTPUT_FILE
echo "" >> $OUTPUT_FILE

# Function to add file content
add_file() {
    local file=$1
    if [ -f "$file" ]; then
        echo "" >> $OUTPUT_FILE
        echo "=================================================================================" >> $OUTPUT_FILE
        echo "FILE: $file" >> $OUTPUT_FILE
        echo "=================================================================================" >> $OUTPUT_FILE
        cat "$file" >> $OUTPUT_FILE
        echo "" >> $OUTPUT_FILE
    fi
}

# Main entry point
add_file "run-empire-v2.js"

# Core modules
echo "=== CORE MODULES ===" >> $OUTPUT_FILE
for file in core/*.js; do
    if [ -f "$file" ]; then
        add_file "$file"
    fi
done

# Utils
echo "=== UTILS ===" >> $OUTPUT_FILE
for file in utils/*.js; do
    if [ -f "$file" ]; then
        add_file "$file"
    fi
done

# Brokers
echo "=== BROKERS ===" >> $OUTPUT_FILE
for file in brokers/*.js; do
    if [ -f "$file" ]; then
        add_file "$file"
    fi
done

# Config files
echo "=== CONFIG FILES ===" >> $OUTPUT_FILE
add_file "package.json"
add_file ".env.example"
add_file "config/.env.example"

# Trading profiles
echo "=== TRADING PROFILES ===" >> $OUTPUT_FILE
for file in profiles/trading/*.json; do
    if [ -f "$file" ]; then
        add_file "$file"
    fi
done

# Documentation
echo "=== DOCUMENTATION ===" >> $OUTPUT_FILE
add_file "CHANGELOG.md"
add_file "README.md"
for file in ogz-meta/*.md; do
    if [ -f "$file" ]; then
        add_file "$file"
    fi
done

# Pattern memory (if not too large)
if [ -f "pattern_memory.json" ]; then
    FILE_SIZE=$(stat -c%s "pattern_memory.json" 2>/dev/null || stat -f%z "pattern_memory.json" 2>/dev/null)
    if [ "$FILE_SIZE" -lt 1000000 ]; then  # Less than 1MB
        add_file "pattern_memory.json"
    else
        echo "" >> $OUTPUT_FILE
        echo "=================================================================================" >> $OUTPUT_FILE
        echo "FILE: pattern_memory.json (TOO LARGE - $FILE_SIZE bytes)" >> $OUTPUT_FILE
        echo "=================================================================================" >> $OUTPUT_FILE
        echo "[File omitted due to size]" >> $OUTPUT_FILE
    fi
fi

# Count stats
TOTAL_FILES=$(find . -name "*.js" -o -name "*.json" -o -name "*.md" | grep -v node_modules | grep -v ".git" | wc -l)
TOTAL_LINES=$(wc -l $OUTPUT_FILE | awk '{print $1}')
FILE_SIZE=$(du -h $OUTPUT_FILE | awk '{print $1}')

echo "" >> $OUTPUT_FILE
echo "=================================================================================" >> $OUTPUT_FILE
echo "=== REPOSITORY STATISTICS ===" >> $OUTPUT_FILE
echo "Total files processed: ~$TOTAL_FILES" >> $OUTPUT_FILE
echo "Total lines in dump: $TOTAL_LINES" >> $OUTPUT_FILE
echo "Dump file size: $FILE_SIZE" >> $OUTPUT_FILE
echo "=================================================================================" >> $OUTPUT_FILE

echo "Repository dump created: $OUTPUT_FILE"
echo "Size: $FILE_SIZE"
echo "Lines: $TOTAL_LINES"