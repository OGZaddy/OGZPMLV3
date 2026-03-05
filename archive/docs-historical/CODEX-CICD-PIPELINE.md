# OGZ PRIME CI/CD PIPELINE & INFRASTRUCTURE CODEX
Generated: 2025-12-25
Version: Empire V2 Architecture

## 🎯 EXECUTIVE SUMMARY
This document contains the complete CI/CD pipeline, MCP (Model Context Protocol) setup, RAG infrastructure, and Claudito automation chain for OGZ Prime V2.

---

## 📋 TABLE OF CONTENTS
1. [MCP Server Configuration](#mcp-server-configuration)
2. [RAG Infrastructure](#rag-infrastructure)
3. [OGZ-Meta Documentation System](#ogz-meta-documentation-system)
4. [Claudito Automation Chain](#claudito-automation-chain)
5. [CI/CD Pipeline](#cicd-pipeline)
6. [Deployment Strategies](#deployment-strategies)
7. [Update Mechanisms](#update-mechanisms)
8. [Critical Rules & Guardrails](#critical-rules--guardrails)

---

## 1. MCP SERVER CONFIGURATION

### Available MCP Servers
```json
{
  "mcp_servers": {
    "sequential-thinking": {
      "command": "npx -y @modelcontextprotocol/server-sequential-thinking",
      "purpose": "Break complex tasks into ordered steps",
      "auto_start": true
    },
    "railway": {
      "command": "npx -y @railway/mcp-server",
      "purpose": "Deployment automation",
      "auto_start": false
    },
    "playwright": {
      "command": "npx -y @playwright/mcp@latest",
      "purpose": "Browser automation testing",
      "auto_start": false
    },
    "mongodb": {
      "command": "npx -y mongodb-mcp-server",
      "purpose": "Database operations",
      "auto_start": false
    }
  }
}
```

### MCP Integration Points
- VS Code extensions trigger MCP servers
- Each server runs independently without singleton locks
- Servers spawn from `~/.npm/_npx/` temporary directory
- No coordination between multiple VS Code sessions

---

## 2. RAG INFRASTRUCTURE

### RAG Index Structure
```
ogz-meta/
├── rag_index.json          # Master index for RAG queries
├── claudito_context.md     # Compiled context for AI sessions
└── build-claudito-context.js # Builder script
```

### RAG Index Schema
```json
{
  "version": "1.0.0",
  "updated": "2025-12-25",
  "categories": {
    "architecture": {
      "files": ["02_architecture-overview.md"],
      "tags": ["system", "design", "flow"],
      "priority": 1
    },
    "modules": {
      "files": ["03_modules-overview.md"],
      "tags": ["components", "functionality"],
      "priority": 2
    },
    "landmines": {
      "files": ["05_landmines-and-gotchas.md"],
      "tags": ["warnings", "mistakes", "critical"],
      "priority": 0
    }
  },
  "search_index": {
    "pattern_memory": ["modules", "architecture"],
    "trai_brain": ["modules", "architecture"],
    "websocket": ["architecture", "modules"],
    "indicators": ["modules", "architecture"]
  }
}
```

---

## 3. OGZ-META DOCUMENTATION SYSTEM

### File Structure
```
ogz-meta/
├── 00_intent.md               # Meta-pack purpose
├── 01_purpose-and-vision.md   # Project vision
├── 02_architecture-overview.md # System architecture
├── 03_modules-overview.md     # Module map
├── 04_guardrails-and-rules.md # Development rules
├── 05_landmines-and-gotchas.md # Known issues
├── 06_recent-changes.md       # Change log
├── 07_trey-brain-lessons.md   # Learned patterns
├── build-claudito-context.js  # Context builder
└── claudito_context.md        # Generated output
```

### Build Process
```bash
# Build fresh context
cd ogz-meta
node build-claudito-context.js

# Output: claudito_context.md (auto-generated, do not edit)
```

### Context Usage
1. Paste `claudito_context.md` at start of new AI session
2. AI understands entire system without re-explanation
3. Prevents architecture violations
4. Enforces learned lessons

---

## 4. CLAUDITO AUTOMATION CHAIN

### Chain Components
```javascript
const CLAUDITO_CHAIN = {
  "orchestrator": {
    "role": "Coordinate all Clauditos",
    "input": "Problem description",
    "output": "Task delegation"
  },
  "forensics": {
    "role": "Investigate issues",
    "input": "Error/bug report",
    "output": "Root cause analysis"
  },
  "fixer": {
    "role": "Implement solutions",
    "input": "Root cause + fix strategy",
    "output": "Code changes"
  },
  "debugger": {
    "role": "Test and verify",
    "input": "Code changes",
    "output": "Test results"
  },
  "committer": {
    "role": "Git operations",
    "input": "Verified changes",
    "output": "Git commit + changelog"
  }
};
```

### Claudito Protocol
```bash
# Example: Fix pattern memory issue
claudito orchestrate "Pattern memory not persisting"
├── claudito forensics → finds this.memory undefined
├── claudito fixer → adds conditional init
├── claudito debugger → runs smoke test
└── claudito committer → commits with changelog
```

---

## 5. CI/CD PIPELINE

### GitHub Actions Workflow
```yaml
# .github/workflows/auto-deploy.yml
name: Auto Deploy OGZ Prime

on:
  push:
    branches: [master]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Deploy to VPS
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/ogzprime/OGZPMLV2
            git pull origin master
            npm install
            pm2 restart ogz-prime-v2
            pm2 save
```

### Local Deployment
```bash
# PM2 Process Management
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# Docker Deployment
docker-compose up -d
docker-compose logs -f
```

---

## 6. DEPLOYMENT STRATEGIES

### Strategy Matrix
```yaml
strategies:
  production:
    method: PM2
    auto_restart: true
    watch_mode: false
    environment: production

  development:
    method: PM2 + Watch
    auto_restart: true
    watch_mode: true
    environment: development

  docker_prod:
    method: Docker Compose
    file: docker-compose.yml
    auto_update: Watchtower

  docker_dev:
    method: Docker Compose
    file: docker-compose.dev.yml
    volumes: bind_mount
```

### Deployment Scripts
```bash
# deploy.sh - Production deployment
#!/bin/bash
git pull
npm install --production
pm2 restart all
pm2 save

# update.sh - Interactive updater
#!/bin/bash
echo "Backing up current version..."
tar -czf backup-$(date +%Y%m%d).tar.gz .
git pull
npm install
pm2 reload all --update-env
```

---

## 7. UPDATE MECHANISMS

### Automatic Updates
```javascript
// auto-updater.sh
const UPDATE_CONFIG = {
  check_interval: 300000,  // 5 minutes
  auto_apply: false,        // Require confirmation
  backup_before_update: true,
  rollback_on_failure: true,
  notification_webhook: process.env.DISCORD_WEBHOOK
};
```

### Watchtower Configuration
```yaml
# docker-compose.autoupdate.yml
services:
  watchtower:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_INCLUDE_STOPPED=false
      - WATCHTOWER_POLL_INTERVAL=300
```

---

## 8. CRITICAL RULES & GUARDRAILS

### Development Rules
```javascript
const CRITICAL_RULES = {
  "NO_DIRECT_MAIN": "Never commit directly to main branch",
  "NO_FORCE_PUSH": "Never force push to main/master",
  "NO_RESET_HARD": "git reset --hard is banned",
  "READ_META_FIRST": "Always read ogz-meta before changes",
  "TEST_BEFORE_COMMIT": "Run smoke tests before committing",
  "SINGLETON_PATTERN": "Use singletons for resource-heavy modules",
  "NO_SILENT_FAILURE": "Log all errors with context"
};
```

### Known Landmines
```yaml
landmines:
  PATTERN_PATH_003:
    issue: "Pattern memory saves to wrong path"
    cause: "Hardcoded path instead of config"
    fix: "Use data/pattern-memory.json"

  TRAI_MEMORY_LEAK:
    issue: "TRAI loads static brain 972 times"
    cause: "No singleton pattern"
    fix: "Implement static brain singleton"

  DUAL_WEBSOCKET:
    issue: "Two WebSocket sources conflict"
    cause: "Dashboard and bot both connect to Kraken"
    fix: "Single source of truth via bot"
```

### Architecture Invariants
```typescript
interface ArchitectureRules {
  // Single Responsibility
  "Each module has ONE job";

  // Brain-Agnostic Execution
  "ExecutionLayer works with ANY brain";

  // Config-Driven
  "No hardcoded broker quirks";

  // Deterministic
  "Same input = same output";

  // No Silent Failures
  "Log errors with full context";
}
```

---

## 9. EMPIRE V2 ARCHITECTURE

### Component Hierarchy
```
BrokerFactory (Single Source of Truth)
├── IBrokerAdapter Interface
│   ├── KrakenIBrokerAdapter
│   ├── BinanceIBrokerAdapter
│   └── CoinbaseIBrokerAdapter
│
IndicatorEngine (Single Source of Truth)
├── Technical Indicators
│   ├── RSI, MACD, Bollinger
│   ├── ATR, Stochastic, Williams %R
│   └── OGZ Two-Pole Oscillator
│
Trading Brain
├── Pattern Recognition
├── Risk Management
└── TRAI Decision Module
```

### Data Flow
```
Market Data → Bot → IndicatorEngine → WebSocket → Dashboard
                ↓
          Broker Adapter
                ↓
            Exchange
```

---

## 10. TESTING PROTOCOL

### Smoke Tests
```bash
# Pattern Memory Test
node -e "
const pm = require('./core/PatternMemorySystem');
const sys = new pm();
sys.saveTestPattern();
console.log('✅ Pattern memory working');
"

# WebSocket Test
curl -X GET http://localhost:3010/health

# Trading Test (Paper Mode)
PAPER_TRADING=true npm test
```

### Health Checks
```javascript
const HEALTH_CHECKS = {
  pattern_memory: "ls -la data/pattern-memory.json",
  websocket: "lsof -i :3010",
  bot_running: "pm2 status ogz-prime-v2",
  memory_usage: "pm2 list | grep ogz-prime",
  indicator_engine: "grep IndicatorEngine logs/out.log"
};
```

---

## 11. MONITORING & ALERTS

### PM2 Monitoring
```bash
# Real-time logs
pm2 logs --lines 100

# Process monitoring
pm2 monit

# Web dashboard
pm2 install pm2-web
pm2 web
```

### Memory Leak Detection
```javascript
// Monitor for memory growth
setInterval(() => {
  const usage = process.memoryUsage();
  if (usage.heapUsed > 500_000_000) { // 500MB
    console.error('⚠️ Memory leak detected!');
    // Restart or alert
  }
}, 60000);
```

---

## 12. QUICK COMMANDS

```bash
# Start everything
pm2 start ecosystem.config.js

# Update from GitHub
git pull && npm install && pm2 restart all

# Check status
pm2 list

# View logs
pm2 logs ogz-prime-v2 --lines 50

# Save PM2 config
pm2 save

# Docker commands
docker-compose up -d
docker-compose logs -f ogz-prime-bot
docker-compose restart

# Build context
cd ogz-meta && node build-claudito-context.js

# Run with watch mode
pm2 start ecosystem.watch.config.js

# Clean restart
pm2 delete all && pm2 start ecosystem.config.js
```

---

## 📝 NOTES FOR CODEX

1. **Always check ogz-meta/** before making architectural changes
2. **Use TodoWrite tool** to track complex multi-step tasks
3. **Run smoke tests** after significant changes
4. **Monitor memory usage** - TRAI can leak if not singleton
5. **WebSocket is single source** - bot feeds dashboard
6. **BrokerFactory pattern** - all exchanges through IBroker
7. **IndicatorEngine** - single source for all indicators
8. **Sequential thinking MCP** helps maintain focus
9. **Claudito chain** for systematic problem solving
10. **Empire V2** is the production architecture

---

Generated by Claude for OGZ Prime Empire V2
Last Updated: 2025-12-25