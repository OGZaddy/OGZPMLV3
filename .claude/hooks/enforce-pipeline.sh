#!/bin/bash
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')

# Block direct edits to production code — must go through pipeline
PROTECTED_DIRS=("core/" "modules/" "run-empire-v2.js" "tuning/")

for dir in "${PROTECTED_DIRS[@]}"; do
  if echo "$FILE" | grep -q "^$dir"; then
    echo "BLOCKED: Direct edit to $FILE. Use the pipeline: node ogz-meta/pipeline.js" >&2
    exit 2
  fi
done

exit 0
