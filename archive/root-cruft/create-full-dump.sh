#!/bin/bash

# COMPREHENSIVE repo dump - get EVERYTHING

OUTPUT="ogz-complete-dump.txt"

echo "=== OGZ PRIME V2 COMPLETE REPOSITORY DUMP ===" > $OUTPUT
echo "Generated: $(date)" >> $OUTPUT
echo "=========================================" >> $OUTPUT
echo "" >> $OUTPUT

# Function to add file with full content
dump_file() {
    local file="$1"
    echo "" >> $OUTPUT
    echo "=================================================================================" >> $OUTPUT
    echo "FILE: $file" >> $OUTPUT
    echo "=================================================================================" >> $OUTPUT
    cat "$file" >> $OUTPUT 2>/dev/null || echo "[Binary or unreadable file]" >> $OUTPUT
}

# Get ALL JavaScript files recursively
echo "=== JAVASCRIPT FILES ===" >> $OUTPUT
find . -name "*.js" -type f ! -path "./node_modules/*" ! -path "./.git/*" ! -path "./trai_brain/models/*" | sort | while read -r file; do
    dump_file "$file"
done

# Get ALL JSON config files (excluding huge ones)
echo "=== JSON CONFIGURATION FILES ===" >> $OUTPUT
find . -name "*.json" -type f ! -path "./node_modules/*" ! -path "./.git/*" ! -path "./trai_brain/*.json" -size -1M | sort | while read -r file; do
    dump_file "$file"
done

# Get ALL Markdown documentation
echo "=== DOCUMENTATION FILES ===" >> $OUTPUT
find . -name "*.md" -type f ! -path "./node_modules/*" ! -path "./.git/*" | sort | while read -r file; do
    dump_file "$file"
done

# Get ALL shell scripts
echo "=== SHELL SCRIPTS ===" >> $OUTPUT
find . -name "*.sh" -type f ! -path "./node_modules/*" ! -path "./.git/*" | sort | while read -r file; do
    dump_file "$file"
done

# Get environment examples
echo "=== ENVIRONMENT FILES ===" >> $OUTPUT
for file in .env.example config/.env.example; do
    [ -f "$file" ] && dump_file "$file"
done

# Get any Python files
echo "=== PYTHON FILES ===" >> $OUTPUT
find . -name "*.py" -type f ! -path "./node_modules/*" ! -path "./.git/*" | sort | while read -r file; do
    dump_file "$file"
done

# Get HTML files
echo "=== HTML FILES ===" >> $OUTPUT
find . -name "*.html" -type f ! -path "./node_modules/*" ! -path "./.git/*" | sort | while read -r file; do
    dump_file "$file"
done

# Get CSS files
echo "=== CSS FILES ===" >> $OUTPUT
find . -name "*.css" -type f ! -path "./node_modules/*" ! -path "./.git/*" | sort | while read -r file; do
    dump_file "$file"
done

# Get any config files
for file in .gitignore .npmignore package.json tsconfig.json .eslintrc* .prettierrc*; do
    [ -f "$file" ] && dump_file "$file"
done

# Stats
TOTAL_FILES=$(find . -type f ! -path "./node_modules/*" ! -path "./.git/*" ! -path "./trai_brain/models/*" | wc -l)
TOTAL_LINES=$(wc -l < $OUTPUT)
FILE_SIZE=$(du -h $OUTPUT | cut -f1)

echo "" >> $OUTPUT
echo "=================================================================================" >> $OUTPUT
echo "DUMP COMPLETE" >> $OUTPUT
echo "Total files in project: $TOTAL_FILES" >> $OUTPUT
echo "Total lines in dump: $TOTAL_LINES" >> $OUTPUT
echo "Dump file size: $FILE_SIZE" >> $OUTPUT
echo "=================================================================================" >> $OUTPUT

echo "✅ Complete dump created: $OUTPUT"
echo "📊 Stats:"
echo "   Files: $TOTAL_FILES"
echo "   Lines: $TOTAL_LINES"
echo "   Size: $FILE_SIZE"