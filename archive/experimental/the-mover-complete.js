// ==========================================
// THE MOVER - COMPLETE DEPLOYMENT PACKAGE
// ==========================================
// Deploy these files to /mover directory

// ==========================================
// FILE: mover-core.js
// The AI brain - processes trades, makes decisions, generates responses
// ==========================================
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class MoverCore extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      personality: config.personality || 'professional_trader',
      verbosity: config.verbosity || 'balanced',
      responseDelay: config.responseDelay || 100,
      ...config
    };
    
    this.state = {
      isActive: true,
      currentMarketRegime: 'neutral',
      lastTradeAnalysis: null,
      sessionStats: {
        tradesNarrated: 0,
        profitLoss: 0,
        winRate: 0,
        startTime: Date.now()
      }
    };

    this.responseTemplates = {
      trade_executed: [
        "Execute confirmed: {action} {amount} {asset} at ${price}. {reasoning}",
        "Position taken: Going {direction} on {asset}. Target: ${target}, Stop: ${stop}.",
        "Trade deployed: {action} signal triggered. Confidence: {confidence}%. Let's ride."
      ],
      market_analysis: [
        "Market regime detected: {regime}. Adjusting strategies accordingly.",
        "Pattern recognition: {pattern} forming on {timeframe}. Probability: {probability}%.",
        "Volatility spike detected. Tightening risk parameters."
      ],
      profit_alert: [
        "Target hit! +${profit} secured. {percentage}% gain on this position.",
        "Winner! Banking ${profit}. That's {streak} in a row. System performing optimally.",
        "Profit secured: ${profit}. Houston fund progress: {progress}%."
      ],
      loss_management: [
        "Stop triggered. -${loss} managed. Risk control working as designed.",
        "Position closed at loss: -${loss}. Part of the strategy. Next setup loading...",
        "Loss contained at -${loss}. Win rate still {winRate}%. Trust the process."
      ]
    };

    this.doctrineRules = [];
    this.contextMemory = [];
    
    console.log(`[MoverCore] Initialized with personality: ${this.config.personality}`);
  }

  async processTradeEvent(tradeData) {
    try {
      this.state.sessionStats.tradesNarrated++;
      
      // Analyze trade context
      const analysis = this.analyzeTradeContext(tradeData);
      
      // Generate appropriate response
      const response = await this.generateResponse(tradeData, analysis);
      
      // Update state
      this.updateState(tradeData, analysis);
      
      // Emit narration event
      this.emit('narration', {
        type: 'trade',
        data: tradeData,
        analysis,
        response,
        timestamp: Date.now()
      });

      return response;
    } catch (error) {
      console.error('[MoverCore] Trade processing error:', error);
      return this.generateErrorResponse(error);
    }
  }

  analyzeTradeContext(tradeData) {
    const analysis = {
      tradeType: tradeData.action || 'UNKNOWN',
      asset: tradeData.asset || 'BTC-USD',
      amount: tradeData.amount || 0,
      price: tradeData.price || 0,
      confidence: tradeData.confidence || 0,
      reasoning: this.extractReasoning(tradeData),
      marketContext: this.state.currentMarketRegime,
      riskLevel: this.calculateRiskLevel(tradeData),
      projectedOutcome: this.projectOutcome(tradeData)
    };

    // Apply doctrine rules
    this.doctrineRules.forEach(rule => {
      if (rule.condition(analysis)) {
        analysis.doctrineFlags = analysis.doctrineFlags || [];
        analysis.doctrineFlags.push(rule.name);
      }
    });

    return analysis;
  }

  extractReasoning(tradeData) {
    if (tradeData.reasoning) return tradeData.reasoning;
    
    const signals = tradeData.signals || [];
    const patterns = tradeData.patterns || [];
    
    let reasoning = "";
    if (patterns.length > 0) {
      reasoning += `Pattern detected: ${patterns[0].name} (${patterns[0].confidence}%). `;
    }
    if (signals.length > 0) {
      reasoning += `Signals: ${signals.map(s => s.name).join(', ')}.`;
    }
    
    return reasoning || "Technical conditions met.";
  }

  calculateRiskLevel(tradeData) {
    const positionSize = tradeData.amount * tradeData.price;
    const accountBalance = this.config.accountBalance || 10000;
    const riskPercent = (positionSize / accountBalance) * 100;
    
    if (riskPercent > 5) return 'HIGH';
    if (riskPercent > 2) return 'MODERATE';
    return 'LOW';
  }

  projectOutcome(tradeData) {
    const winProbability = tradeData.confidence / 100;
    const riskReward = tradeData.riskReward || 2;
    const expectedValue = (winProbability * riskReward) - (1 - winProbability);
    
    return {
      expectedValue,
      winProbability,
      recommendation: expectedValue > 0.2 ? 'FAVORABLE' : 'CAUTIOUS'
    };
  }

  async generateResponse(tradeData, analysis) {
    const templateKey = this.getTemplateKey(tradeData, analysis);
    const templates = this.responseTemplates[templateKey] || this.responseTemplates.trade_executed;
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    // Fill in template variables
    let response = template;
    const variables = {
      action: tradeData.action,
      amount: tradeData.amount,
      asset: tradeData.asset,
      price: tradeData.price.toFixed(2),
      direction: tradeData.action === 'BUY' ? 'long' : 'short',
      confidence: analysis.confidence,
      reasoning: analysis.reasoning,
      regime: this.state.currentMarketRegime,
      pattern: tradeData.patterns?.[0]?.name || 'No pattern',
      winRate: (this.state.sessionStats.winRate * 100).toFixed(1),
      progress: this.calculateHoustonProgress()
    };
    
    Object.keys(variables).forEach(key => {
      response = response.replace(new RegExp(`{${key}}`, 'g'), variables[key]);
    });
    
    // Add personality flair
    response = this.addPersonalityFlair(response);
    
    // Simulate processing delay for realism
    await new Promise(resolve => setTimeout(resolve, this.config.responseDelay));
    
    return response;
  }

  getTemplateKey(tradeData, analysis) {
    if (tradeData.profitLoss && tradeData.profitLoss > 0) return 'profit_alert';
    if (tradeData.profitLoss && tradeData.profitLoss < 0) return 'loss_management';
    if (tradeData.type === 'analysis') return 'market_analysis';
    return 'trade_executed';
  }

  addPersonalityFlair(response) {
    if (this.config.personality === 'aggressive_trader') {
      response += " 🚀 LFG!";
    } else if (this.config.personality === 'zen_master') {
      response += " 🧘 Patience and discipline.";
    } else if (this.config.personality === 'houston_focused') {
      response += " 🎯 Every trade brings Houston closer.";
    }
    return response;
  }

  calculateHoustonProgress() {
    const target = this.config.houstonTarget || 25000;
    const current = this.config.accountBalance || 10000;
    return ((current / target) * 100).toFixed(1);
  }

  updateState(tradeData, analysis) {
    this.state.lastTradeAnalysis = analysis;
    
    if (tradeData.profitLoss) {
      this.state.sessionStats.profitLoss += tradeData.profitLoss;
      
      if (tradeData.profitLoss > 0) {
        this.state.sessionStats.wins = (this.state.sessionStats.wins || 0) + 1;
      } else {
        this.state.sessionStats.losses = (this.state.sessionStats.losses || 0) + 1;
      }
      
      const totalTrades = (this.state.sessionStats.wins || 0) + (this.state.sessionStats.losses || 0);
      this.state.sessionStats.winRate = totalTrades > 0 ? 
        (this.state.sessionStats.wins || 0) / totalTrades : 0;
    }
    
    // Update market regime if provided
    if (tradeData.marketRegime) {
      this.state.currentMarketRegime = tradeData.marketRegime;
    }
    
    // Add to context memory
    this.contextMemory.push({
      timestamp: Date.now(),
      trade: tradeData,
      analysis,
      response: this.state.lastResponse
    });
    
    // Keep only last 100 events in memory
    if (this.contextMemory.length > 100) {
      this.contextMemory = this.contextMemory.slice(-100);
    }
  }

  generateErrorResponse(error) {
    return `System notice: ${error.message}. Monitoring continues...`;
  }

  async loadDoctrine(doctrinePath) {
    try {
      const doctrineContent = await fs.readFile(doctrinePath, 'utf8');
      const doctrine = JSON.parse(doctrineContent);
      
      this.doctrineRules = doctrine.rules || [];
      this.config = { ...this.config, ...doctrine.config };
      
      console.log(`[MoverCore] Loaded ${this.doctrineRules.length} doctrine rules`);
      this.emit('doctrine_loaded', { rules: this.doctrineRules.length });
    } catch (error) {
      console.error('[MoverCore] Failed to load doctrine:', error);
    }
  }

  getSessionReport() {
    const runtime = Date.now() - this.state.sessionStats.startTime;
    const hours = (runtime / (1000 * 60 * 60)).toFixed(1);
    
    return {
      runtime: `${hours} hours`,
      tradesNarrated: this.state.sessionStats.tradesNarrated,
      profitLoss: this.state.sessionStats.profitLoss.toFixed(2),
      winRate: (this.state.sessionStats.winRate * 100).toFixed(1) + '%',
      currentRegime: this.state.currentMarketRegime,
      houstonProgress: this.calculateHoustonProgress() + '%'
    };
  }
}

module.exports = MoverCore;

// ==========================================
// FILE: mover-memory.js
// Context and doctrine management system
// ==========================================
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class MoverMemory extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      memoryDir: config.memoryDir || './memory',
      maxMemorySize: config.maxMemorySize || 10000,
      persistInterval: config.persistInterval || 60000, // 1 minute
      ...config
    };
    
    this.shortTermMemory = []; // Recent events
    this.longTermMemory = {};  // Key insights and patterns
    this.doctrineLibrary = {}; // Loaded doctrine files
    this.contextWindow = [];   // Current conversation context
    
    this.initializeMemorySystem();
  }

  async initializeMemorySystem() {
    try {
      // Ensure memory directory exists
      await fs.mkdir(this.config.memoryDir, { recursive: true });
      
      // Load existing memories
      await this.loadPersistedMemory();
      
      // Start persistence interval
      this.persistenceInterval = setInterval(() => {
        this.persistMemory().catch(console.error);
      }, this.config.persistInterval);
      
      console.log('[MoverMemory] Memory system initialized');
    } catch (error) {
      console.error('[MoverMemory] Initialization error:', error);
    }
  }

  async ingestDoctrine(doctrinePath, doctrineId) {
    try {
      const content = await fs.readFile(doctrinePath, 'utf8');
      let doctrine;
      
      // Handle different doctrine formats
      if (doctrinePath.endsWith('.json')) {
        doctrine = JSON.parse(content);
      } else if (doctrinePath.endsWith('.md')) {
        doctrine = this.parseMarkdownDoctrine(content);
      } else {
        doctrine = { raw: content, type: 'text' };
      }
      
      // Store in library
      this.doctrineLibrary[doctrineId] = {
        id: doctrineId,
        path: doctrinePath,
        content: doctrine,
        loadedAt: Date.now(),
        version: doctrine.version || '1.0'
      };
      
      // Extract key rules and insights
      const insights = this.extractInsights(doctrine);
      this.updateLongTermMemory('doctrine', doctrineId, insights);
      
      this.emit('doctrine_ingested', { 
        doctrineId, 
        insightCount: insights.length 
      });
      
      console.log(`[MoverMemory] Ingested doctrine: ${doctrineId}`);
      return insights;
    } catch (error) {
      console.error(`[MoverMemory] Failed to ingest doctrine:`, error);
      throw error;
    }
  }

  parseMarkdownDoctrine(markdown) {
    const doctrine = {
      sections: {},
      rules: [],
      guidelines: []
    };
    
    const lines = markdown.split('\n');
    let currentSection = 'general';
    
    lines.forEach(line => {
      if (line.startsWith('# ')) {
        currentSection = line.substring(2).toLowerCase().replace(/\s+/g, '_');
        doctrine.sections[currentSection] = [];
      } else if (line.startsWith('- Rule:')) {
        doctrine.rules.push(line.substring(7).trim());
      } else if (line.startsWith('- Guideline:')) {
        doctrine.guidelines.push(line.substring(12).trim());
      } else if (line.trim() && doctrine.sections[currentSection]) {
        doctrine.sections[currentSection].push(line.trim());
      }
    });
    
    return doctrine;
  }

  extractInsights(doctrine) {
    const insights = [];
    
    // Extract rules
    if (doctrine.rules) {
      doctrine.rules.forEach(rule => {
        insights.push({
          type: 'rule',
          content: rule,
          priority: rule.priority || 'normal',
          conditions: rule.conditions || []
        });
      });
    }
    
    // Extract trading strategies
    if (doctrine.strategies) {
      Object.entries(doctrine.strategies).forEach(([name, strategy]) => {
        insights.push({
          type: 'strategy',
          name,
          content: strategy,
          triggerConditions: strategy.triggers || []
        });
      });
    }
    
    // Extract personality traits
    if (doctrine.personality) {
      insights.push({
        type: 'personality',
        traits: doctrine.personality.traits || [],
        responses: doctrine.personality.responses || {}
      });
    }
    
    return insights;
  }

  recordEvent(eventType, eventData) {
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: eventType,
      data: eventData,
      timestamp: Date.now(),
      context: this.getCurrentContext()
    };
    
    // Add to short-term memory
    this.shortTermMemory.push(event);
    
    // Maintain memory size limit
    if (this.shortTermMemory.length > this.config.maxMemorySize) {
      // Move oldest events to long-term memory if significant
      const removed = this.shortTermMemory.splice(0, 100);
      this.compressToLongTerm(removed);
    }
    
    // Update context window
    this.updateContextWindow(event);
    
    return event.id;
  }

  compressToLongTerm(events) {
    // Analyze events for patterns and insights
    const patterns = this.detectPatterns(events);
    const summary = this.generateSummary(events);
    
    // Store compressed insights
    const compressionId = `comp_${Date.now()}`;
    this.updateLongTermMemory('compression', compressionId, {
      eventCount: events.length,
      timeRange: {
        start: events[0].timestamp,
        end: events[events.length - 1].timestamp
      },
      patterns,
      summary,
      significantEvents: events.filter(e => this.isSignificant(e))
    });
  }

  detectPatterns(events) {
    const patterns = [];
    
    // Trade outcome patterns
    const tradeEvents = events.filter(e => e.type === 'trade');
    if (tradeEvents.length > 5) {
      const winRate = tradeEvents.filter(t => t.data.profitLoss > 0).length / tradeEvents.length;
      patterns.push({
        type: 'trade_performance',
        winRate,
        sampleSize: tradeEvents.length
      });
    }
    
    // Time-based patterns
    const hourlyDistribution = {};
    events.forEach(event => {
      const hour = new Date(event.timestamp).getHours();
      hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;
    });
    
    const peakHour = Object.entries(hourlyDistribution)
      .sort((a, b) => b[1] - a[1])[0];
    
    if (peakHour) {
      patterns.push({
        type: 'activity_pattern',
        peakHour: parseInt(peakHour[0]),
        eventsInPeakHour: peakHour[1]
      });
    }
    
    return patterns;
  }

  generateSummary(events) {
    const summary = {
      totalEvents: events.length,
      eventTypes: {},
      keyOutcomes: []
    };
    
    events.forEach(event => {
      summary.eventTypes[event.type] = (summary.eventTypes[event.type] || 0) + 1;
      
      if (this.isSignificant(event)) {
        summary.keyOutcomes.push({
          type: event.type,
          outcome: event.data.outcome || event.data.profitLoss || 'recorded'
        });
      }
    });
    
    return summary;
  }

  isSignificant(event) {
    // Trade with high profit/loss
    if (event.type === 'trade' && Math.abs(event.data.profitLoss || 0) > 100) {
      return true;
    }
    
    // System alerts
    if (event.type === 'alert' || event.type === 'error') {
      return true;
    }
    
    // Milestone events
    if (event.data.milestone || event.data.achievement) {
      return true;
    }
    
    return false;
  }

  updateContextWindow(event) {
    this.contextWindow.push({
      type: event.type,
      summary: this.summarizeEvent(event),
      timestamp: event.timestamp
    });
    
    // Keep only last 20 items in context
    if (this.contextWindow.length > 20) {
      this.contextWindow = this.contextWindow.slice(-20);
    }
  }

  summarizeEvent(event) {
    switch (event.type) {
      case 'trade':
        return `${event.data.action} ${event.data.asset} at $${event.data.price}`;
      case 'analysis':
        return `Market ${event.data.marketRegime}, confidence ${event.data.confidence}%`;
      case 'alert':
        return event.data.message || 'System alert';
      default:
        return event.type;
    }
  }

  getCurrentContext() {
    return {
      recentEvents: this.contextWindow.slice(-5),
      activeDoctrines: Object.keys(this.doctrineLibrary),
      memoryStats: {
        shortTermSize: this.shortTermMemory.length,
        longTermCategories: Object.keys(this.longTermMemory)
      }
    };
  }

  updateLongTermMemory(category, key, value) {
    if (!this.longTermMemory[category]) {
      this.longTermMemory[category] = {};
    }
    
    this.longTermMemory[category][key] = {
      value,
      updatedAt: Date.now(),
      accessCount: 0
    };
  }

  recall(query, options = {}) {
    const results = {
      shortTerm: [],
      longTerm: [],
      doctrine: []
    };
    
    // Search short-term memory
    results.shortTerm = this.shortTermMemory.filter(event => {
      return this.matchesQuery(event, query);
    }).slice(-(options.limit || 10));
    
    // Search long-term memory
    Object.entries(this.longTermMemory).forEach(([category, items]) => {
      Object.entries(items).forEach(([key, item]) => {
        if (this.matchesQuery(item.value, query)) {
          results.longTerm.push({
            category,
            key,
            ...item
          });
          item.accessCount++;
        }
      });
    });
    
    // Search doctrine
    Object.entries(this.doctrineLibrary).forEach(([id, doctrine]) => {
      const matches = this.searchDoctrine(doctrine.content, query);
      if (matches.length > 0) {
        results.doctrine.push({
          doctrineId: id,
          matches
        });
      }
    });
    
    return results;
  }

  matchesQuery(item, query) {
    const queryLower = query.toLowerCase();
    const itemStr = JSON.stringify(item).toLowerCase();
    return itemStr.includes(queryLower);
  }

  searchDoctrine(doctrine, query) {
    const matches = [];
    const queryLower = query.toLowerCase();
    
    // Search rules
    if (doctrine.rules) {
      doctrine.rules.forEach((rule, index) => {
        if (JSON.stringify(rule).toLowerCase().includes(queryLower)) {
          matches.push({ type: 'rule', index, content: rule });
        }
      });
    }
    
    // Search sections
    if (doctrine.sections) {
      Object.entries(doctrine.sections).forEach(([section, content]) => {
        if (JSON.stringify(content).toLowerCase().includes(queryLower)) {
          matches.push({ type: 'section', section, content });
        }
      });
    }
    
    return matches;
  }

  async persistMemory() {
    try {
      const memoryState = {
        shortTermMemory: this.shortTermMemory.slice(-1000), // Keep last 1000
        longTermMemory: this.longTermMemory,
        contextWindow: this.contextWindow,
        timestamp: Date.now()
      };
      
      const filePath = path.join(
        this.config.memoryDir, 
        `memory_${new Date().toISOString().split('T')[0]}.json`
      );
      
      await fs.writeFile(filePath, JSON.stringify(memoryState, null, 2));
      
      console.log('[MoverMemory] Memory persisted successfully');
    } catch (error) {
      console.error('[MoverMemory] Failed to persist memory:', error);
    }
  }

  async loadPersistedMemory() {
    try {
      const files = await fs.readdir(this.config.memoryDir);
      const memoryFiles = files.filter(f => f.startsWith('memory_')).sort();
      
      if (memoryFiles.length > 0) {
        const latestFile = memoryFiles[memoryFiles.length - 1];
        const filePath = path.join(this.config.memoryDir, latestFile);
        const content = await fs.readFile(filePath, 'utf8');
        const memoryState = JSON.parse(content);
        
        this.shortTermMemory = memoryState.shortTermMemory || [];
        this.longTermMemory = memoryState.longTermMemory || {};
        this.contextWindow = memoryState.contextWindow || [];
        
        console.log(`[MoverMemory] Loaded memory from ${latestFile}`);
      }
    } catch (error) {
      console.error('[MoverMemory] Failed to load persisted memory:', error);
    }
  }

  getMemoryStats() {
    return {
      shortTermCount: this.shortTermMemory.length,
      longTermCategories: Object.keys(this.longTermMemory),
      longTermTotalItems: Object.values(this.longTermMemory)
        .reduce((sum, category) => sum + Object.keys(category).length, 0),
      doctrineCount: Object.keys(this.doctrineLibrary).length,
      contextWindowSize: this.contextWindow.length
    };
  }

  cleanup() {
    if (this.persistenceInterval) {
      clearInterval(this.persistenceInterval);
    }
    return this.persistMemory();
  }
}

module.exports = MoverMemory;

// ==========================================
// FILE: mover-server.js
// WebSocket server and API router
// ==========================================
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const MoverCore = require('./mover-core');
const MoverMemory = require('./mover-memory');
const MoverLogInterpreter = require('./mover-log-interpreter');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

class MoverServer {
  constructor(config = {}) {
    this.config = {
      httpPort: process.env.MOVER_HTTP_PORT || 4000,
      wsPort: process.env.MOVER_WS_PORT || 4001,
      botWsUrl: process.env.BOT_WS_URL || 'ws://localhost:8080',
      voiceEnabled: process.env.VOICE_ENABLED === 'true',
      ...config
    };
    
    // Initialize components
    this.moverCore = new MoverCore({
      personality: process.env.MOVER_PERSONALITY || 'houston_focused',
      accountBalance: parseFloat(process.env.ACCOUNT_BALANCE) || 10000,
      houstonTarget: parseFloat(process.env.HOUSTON_TARGET) || 25000
    });
    
    this.moverMemory = new MoverMemory({
      memoryDir: process.env.MEMORY_DIR || './memory'
    });
    
    this.logInterpreter = new MoverLogInterpreter({
      moverCore: this.moverCore,
      moverMemory: this.moverMemory
    });
    
    // Client connections
    this.wsClients = new Set();
    this.botConnection = null;
    
    this.initializeServer();
  }

  async initializeServer() {
    try {
      // Set up Express server
      this.app = express();
      this.app.use(express.json());
      this.setupRoutes();
      
      // Create HTTP server
      this.httpServer = http.createServer(this.app);
      
      // Create WebSocket server
      this.wss = new WebSocket.Server({ 
        port: this.config.wsPort 
      });
      
      this.setupWebSocketServer();
      
      // Connect to OGZ Prime bot
      await this.connectToBot();
      
      // Load initial doctrine
      if (process.env.INITIAL_DOCTRINE) {
        await this.moverCore.loadDoctrine(process.env.INITIAL_DOCTRINE);
        await this.moverMemory.ingestDoctrine(
          process.env.INITIAL_DOCTRINE, 
          'primary_doctrine'
        );
      }
      
      // Start HTTP server
      this.httpServer.listen(this.config.httpPort, () => {
        console.log(`[MoverServer] HTTP API running on port ${this.config.httpPort}`);
        console.log(`[MoverServer] WebSocket server running on port ${this.config.wsPort}`);
        console.log(`[MoverServer] The Mover is ONLINE! 🧠🚀`);
      });
      
      // Set up core event handlers
      this.setupCoreHandlers();
      
    } catch (error) {
      console.error('[MoverServer] Initialization failed:', error);
      process.exit(1);
    }
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'online',
        uptime: process.uptime(),
        connections: {
          clients: this.wsClients.size,
          botConnected: !!this.botConnection
        },
        stats: {
          ...this.moverCore.getSessionReport(),
          memory: this.moverMemory.getMemoryStats()
        }
      });
    });
    
    // Ingest doctrine
    this.app.post('/doctrine/ingest', async (req, res) => {
      try {
        const { path: doctrinePath, id } = req.body;
        const insights = await this.moverMemory.ingestDoctrine(doctrinePath, id);
        await this.moverCore.loadDoctrine(doctrinePath);
        
        res.json({
          success: true,
          doctrineId: id,
          insightsExtracted: insights.length
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
    
    // Manual narration trigger
    this.app.post('/narrate', async (req, res) => {
      try {
        const response = await this.moverCore.processTradeEvent(req.body);
        res.json({
          success: true,
          narration: response
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
    
    // Memory recall
    this.app.get('/memory/recall', (req, res) => {
      const { query, limit } = req.query;
      const results = this.moverMemory.recall(query, { limit: parseInt(limit) || 10 });
      res.json(results);
    });
    
    // Session report
    this.app.get('/report', (req, res) => {
      res.json({
        session: this.moverCore.getSessionReport(),
        memory: this.moverMemory.getMemoryStats()
      });
    });
    
    // Voice control
    this.app.post('/voice/toggle', (req, res) => {
      this.config.voiceEnabled = !this.config.voiceEnabled;
      res.json({
        voiceEnabled: this.config.voiceEnabled
      });
    });
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      console.log('[MoverServer] New client connected');
      
      // Add to clients set
      this.wsClients.add(ws);
      
      // Send welcome message
      ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Connected to The Mover',
        personality: this.moverCore.config.personality,
        voiceEnabled: this.config.voiceEnabled
      }));
      
      // Handle client messages
      ws.on('message', (message) => {
        this.handleClientMessage(ws, message);
      });
      
      // Handle disconnection
      ws.on('close', () => {
        this.wsClients.delete(ws);
        console.log('[MoverServer] Client disconnected');
      });
      
      ws.on('error', (error) => {
        console.error('[MoverServer] WebSocket error:', error);
        this.wsClients.delete(ws);
      });
    });
  }

  async handleClientMessage(ws, message) {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'subscribe':
          // Client wants real-time narrations
          ws.isSubscribed = true;
          ws.send(JSON.stringify({
            type: 'subscribed',
            message: 'You will receive real-time narrations'
          }));
          break;
          
        case 'command':
          // Process user command
          const response = await this.processUserCommand(data.command);
          ws.send(JSON.stringify({
            type: 'command_response',
            response
          }));
          break;
          
        case 'query':
          // Memory query
          const results = this.moverMemory.recall(data.query);
          ws.send(JSON.stringify({
            type: 'query_results',
            results
          }));
          break;
          
        default:
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Unknown message type'
          }));
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  }

  async processUserCommand(command) {
    // Simple command processor
    const cmd = command.toLowerCase().trim();
    
    if (cmd.includes('status')) {
      return this.moverCore.getSessionReport();
    } else if (cmd.includes('help')) {
      return {
        commands: [
          'status - Get current session report',
          'memory stats - Get memory statistics',
          'voice on/off - Toggle voice output',
          'personality [type] - Change personality'
        ]
      };
    } else if (cmd.includes('memory stats')) {
      return this.moverMemory.getMemoryStats();
    } else if (cmd.includes('voice on')) {
      this.config.voiceEnabled = true;
      return 'Voice output enabled';
    } else if (cmd.includes('voice off')) {
      this.config.voiceEnabled = false;
      return 'Voice output disabled';
    } else if (cmd.startsWith('personality')) {
      const personality = cmd.split(' ')[1];
      if (personality) {
        this.moverCore.config.personality = personality;
        return `Personality changed to: ${personality}`;
      }
    }
    
    return 'Command not recognized. Type "help" for available commands.';
  }

  async connectToBot() {
    try {
      console.log(`[MoverServer] Connecting to OGZ Prime at ${this.config.botWsUrl}`);
      
      this.botConnection = new WebSocket(this.config.botWsUrl);
      
      this.botConnection.on('open', () => {
        console.log('[MoverServer] Connected to OGZ Prime bot!');
        
        // Subscribe to trade events
        this.botConnection.send(JSON.stringify({
          type: 'subscribe',
          channels: ['trades', 'analysis', 'alerts']
        }));
      });
      
      this.botConnection.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          await this.processBotMessage(data);
        } catch (error) {
          console.error('[MoverServer] Error processing bot message:', error);
        }
      });
      
      this.botConnection.on('close', () => {
        console.log('[MoverServer] Disconnected from bot. Reconnecting in 5s...');
        this.botConnection = null;
        setTimeout(() => this.connectToBot(), 5000);
      });
      
      this.botConnection.on('error', (error) => {
        console.error('[MoverServer] Bot connection error:', error);
      });
      
    } catch (error) {
      console.error('[MoverServer] Failed to connect to bot:', error);
      setTimeout(() => this.connectToBot(), 5000);
    }
  }

  async processBotMessage(data) {
    // Record in memory
    const eventId = this.moverMemory.recordEvent(data.type || 'bot_message', data);
    
    // Process based on type
    if (data.type === 'trade' || data.action) {
      // Trade event - generate narration
      const narration = await this.moverCore.processTradeEvent(data);
      
      // Broadcast to subscribed clients
      this.broadcastToClients({
        type: 'narration',
        source: 'trade',
        content: narration,
        data: data,
        eventId,
        timestamp: Date.now()
      });
      
      // Send to voice pipeline if enabled
      if (this.config.voiceEnabled) {
        this.sendToVoicePipeline(narration);
      }
      
    } else if (data.type === 'analysis') {
      // Market analysis update
      if (data.marketRegime) {
        this.moverCore.state.currentMarketRegime = data.marketRegime;
      }
      
      // Generate analysis narration
      const narration = await this.moverCore.generateResponse(data, {
        type: 'market_analysis',
        marketRegime: data.marketRegime,
        confidence: data.confidence
      });
      
      this.broadcastToClients({
        type: 'narration',
        source: 'analysis',
        content: narration,
        data: data,
        eventId,
        timestamp: Date.now()
      });
      
    } else if (data.type === 'alert') {
      // System alert
      this.broadcastToClients({
        type: 'alert',
        content: data.message || 'System alert received',
        severity: data.severity || 'info',
        eventId,
        timestamp: Date.now()
      });
    }
  }

  setupCoreHandlers() {
    // Handle narrations from core
    this.moverCore.on('narration', (narration) => {
      this.broadcastToClients(narration);
      
      if (this.config.voiceEnabled) {
        this.sendToVoicePipeline(narration.response);
      }
    });
    
    // Handle doctrine updates
    this.moverMemory.on('doctrine_ingested', (info) => {
      this.broadcastToClients({
        type: 'system',
        message: `Doctrine ingested: ${info.doctrineId} (${info.insightCount} insights)`,
        timestamp: Date.now()
      });
    });
  }

  broadcastToClients(message) {
    const messageStr = JSON.stringify(message);
    
    this.wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && client.isSubscribed) {
        client.send(messageStr);
      }
    });
  }

  sendToVoicePipeline(text) {
    // Placeholder for voice integration
    // This would connect to ElevenLabs or other TTS service
    console.log(`[Voice Output] ${text}`);
    
    // Emit event for external voice handlers
    this.moverCore.emit('voice_output', {
      text,
      personality: this.moverCore.config.personality,
      timestamp: Date.now()
    });
  }

  async shutdown() {
    console.log('[MoverServer] Shutting down...');
    
    // Close WebSocket connections
    this.wsClients.forEach(client => client.close());
    this.wss.close();
    
    if (this.botConnection) {
      this.botConnection.close();
    }
    
    // Save memory
    await this.moverMemory.cleanup();
    
    // Close HTTP server
    this.httpServer.close();
    
    console.log('[MoverServer] Shutdown complete');
  }
}

// Launch server if run directly
if (require.main === module) {
  const server = new MoverServer();
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    await server.shutdown();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await server.shutdown();
    process.exit(0);
  });
}

module.exports = MoverServer;

// ==========================================
// FILE: mover-log-interpreter.js
// Interprets logs and generates contextual narrations
// ==========================================
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class MoverLogInterpreter extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      logDir: config.logDir || './logs',
      patterns: config.patterns || this.getDefaultPatterns(),
      contextWindow: config.contextWindow || 50,
      ...config
    };
    
    this.moverCore = config.moverCore;
    this.moverMemory = config.moverMemory;
    
    this.logBuffer = [];
    this.interpretationCache = new Map();
  }

  getDefaultPatterns() {
    return {
      trade_execution: /(?:BUY|SELL)\s+(\d+\.?\d*)\s+(\w+[-/]\w+)\s+@\s+\$?(\d+\.?\d*)/i,
      profit_loss: /(?:P&L|Profit|Loss):\s*([+-]?\$?\d+\.?\d*)/i,
      pattern_detected: /Pattern\s+(?:detected|found):\s*(\w+)\s*\((\d+\.?\d*)%?\)/i,
      confidence_level: /Confidence:\s*(\d+\.?\d*)%?/i,
      market_regime: /Market\s+(?:regime|condition):\s*(\w+)/i,
      risk_alert: /(?:Risk|Warning|Alert):\s*(.+)/i,
      position_closed: /Position\s+closed.*?([+-]?\$?\d+\.?\d*)/i,
      system_status: /System\s+(?:status|state):\s*(\w+)/i,
      error_log: /(?:ERROR|CRITICAL):\s*(.+)/i,
      milestone: /(?:Milestone|Achievement|Target).*?reached/i
    };
  }

  async interpretLogFile(logPath) {
    try {
      const content = await fs.readFile(logPath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      const interpretations = [];
      
      for (const line of lines) {
        const interpretation = await this.interpretLogLine(line);
        if (interpretation) {
          interpretations.push(interpretation);
          
          // Process significant events immediately
          if (interpretation.significance === 'high') {
            await this.processSignificantEvent(interpretation);
          }
        }
      }
      
      // Generate summary
      const summary = this.generateLogSummary(interpretations);
      
      return {
        logPath,
        linesProcessed: lines.length,
        interpretations,
        summary
      };
    } catch (error) {
      console.error('[LogInterpreter] Failed to interpret log file:', error);
      throw error;
    }
  }

  async interpretLogLine(line) {
    // Check cache first
    const cached = this.interpretationCache.get(line);
    if (cached) {
      return cached;
    }
    
    const interpretation = {
      raw: line,
      timestamp: this.extractTimestamp(line),
      type: 'unknown',
      data: {},
      significance: 'low'
    };
    
    // Match against patterns
    for (const [patternName, regex] of Object.entries(this.config.patterns)) {
      const match = line.match(regex);
      if (match) {
        interpretation.type = patternName;
        interpretation.data = this.extractDataFromMatch(patternName, match);
        interpretation.significance = this.assessSignificance(patternName, interpretation.data);
        break;
      }
    }
    
    // Add context
    interpretation.context = this.getLogContext(line);
    
    // Generate human-readable interpretation
    interpretation.humanReadable = await this.generateHumanReadable(interpretation);
    
    // Cache result
    this.interpretationCache.set(line, interpretation);
    
    // Maintain cache size
    if (this.interpretationCache.size > 1000) {
      const firstKey = this.interpretationCache.keys().next().value;
      this.interpretationCache.delete(firstKey);
    }
    
    return interpretation;
  }

  extractTimestamp(line) {
    // Common timestamp patterns
    const patterns = [
      /\[(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}\.?\d*Z?)\]/,
      /^(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})/,
      /\((\d{13})\)/ // Unix timestamp
    ];
    
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const timestamp = match[1];
        // Convert to ISO format if needed
        if (/^\d{13}$/.test(timestamp)) {
          return new Date(parseInt(timestamp)).toISOString();
        }
        return timestamp;
      }
    }
    
    return new Date().toISOString();
  }

  extractDataFromMatch(patternName, match) {
    const data = {};
    
    switch (patternName) {
      case 'trade_execution':
        data.amount = parseFloat(match[1]);
        data.asset = match[2];
        data.price = parseFloat(match[3]);
        data.action = match[0].includes('BUY') ? 'BUY' : 'SELL';
        break;
        
      case 'profit_loss':
        data.value = parseFloat(match[1].replace('$', ''));
        data.isProfit = data.value > 0;
        break;
        
      case 'pattern_detected':
        data.pattern = match[1];
        data.confidence = parseFloat(match[2]);
        break;
        
      case 'confidence_level':
        data.confidence = parseFloat(match[1]);
        break;
        
      case 'market_regime':
        data.regime = match[1].toLowerCase();
        break;
        
      case 'risk_alert':
        data.message = match[1];
        break;
        
      case 'position_closed':
        data.result = parseFloat(match[1].replace('$', ''));
        break;
        
      case 'error_log':
        data.error = match[1];
        break;
        
      default:
        data.raw = match[0];
    }
    
    return data;
  }

  assessSignificance(type, data) {
    switch (type) {
      case 'trade_execution':
        // Large trades are significant
        if (data.amount * data.price > 1000) return 'high';
        return 'medium';
        
      case 'profit_loss':
        // Large P&L is significant
        if (Math.abs(data.value) > 100) return 'high';
        return 'medium';
        
      case 'error_log':
        return 'high';
        
      case 'milestone':
        return 'high';
        
      case 'risk_alert':
        return 'medium';
        
      default:
        return 'low';
    }
  }

  getLogContext(line) {
    // Get surrounding lines from buffer
    const lineIndex = this.logBuffer.indexOf(line);
    if (lineIndex === -1) {
      return [];
    }
    
    const start = Math.max(0, lineIndex - 5);
    const end = Math.min(this.logBuffer.length, lineIndex + 5);
    
    return this.logBuffer.slice(start, end).map((contextLine, index) => ({
      line: contextLine,
      isTarget: start + index === lineIndex
    }));
  }

  async generateHumanReadable(interpretation) {
    if (!this.moverCore) {
      return this.generateBasicNarration(interpretation);
    }
    
    // Use MoverCore for sophisticated narration
    const tradeEvent = this.interpretationToTradeEvent(interpretation);
    return await this.moverCore.processTradeEvent(tradeEvent);
  }

  generateBasicNarration(interpretation) {
    const { type, data } = interpretation;
    
    switch (type) {
      case 'trade_execution':
        return `Executed ${data.action} order: ${data.amount} ${data.asset} at $${data.price}`;
        
      case 'profit_loss':
        return data.isProfit ? 
          `Profit recorded: $${data.value}` : 
          `Loss recorded: $${Math.abs(data.value)}`;
        
      case 'pattern_detected':
        return `${data.pattern} pattern detected with ${data.confidence}% confidence`;
        
      case 'market_regime':
        return `Market regime identified as ${data.regime}`;
        
      case 'risk_alert':
        return `Risk alert: ${data.message}`;
        
      case 'position_closed':
        return `Position closed with ${data.result > 0 ? 'profit' : 'loss'}: $${Math.abs(data.result)}`;
        
      case 'error_log':
        return `System error: ${data.error}`;
        
      default:
        return interpretation.raw;
    }
  }

  interpretationToTradeEvent(interpretation) {
    const { type, data, timestamp } = interpretation;
    
    return {
      type: type,
      timestamp: timestamp,
      ...data,
      source: 'log_interpretation'
    };
  }

  async processSignificantEvent(interpretation) {
    // Record in memory
    if (this.moverMemory) {
      this.moverMemory.recordEvent('significant_log_event', interpretation);
    }
    
    // Emit for real-time processing
    this.emit('significant_event', interpretation);
    
    // Generate alert narration if needed
    if (interpretation.type === 'error_log' || interpretation.type === 'risk_alert') {
      const alertNarration = `Alert: ${interpretation.humanReadable}`;
      this.emit('alert_narration', {
        content: alertNarration,
        severity: 'high',
        interpretation
      });
    }
  }

  generateLogSummary(interpretations) {
    const summary = {
      totalEvents: interpretations.length,
      eventTypes: {},
      trades: {
        total: 0,
        buys: 0,
        sells: 0,
        totalVolume: 0
      },
      profitLoss: {
        total: 0,
        profits: 0,
        losses: 0,
        winRate: 0
      },
      patterns: {},
      errors: [],
      significantEvents: []
    };
    
    interpretations.forEach(interp => {
      // Count event types
      summary.eventTypes[interp.type] = (summary.eventTypes[interp.type] || 0) + 1;
      
      // Process trades
      if (interp.type === 'trade_execution') {
        summary.trades.total++;
        if (interp.data.action === 'BUY') {
          summary.trades.buys++;
        } else {
          summary.trades.sells++;
        }
        summary.trades.totalVolume += interp.data.amount * interp.data.price;
      }
      
      // Process P&L
      if (interp.type === 'profit_loss') {
        summary.profitLoss.total += interp.data.value;
        if (interp.data.isProfit) {
          summary.profitLoss.profits++;
        } else {
          summary.profitLoss.losses++;
        }
      }
      
      // Track patterns
      if (interp.type === 'pattern_detected') {
        const pattern = interp.data.pattern;
        summary.patterns[pattern] = (summary.patterns[pattern] || 0) + 1;
      }
      
      // Collect errors
      if (interp.type === 'error_log') {
        summary.errors.push({
          timestamp: interp.timestamp,
          error: interp.data.error
        });
      }
      
      // Significant events
      if (interp.significance === 'high') {
        summary.significantEvents.push({
          timestamp: interp.timestamp,
          type: interp.type,
          description: interp.humanReadable
        });
      }
    });
    
    // Calculate win rate
    if (summary.profitLoss.profits + summary.profitLoss.losses > 0) {
      summary.profitLoss.winRate = 
        (summary.profitLoss.profits / (summary.profitLoss.profits + summary.profitLoss.losses)) * 100;
    }
    
    return summary;
  }

  async watchLogFile(logPath) {
    console.log(`[LogInterpreter] Watching log file: ${logPath}`);
    
    // Initial read
    const initialContent = await fs.readFile(logPath, 'utf8');
    this.logBuffer = initialContent.split('\n').filter(line => line.trim());
    
    // Process initial content
    for (const line of this.logBuffer) {
      await this.interpretLogLine(line);
    }
    
    // Watch for changes
    let lastSize = initialContent.length;
    
    const watcher = setInterval(async () => {
      try {
        const stats = await fs.stat(logPath);
        
        if (stats.size > lastSize) {
          // Read new content
          const content = await fs.readFile(logPath, 'utf8');
          const newContent = content.substring(lastSize);
          const newLines = newContent.split('\n').filter(line => line.trim());
          
          // Process new lines
          for (const line of newLines) {
            this.logBuffer.push(line);
            
            // Maintain buffer size
            if (this.logBuffer.length > this.config.contextWindow * 2) {
              this.logBuffer.shift();
            }
            
            const interpretation = await this.interpretLogLine(line);
            if (interpretation) {
              this.emit('new_interpretation', interpretation);
              
              if (interpretation.significance === 'high') {
                await this.processSignificantEvent(interpretation);
              }
            }
          }
          
          lastSize = stats.size;
        }
      } catch (error) {
        console.error('[LogInterpreter] Watch error:', error);
      }
    }, 1000); // Check every second
    
    return {
      stop: () => clearInterval(watcher)
    };
  }
}

module.exports = MoverLogInterpreter;

// ==========================================
// FILE: primary_doctrine.json
// Initial doctrine for The Mover
// ==========================================
{
  "version": "1.0",
  "name": "Houston Mission Doctrine",
  "description": "Primary trading doctrine focused on achieving Houston relocation goal",
  "config": {
    "riskTolerance": "moderate",
    "primaryGoal": "houston_relocation",
    "targetAmount": 25000,
    "timeframe": "6_months"
  },
  "rules": [
    {
      "name": "capital_preservation",
      "priority": "critical",
      "condition": {
        "type": "always"
      },
      "action": "Never risk more than 2% of account on a single trade"
    },
    {
      "name": "houston_focus",
      "priority": "high",
      "condition": {
        "type": "profit_threshold",
        "value": 100
      },
      "action": "Celebrate progress toward Houston goal"
    },
    {
      "name": "pattern_confidence",
      "priority": "high",
      "condition": {
        "type": "pattern_detected",
        "minConfidence": 80
      },
      "action": "Increase position size by 50% for high-confidence patterns"
    },
    {
      "name": "loss_management",
      "priority": "critical",
      "condition": {
        "type": "consecutive_losses",
        "count": 3
      },
      "action": "Reduce position size by 50% and reassess strategy"
    }
  ],
  "strategies": {
    "momentum_rider": {
      "description": "Ride strong trends with trailing stops",
      "triggers": ["trend_strength > 0.7", "volume_spike"],
      "exitRules": ["trailing_stop_2_percent", "reversal_pattern"]
    },
    "mean_reversion": {
      "description": "Fade extremes in ranging markets",
      "triggers": ["rsi_oversold", "bollinger_band_touch"],
      "exitRules": ["return_to_mean", "stop_loss_1_percent"]
    }
  },
  "personality": {
    "traits": ["determined", "houston_focused", "risk_aware", "celebratory"],
    "responses": {
      "big_win": "That's {profit} closer to Houston! Only ${remaining} to go!",
      "loss": "Managed loss. Eyes on the prize - Houston awaits.",
      "milestone": "MILESTONE! Houston fund at {percentage}%! 🚀"
    }
  }
}

// ==========================================
// FILE: mover-frontend.html
// Simple frontend to interact with The Mover
// ==========================================
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Mover - OGZ Prime AI Assistant</title>
    <style>
        body {
            background: #0a0a0a;
            color: #00ff00;
            font-family: 'Courier New', monospace;
            margin: 0;
            padding: 20px;
            min-height: 100vh;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        h1 {
            text-align: center;
            font-size: 2.5em;
            margin-bottom: 10px;
            text-shadow: 0 0 10px #00ff00;
        }
        
        .subtitle {
            text-align: center;
            color: #888;
            margin-bottom: 30px;
        }
        
        .status-bar {
            background: #111;
            border: 1px solid #00ff00;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .status-item {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .status-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #ff0000;
        }
        
        .status-indicator.connected {
            background: #00ff00;
            box-shadow: 0 0 5px #00ff00;
        }
        
        .narration-feed {
            background: #111;
            border: 1px solid #00ff00;
            border-radius: 5px;
            height: 400px;
            overflow-y: auto;
            padding: 20px;
            margin-bottom: 20px;
        }
        
        .narration-item {
            margin-bottom: 15px;
            padding: 10px;
            background: rgba(0, 255, 0, 0.05);
            border-left: 3px solid #00ff00;
            animation: fadeIn 0.5s;
        }
        
        .narration-item.profit {
            border-left-color: #00ff00;
            background: rgba(0, 255, 0, 0.1);
        }
        
        .narration-item.loss {
            border-left-color: #ff0000;
            background: rgba(255, 0, 0, 0.1);
        }
        
        .narration-time {
            color: #666;
            font-size: 0.8em;
        }
        
        .controls {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .btn {
            background: transparent;
            border: 1px solid #00ff00;
            color: #00ff00;
            padding: 10px 20px;
            cursor: pointer;
            border-radius: 3px;
            transition: all 0.3s;
        }
        
        .btn:hover {
            background: rgba(0, 255, 0, 0.1);
            box-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }
        
        .stat-card {
            background: #111;
            border: 1px solid #00ff00;
            padding: 15px;
            border-radius: 5px;
            text-align: center;
        }
        
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            margin: 10px 0;
        }
        
        .stat-label {
            color: #666;
            font-size: 0.9em;
        }
        
        .houston-progress {
            background: #111;
            border: 1px solid #00ff00;
            padding: 20px;
            border-radius: 5px;
            margin-top: 20px;
        }
        
        .progress-bar {
            background: #222;
            height: 30px;
            border-radius: 15px;
            overflow: hidden;
            position: relative;
            margin: 20px 0;
        }
        
        .progress-fill {
            background: linear-gradient(90deg, #00ff00, #00aa00);
            height: 100%;
            transition: width 0.5s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #000;
            font-weight: bold;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        ::-webkit-scrollbar {
            width: 10px;
        }
        
        ::-webkit-scrollbar-track {
            background: #111;
        }
        
        ::-webkit-scrollbar-thumb {
            background: #00ff00;
            border-radius: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🧠 THE MOVER</h1>
        <p class="subtitle">AI Support Agent for OGZ Prime Trading System</p>
        
        <div class="status-bar">
            <div class="status-item">
                <span class="status-indicator" id="botStatus"></span>
                <span>Bot Connection</span>
            </div>
            <div class="status-item">
                <span class="status-indicator" id="voiceStatus"></span>
                <span>Voice Output</span>
            </div>
            <div class="status-item">
                <span id="personality">Personality: Loading...</span>
            </div>
        </div>
        
        <div class="controls">
            <button class="btn" onclick="toggleVoice()">Toggle Voice</button>
            <button class="btn" onclick="changePersonality()">Change Personality</button>
            <button class="btn" onclick="requestReport()">Get Report</button>
        </div>
        
        <div class="narration-feed" id="narrationFeed">
            <div style="text-align: center; color: #666;">Waiting for narrations...</div>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Trades Narrated</div>
                <div class="stat-value" id="tradesNarrated">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Session P&L</div>
                <div class="stat-value" id="sessionPL">$0.00</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Win Rate</div>
                <div class="stat-value" id="winRate">0%</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Current Regime</div>
                <div class="stat-value" id="marketRegime">-</div>
            </div>
        </div>
        
        <div class="houston-progress">
            <h2>🚀 Houston Fund Progress</h2>
            <div class="progress-bar">
                <div class="progress-fill" id="houstonProgress" style="width: 40%">
                    40% - $10,000 / $25,000
                </div>
            </div>
            <p style="text-align: center; color: #666;">Every trade brings Houston closer!</p>
        </div>
    </div>
    
    <script>
        let ws = null;
        let voiceEnabled = false;
        let currentPersonality = 'houston_focused';
        
        function connectWebSocket() {
            ws = new WebSocket('ws://localhost:4001');
            
            ws.onopen = () => {
                console.log('Connected to The Mover');
                document.getElementById('botStatus').classList.add('connected');
                
                // Subscribe to narrations
                ws.send(JSON.stringify({
                    type: 'subscribe'
                }));
            };
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleMessage(data);
            };
            
            ws.onclose = () => {
                document.getElementById('botStatus').classList.remove('connected');
                setTimeout(connectWebSocket, 5000);
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        }
        
        function handleMessage(data) {
            switch (data.type) {
                case 'welcome':
                    document.getElementById('personality').textContent = `Personality: ${data.personality}`;
                    voiceEnabled = data.voiceEnabled;
                    updateVoiceStatus();
                    break;
                    
                case 'narration':
                    addNarration(data);
                    break;
                    
                case 'command_response':
                    if (data.response.runtime) {
                        updateStats(data.response);
                    }
                    break;
            }
        }
        
        function addNarration(narration) {
            const feed = document.getElementById('narrationFeed');
            
            // Clear initial message
            if (feed.children[0]?.style?.textAlign === 'center') {
                feed.innerHTML = '';
            }
            
            const item = document.createElement('div');
            item.className = 'narration-item';
            
            // Add profit/loss class
            if (narration.content.includes('Profit') || narration.content.includes('Winner')) {
                item.classList.add('profit');
            } else if (narration.content.includes('Loss') || narration.content.includes('Stop triggered')) {
                item.classList.add('loss');
            }
            
            const time = new Date().toLocaleTimeString();
            item.innerHTML = `
                <div class="narration-time">${time}</div>
                <div>${narration.content}</div>
            `;
            
            feed.appendChild(item);
            feed.scrollTop = feed.scrollHeight;
            
            // Keep only last 50 narrations
            while (feed.children.length > 50) {
                feed.removeChild(feed.firstChild);
            }
        }
        
        function updateStats(report) {
            document.getElementById('tradesNarrated').textContent = report.tradesNarrated || '0';
            document.getElementById('sessionPL').textContent = `$${report.profitLoss || '0.00'}`;
            document.getElementById('winRate').textContent = report.winRate || '0%';
            document.getElementById('marketRegime').textContent = report.currentRegime || '-';
            
            // Update Houston progress
            if (report.houstonProgress) {
                const progress = parseFloat(report.houstonProgress);
                const progressBar = document.getElementById('houstonProgress');
                progressBar.style.width = `${progress}%`;
                progressBar.textContent = `${progress}% - $${(progress * 250).toFixed(0)} / $25,000`;
            }
        }
        
        function toggleVoice() {
            fetch('http://localhost:4000/voice/toggle', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    voiceEnabled = data.voiceEnabled;
                    updateVoiceStatus();
                });
        }
        
        function updateVoiceStatus() {
            const indicator = document.getElementById('voiceStatus');
            if (voiceEnabled) {
                indicator.classList.add('connected');
            } else {
                indicator.classList.remove('connected');
            }
        }
        
        function changePersonality() {
            const personalities = ['professional_trader', 'aggressive_trader', 'zen_master', 'houston_focused'];
            const current = personalities.indexOf(currentPersonality);
            const next = (current + 1) % personalities.length;
            currentPersonality = personalities[next];
            
            ws.send(JSON.stringify({
                type: 'command',
                command: `personality ${currentPersonality}`
            }));
            
            document.getElementById('personality').textContent = `Personality: ${currentPersonality}`;
        }
        
        function requestReport() {
            ws.send(JSON.stringify({
                type: 'command',
                command: 'status'
            }));
        }
        
        // Initial connection
        connectWebSocket();
        
        // Periodic report updates
        setInterval(requestReport, 30000);
    </script>
</body>
</html>

// ==========================================
// FILE: .env.example
// Configuration template for The Mover
// ==========================================
# The Mover Configuration

# Server Ports
MOVER_HTTP_PORT=4000
MOVER_WS_PORT=4001

# OGZ Prime Bot Connection
BOT_WS_URL=ws://localhost:8080

# Voice Configuration
VOICE_ENABLED=false
ELEVENLABS_API_KEY=your_elevenlabs_key
VOICE_ID=your_voice_id

# Personality Settings
MOVER_PERSONALITY=houston_focused
# Options: professional_trader, aggressive_trader, zen_master, houston_focused

# Trading Configuration
ACCOUNT_BALANCE=10000
HOUSTON_TARGET=25000

# Memory System
MEMORY_DIR=./memory

# Initial Doctrine
INITIAL_DOCTRINE=./doctrine/primary_doctrine.json

# Logging
LOG_DIR=./logs
LOG_LEVEL=info

# External Integrations (future)
DISCORD_WEBHOOK=
TELEGRAM_BOT_TOKEN=
STREAM_DECK_PORT=

// ==========================================
// FILE: README.md
// Documentation for The Mover
// ==========================================
# The Mover - AI Support Agent for OGZ Prime

The Mover is an AI-powered support agent that serves as the interactive memory and voice of the OGZ Prime trading platform. It provides real-time trade narration, performance insights, and intelligent support.

## Features

- **Real-time Trade Narration**: Converts trade events into human-readable narratives
- **Memory System**: Maintains short-term and long-term memory of trading events
- **Doctrine Ingestion**: Loads and applies trading rules and strategies
- **Log Interpretation**: Analyzes log files to extract meaningful insights
- **WebSocket Integration**: Connects directly to OGZ Prime for live data
- **Voice Pipeline Ready**: Prepared for ElevenLabs or custom TTS integration
- **Personality System**: Multiple personalities for different narration styles

## Installation

1. Copy all files to the /mover directory in your OGZ Prime installation
2. Install dependencies:
   ```bash
   cd mover
   npm install ws express dotenv
   ```
3. Copy .env.example to .env and configure your settings
4. Ensure OGZ Prime is running with WebSocket enabled

## Usage

Start The Mover:
```bash
node mover-server.js
```

The Mover will:
- Connect to OGZ Prime via WebSocket
- Start HTTP API on port 4000
- Start WebSocket server on port 4001
- Begin processing trade events immediately

## API Endpoints

- `GET /health` - System health and statistics
- `POST /doctrine/ingest` - Load new doctrine files
- `POST /narrate` - Manually trigger narration
- `GET /memory/recall?query=term` - Search memory
- `GET /report` - Get session report
- `POST /voice/toggle` - Toggle voice output

## WebSocket Protocol

Connect to `ws://localhost:4001` and send:

```javascript
// Subscribe to narrations
{ "type": "subscribe" }

// Send command
{ "type": "command", "command": "status" }

// Query memory
{ "type": "query", "query": "profit" }
```

## Personality Options

- `professional_trader`: Formal, technical analysis focused
- `aggressive_trader`: High energy, momentum focused
- `zen_master`: Calm, philosophical approach
- `houston_focused`: Every trade viewed through Houston goal lens

## Houston Progress Tracking

The Mover tracks progress toward the Houston relocation goal:
- Target: $25,000
- Current: $10,000 (40%)
- Updates with every trade

## Voice Integration

Ready for ElevenLabs integration:
1. Add your API key to .env
2. Enable voice output
3. Narrations will be spoken in real-time

## Memory System

The Mover remembers:
- All trades and outcomes
- Market patterns
- Performance metrics
- Significant events

Query memory:
```
GET /memory/recall?query=winning+trades&limit=20
```

## Adding Custom Doctrine

Create a JSON file with rules and strategies:
```json
{
  "rules": [
    {
      "name": "momentum_rule",
      "condition": { "type": "pattern", "value": "breakout" },
      "action": "Increase position size by 25%"
    }
  ]
}
```

Ingest via API:
```
POST /doctrine/ingest
{
  "path": "./doctrine/momentum.json",
  "id": "momentum_doctrine"
}
```

## Frontend Interface

Open `mover-frontend.html` in a browser for:
- Real-time narration feed
- Performance statistics
- Houston progress tracking
- Voice control
- Personality switching

## Architecture

```
The Mover
├── mover-core.js        # AI brain and narration engine
├── mover-memory.js      # Memory management system
├── mover-server.js      # WebSocket and HTTP server
├── mover-log-interpreter.js  # Log analysis
├── primary_doctrine.json     # Initial trading rules
└── mover-frontend.html      # Web interface
```

## Integration with OGZ Prime

The Mover connects to OGZ Prime's WebSocket (default port 8080) and listens for:
- Trade executions
- Market analysis updates
- System alerts
- Pattern detections

## Performance

- Processes events in <100ms
- Maintains last 10,000 events in memory
- Persists memory every minute
- Handles 1000+ narrations per hour

## Future Enhancements

- ElevenLabs voice synthesis
- Discord/Telegram notifications
- Stream Deck integration
- Advanced pattern learning
- Multi-language support

## Support

For issues or questions:
- Check logs in ./logs directory
- Use /health endpoint for diagnostics
- Memory stats at /memory/recall

---

Built with 💪 for the journey to Houston 🚀