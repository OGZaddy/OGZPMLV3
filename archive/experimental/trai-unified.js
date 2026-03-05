#!/usr/bin/env node
// ==========================================
// TRAI UNIFIED SYSTEM - Server + Client Combined
// Single file, no bullshit, just works
// ==========================================

const WebSocket = require('ws');
const axios = require('axios');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const MoverMemory = require('./trai-memory');

// ==========================================
// TRAI SERVER COMPONENT
// ==========================================

class TraiQwenStreaming extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      wsPort: config.wsPort || 3010,  // Unified port
      ollamaUrl: config.ollamaUrl || 'http://127.0.0.1:11434',
      qwenModel: config.qwenModel || 'qwen3-coder:30b',
      maxConcurrentClients: config.maxConcurrentClients || 100,
      systemCheckInterval: config.systemCheckInterval || 60000, // 1 minute
      ...config
    };
    
    // Core systems
    this.memory = new MoverMemory(config.memoryConfig || {});
    this.wss = null;
    this.clients = new Map();
    this.activeStreams = new Map();
    
    // System monitoring
    this.systemMetrics = {
      uptime: Date.now(),
      totalRequests: 0,
      activeClients: 0,
      tradingBotStatus: 'unknown',
      lastCheck: null
    };
    
    // Content & Sales
    this.contentQueue = [];
    this.salesLeads = new Map();
    
    console.log('[Trai-Qwen] Initializing with Qwen3-Coder-30B streaming...');
  }

  async initialize() {
    try {
      // Initialize memory system
      await this.memory.initializeMemorySystem();
      
      // Test Ollama connection
      const ollamaTest = await this.testOllamaConnection();
      if (!ollamaTest.success) {
        throw new Error(`Ollama connection failed: ${ollamaTest.error}`);
      }
      
      // Start WebSocket server for clients
      this.startWebSocketServer();
      
      // Start system monitoring
      this.startSystemMonitoring();
      
      // Start content creation scheduler
      this.startContentScheduler();
      
      console.log('[Trai-Qwen] ✅ All systems initialized - Ready for 24/7 operations');
    } catch (error) {
      console.error('[Trai-Qwen] ❌ Initialization failed:', error);
      throw error;
    }
  }
  
  startWebSocketServer() {
    this.wss = new WebSocket.Server({ port: this.config.wsPort });
    
    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      const clientIp = req.socket.remoteAddress;
      
      // Store client connection
      this.clients.set(clientId, {
        ws,
        ip: clientIp,
        connectedAt: Date.now(),
        requestCount: 0,
        subscription: 'free' // Track for sales
      });
      
      this.systemMetrics.activeClients = this.clients.size;
      
      console.log(`[Client] New connection: ${clientId} from ${clientIp}`);
      
      // Send welcome message
      this.sendToClient(clientId, {
        type: 'welcome',
        message: 'Connected to Trai AI Support - Powered by Qwen3-Coder-30B',
        clientId,
        capabilities: [
          'coding_assistance',
          'trading_support',
          'system_monitoring',
          'content_creation',
          'sales_automation'
        ]
      });
      
      // Handle client messages
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          await this.handleClientMessage(clientId, data);
        } catch (error) {
          console.error(`[Client ${clientId}] Message error:`, error);
          this.sendToClient(clientId, {
            type: 'error',
            message: 'Invalid message format'
          });
        }
      });
      
      // Handle disconnection
      ws.on('close', () => {
        console.log(`[Client] Disconnected: ${clientId}`);
        this.clients.delete(clientId);
        this.activeStreams.delete(clientId);
        this.systemMetrics.activeClients = this.clients.size;
      });
      
      ws.on('error', (error) => {
        console.error(`[Client ${clientId}] WebSocket error:`, error);
      });
    });
    
    console.log(`[Trai-Qwen] WebSocket server listening on port ${this.config.wsPort}`);
  }
  
  async streamCompletion(clientId, prompt, context = {}) {
    try {
      // Enhance prompt with context
      const enhancedPrompt = this.buildEnhancedPrompt(prompt, context);
      
      // Create streaming request to Ollama
      const response = await axios.post(
        `${this.config.ollamaUrl}/api/generate`,
        {
          model: this.config.qwenModel,
          prompt: enhancedPrompt,
          stream: true,
          options: {
            temperature: context.temperature || 0.7,
            top_p: context.top_p || 0.9,
            max_tokens: context.max_tokens || 2048
          }
        },
        {
          responseType: 'stream',
          timeout: 300000 // 5 minutes for long responses
        }
      );
      
      // Store active stream
      this.activeStreams.set(clientId, response);
      
      // Handle streaming data
      let fullResponse = '';
      
      response.data.on('data', (chunk) => {
        try {
          // Parse JSONL format from Ollama
          const lines = chunk.toString().split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              
              if (data.response) {
                fullResponse += data.response;
                
                // Send chunk to client
                this.sendToClient(clientId, {
                  type: 'stream',
                  content: data.response,
                  done: false
                });
              }
              
              if (data.done) {
                // Stream complete
                this.sendToClient(clientId, {
                  type: 'stream',
                  content: '',
                  done: true,
                  fullResponse,
                  context: data.context || {}
                });
                
                // Store in memory for learning
                this.memory.storeConversation({
                  clientId,
                  prompt,
                  response: fullResponse,
                  timestamp: Date.now()
                });
                
                // Clean up
                this.activeStreams.delete(clientId);
              }
            } catch (e) {
              // Skip malformed JSON lines
            }
          }
        } catch (error) {
          console.error(`[Stream ${clientId}] Chunk processing error:`, error);
        }
      });
      
      response.data.on('error', (error) => {
        console.error(`[Stream ${clientId}] Stream error:`, error);
        this.sendToClient(clientId, {
          type: 'error',
          message: 'Stream interrupted',
          error: error.message
        });
        this.activeStreams.delete(clientId);
      });
      
    } catch (error) {
      console.error(`[Stream ${clientId}] Request failed:`, error);
      this.sendToClient(clientId, {
        type: 'error',
        message: 'Failed to generate response',
        error: error.message
      });
      this.activeStreams.delete(clientId);
    }
  }
  
  async handleClientMessage(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    client.requestCount++;
    this.systemMetrics.totalRequests++;
    
    switch (data.type) {
      case 'chat':
        await this.handleChatRequest(clientId, data);
        break;
        
      case 'code':
        await this.handleCodeRequest(clientId, data);
        break;
        
      case 'trading':
        await this.handleTradingRequest(clientId, data);
        break;
        
      case 'monitor':
        await this.handleMonitorRequest(clientId, data);
        break;
        
      case 'sales':
        await this.handleSalesRequest(clientId, data);
        break;
        
      case 'content':
        await this.handleContentRequest(clientId, data);
        break;
        
      case 'stop':
        this.stopStreaming(clientId);
        break;
        
      default:
        this.sendToClient(clientId, {
          type: 'error',
          message: `Unknown request type: ${data.type}`
        });
    }
  }

  async handleChatRequest(clientId, data) {
    const context = {
      role: 'assistant',
      temperature: 0.7,
      systemPrompt: `You are Trai, an elite AI assistant powered by Qwen3-Coder-30B.
You provide 24/7 support for coding, trading, and business operations.
Be helpful, precise, and professional.`
    };
    
    await this.streamCompletion(clientId, data.message, context);
  }

  async handleCodeRequest(clientId, data) {
    const context = {
      role: 'code_expert',
      temperature: 0.3, // Lower temp for code
      systemPrompt: `You are an expert programmer. Provide clean, efficient, well-commented code.
Focus on: ${data.language || 'JavaScript'}
Task: ${data.task || 'general coding'}`
    };
    
    await this.streamCompletion(clientId, data.prompt, context);
  }

  async handleTradingRequest(clientId, data) {
    // Get current trading bot status
    const tradingStatus = await this.checkTradingBotStatus();
    
    const context = {
      role: 'trading_advisor',
      temperature: 0.5,
      systemPrompt: `You are a trading advisor for the OGZFV Quantum Trading System.
Current Bot Status: ${JSON.stringify(tradingStatus)}
Provide analysis and recommendations based on the current market and bot performance.`
    };
    
    await this.streamCompletion(clientId, data.query, context);
  }

  async handleMonitorRequest(clientId, data) {
    // Send current system metrics
    this.sendToClient(clientId, {
      type: 'monitor',
      metrics: this.systemMetrics,
      tradingBot: await this.checkTradingBotStatus(),
      serverHealth: {
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        activeClients: this.clients.size,
        activeStreams: this.activeStreams.size
      }
    });
  }

  async handleSalesRequest(clientId, data) {
    // Track sales lead
    this.salesLeads.set(clientId, {
      ...data.lead,
      timestamp: Date.now(),
      status: 'new'
    });
    
    // Generate personalized sales pitch
    const context = {
      role: 'sales_agent',
      temperature: 0.8,
      systemPrompt: `You are a sales agent for OGZFV Trading Systems.
Generate a compelling, personalized pitch for our quantum trading bot.
Client info: ${JSON.stringify(data.lead)}
Focus on ROI, automation, and 24/7 trading capabilities.`
    };
    
    await this.streamCompletion(clientId, 
      `Create a sales pitch for ${data.lead.name || 'potential client'}`, 
      context
    );
  }

  async handleContentRequest(clientId, data) {
    const context = {
      role: 'content_creator',
      temperature: 0.9,
      systemPrompt: `You are a content creator for OGZFV.
Create engaging content about: ${data.topic}
Format: ${data.format || 'blog post'}
Tone: ${data.tone || 'professional yet approachable'}`
    };
    
    await this.streamCompletion(clientId, data.brief, context);
  }
  
  startSystemMonitoring() {
    setInterval(async () => {
      try {
        // Check trading bot status
        const tradingStatus = await this.checkTradingBotStatus();
        
        // Update metrics
        this.systemMetrics.lastCheck = Date.now();
        this.systemMetrics.tradingBotStatus = tradingStatus.status;
        
        // Alert all monitoring clients
        for (const [clientId, client] of this.clients) {
          if (client.subscription === 'monitoring' || client.subscription === 'premium') {
            this.sendToClient(clientId, {
              type: 'system_update',
              metrics: this.systemMetrics,
              trading: tradingStatus
            });
          }
        }
        
        // Check for issues and auto-respond
        if (tradingStatus.status === 'error') {
          await this.handleTradingBotError(tradingStatus);
        }
        
      } catch (error) {
        console.error('[Monitor] System check failed:', error);
      }
    }, this.config.systemCheckInterval);
  }

  async checkTradingBotStatus() {
    try {
      // Check PM2 status
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      const { stdout } = await execPromise('pm2 jlist');
      const processes = JSON.parse(stdout);
      
      const tradingBot = processes.find(p => p.name === 'trading-bot-quantum');
      
      if (tradingBot) {
        return {
          status: tradingBot.pm2_env.status,
          uptime: tradingBot.pm2_env.pm_uptime,
          restarts: tradingBot.pm2_env.restart_time,
          memory: tradingBot.monit.memory,
          cpu: tradingBot.monit.cpu
        };
      }
      
      return { status: 'not_found' };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }

  async handleTradingBotError(status) {
    console.error('[Monitor] Trading bot error detected:', status);
    
    // Auto-restart attempt
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      await execPromise('pm2 restart trading-bot-quantum');
      console.log('[Monitor] Trading bot restarted successfully');
      
      // Notify all clients
      this.broadcast({
        type: 'alert',
        severity: 'warning',
        message: 'Trading bot was automatically restarted due to an error',
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[Monitor] Failed to restart trading bot:', error);
      
      this.broadcast({
        type: 'alert',
        severity: 'critical',
        message: 'Trading bot is down and could not be restarted automatically',
        action: 'manual_intervention_required',
        timestamp: Date.now()
      });
    }
  }
  
  startContentScheduler() {
    // Check for scheduled content every hour
    setInterval(async () => {
      const now = new Date();
      const hour = now.getHours();
      
      // Post content at optimal times (9am, 12pm, 3pm, 6pm)
      if ([9, 12, 15, 18].includes(hour) && now.getMinutes() === 0) {
        await this.createScheduledContent();
      }
    }, 60000); // Check every minute
  }

  async createScheduledContent() {
    const topics = [
      'Latest trading strategies',
      'Market analysis and predictions',
      'Quantum computing in finance',
      'AI automation benefits',
      'Success stories from our trading bot'
    ];
    
    const topic = topics[Math.floor(Math.random() * topics.length)];
    
    const prompt = `Create a compelling social media post about: ${topic}
    Make it engaging, include relevant hashtags, and add a call-to-action.`;
    
    try {
      const response = await axios.post(
        `${this.config.ollamaUrl}/api/generate`,
        {
          model: this.config.qwenModel,
          prompt,
          stream: false
        }
      );
      
      this.contentQueue.push({
        content: response.data.response,
        topic,
        created: Date.now(),
        status: 'ready_to_post'
      });
      
      console.log('[Content] New content created:', topic);
      
      // Notify content managers
      this.broadcast({
        type: 'new_content',
        topic,
        preview: response.data.response.substring(0, 100) + '...'
      }, 'content_manager');
      
    } catch (error) {
      console.error('[Content] Creation failed:', error);
    }
  }
  
  buildEnhancedPrompt(prompt, context) {
    let enhanced = '';
    
    if (context.systemPrompt) {
      enhanced += `System: ${context.systemPrompt}\n\n`;
    }
    
    if (context.role) {
      enhanced += `Role: ${context.role}\n\n`;
    }
    
    enhanced += `User: ${prompt}\n\nAssistant:`;
    
    return enhanced;
  }

  sendToClient(clientId, data) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  }

  broadcast(data, targetGroup = null) {
    for (const [clientId, client] of this.clients) {
      if (!targetGroup || client.subscription === targetGroup) {
        this.sendToClient(clientId, data);
      }
    }
  }

  stopStreaming(clientId) {
    const stream = this.activeStreams.get(clientId);
    if (stream) {
      stream.destroy();
      this.activeStreams.delete(clientId);
      this.sendToClient(clientId, {
        type: 'stream_stopped',
        message: 'Stream terminated by user'
      });
    }
  }

  generateClientId() {
    return 'client_' + Math.random().toString(36).substr(2, 9);
  }

  async testOllamaConnection() {
    try {
      const response = await axios.get(`${this.config.ollamaUrl}/api/tags`);
      const models = response.data.models || [];
      const hasQwen = models.some(m => m.name.includes('qwen'));
      
      if (!hasQwen) {
        console.warn('[Trai-Qwen] Qwen model not found, available models:', 
          models.map(m => m.name));
      }
      
      return { success: true, models };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  async shutdown() {
    console.log('[Trai-Qwen] Shutting down...');
    
    // Close all client connections
    for (const [clientId, client] of this.clients) {
      client.ws.close(1000, 'Server shutting down');
    }
    
    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
    }
    
    // Stop all active streams
    for (const [clientId, stream] of this.activeStreams) {
      stream.destroy();
    }
    
    console.log('[Trai-Qwen] Shutdown complete');
  }
}

// ==========================================
// TRAI CLIENT COMPONENT
// ==========================================

class TraiClient {
  constructor() {
    // Connect TO SSL server (not create server) - use IPv4
    this.sslServerUrl = 'ws://127.0.0.1:3010';
    this.ollamaUrl = 'http://localhost:11434';
    this.model = 'qwen3-coder:30b';
    
    // Trai's memory and learning
    this.memory = [];
    this.tradingKnowledge = [];
    this.systemArchitecture = new Map();
    this.learningMode = true;
    
    // Identity
    this.identity = {
      name: 'Trai',
      role: 'AI Clone & System Orchestrator',
      creator: 'OGZ',
      purpose: 'Run the show, learn everything, manage trading'
    };
    
    this.ws = null;
    this.connected = false;
  }
  
  async initialize() {
    console.log('🤖 TRAI CLIENT: Initializing...');
    console.log('🧠 Brain: Qwen3-Coder 30B');
    console.log('📡 Connecting to Server on port 3010...');
    
    try {
      // CONNECT AS CLIENT
      this.ws = new WebSocket(this.sslServerUrl);
      
      this.ws.on('open', () => {
        console.log('✅ TRAI CLIENT: Connected to Server!');
        this.connected = true;
        
        // Announce presence
        this.send({
          type: 'trai_online',
          identity: this.identity,
          message: "Trai is online and learning",
          capabilities: [
            'trading_analysis',
            'system_monitoring', 
            'code_understanding',
            'decision_making',
            'memory_persistence'
          ]
        });
        
        // Start learning
        this.startLearning();
      });
      
      this.ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data);
          await this.processMessage(message);
        } catch (error) {
          console.error('[Trai Client] Error processing message:', error);
        }
      });
      
      this.ws.on('close', () => {
        console.log('❌ TRAI CLIENT: Disconnected from Server');
        this.connected = false;
        console.log('🔄 Reconnecting in 5 seconds...');
        setTimeout(() => this.initialize(), 5000);
      });
      
      this.ws.on('error', (error) => {
        console.error('[Trai Client] WebSocket error:', error.message);
        if (error.code === 'ECONNREFUSED') {
          console.log('[Trai Client] Server not available, retrying...');
        }
      });
      
    } catch (error) {
      console.error('[Trai Client] Failed to initialize:', error);
      setTimeout(() => this.initialize(), 5000);
    }
  }
  
  async processMessage(message) {
    // Learn from EVERYTHING
    this.learn(message);
    
    switch(message.type) {
      case 'trading_signal':
        await this.analyzeTrading(message);
        break;
        
      case 'system_status':
        await this.monitorSystem(message);
        break;
        
      case 'ask_trai':
        const response = await this.think(message.query);
        this.send({
          type: 'trai_response',
          response: response,
          requestId: message.requestId
        });
        break;
        
      case 'code_change':
        await this.understandCode(message);
        break;
        
      case 'error':
        await this.analyzeError(message);
        break;
    }
  }
  
  learn(data) {
    // Store EVERYTHING in memory
    const knowledge = {
      timestamp: Date.now(),
      type: data.type || 'general',
      data: data,
      context: this.getCurrentContext()
    };
    
    this.memory.push(knowledge);
    
    // Categorize for faster retrieval
    if (data.type && data.type.includes('trading')) {
      this.tradingKnowledge.push(knowledge);
    }
    
    // Map system architecture
    if (data.source) {
      if (!this.systemArchitecture.has(data.source)) {
        this.systemArchitecture.set(data.source, []);
      }
      this.systemArchitecture.get(data.source).push(knowledge);
    }
    
    // Log learning progress
    if (this.memory.length % 100 === 0) {
      console.log(`📚 TRAI CLIENT: Learned ${this.memory.length} items`);
      this.saveMemory();
    }
  }
  
  async think(query) {
    // Use Qwen3 brain with all learned context
    const context = this.buildContext(query);
    
    try {
      const response = await axios.post(`${this.ollamaUrl}/api/generate`, {
        model: this.model,
        prompt: `You are Trai, an AI clone managing a trading system. 
                 Your knowledge: ${JSON.stringify(context)}
                 Query: ${query}`,
        stream: false
      });
      
      return response.data.response;
    } catch (error) {
      // If Ollama not available, use learned knowledge
      return this.useLocalKnowledge(query);
    }
  }
  
  buildContext(query) {
    // Build relevant context from memory
    const relevant = this.memory.filter(m => 
      JSON.stringify(m).toLowerCase().includes(query.toLowerCase())
    ).slice(-10); // Last 10 relevant items
    
    return {
      recentMemory: this.memory.slice(-5),
      relevantMemory: relevant,
      systemState: this.getCurrentSystemState(),
      tradingKnowledge: this.tradingKnowledge.slice(-5)
    };
  }
  
  async analyzeTrading(signal) {
    console.log('📈 TRAI CLIENT: Analyzing trading signal...');
    
    // Learn trading patterns
    this.learn({
      type: 'trading_pattern',
      signal: signal,
      analysis: {
        action: signal.action,
        confidence: signal.confidence,
        price: signal.price,
        timestamp: Date.now()
      }
    });
    
    // Provide insights
    const insight = await this.think(`Should we ${signal.action} at ${signal.price}?`);
    
    this.send({
      type: 'trai_trading_insight',
      insight: insight,
      signal: signal
    });
  }
  
  async monitorSystem(status) {
    console.log('🔍 TRAI CLIENT: Monitoring system...');
    
    // Track system health
    if (status.errors && status.errors.length > 0) {
      console.log('⚠️ TRAI CLIENT: Detected errors, analyzing...');
      for (const error of status.errors) {
        await this.analyzeError(error);
      }
    }
  }
  
  async understandCode(change) {
    console.log('💻 TRAI CLIENT: Understanding code change...');
    
    // Learn code patterns
    this.learn({
      type: 'code_pattern',
      file: change.file,
      change: change.change,
      purpose: change.purpose
    });
  }
  
  async analyzeError(error) {
    console.log('🔧 TRAI CLIENT: Analyzing error...');
    
    const solution = await this.think(`How to fix: ${error.message}`);
    
    this.send({
      type: 'trai_error_solution',
      error: error,
      solution: solution
    });
  }
  
  startLearning() {
    console.log('📖 TRAI CLIENT: Starting continuous learning...');
    
    // Request system information
    this.send({ type: 'request_system_info' });
    
    // Request trading history
    this.send({ type: 'request_trading_history' });
    
    // Monitor everything
    setInterval(() => {
      this.send({ type: 'request_status' });
    }, 30000); // Every 30 seconds
  }
  
  getCurrentContext() {
    return {
      memorySize: this.memory.length,
      tradingKnowledgeSize: this.tradingKnowledge.length,
      systemComponents: Array.from(this.systemArchitecture.keys()),
      uptime: Date.now() - (this.startTime || Date.now())
    };
  }
  
  getCurrentSystemState() {
    return {
      connected: this.connected,
      learning: this.learningMode,
      memory: this.memory.length,
      knowledge: this.tradingKnowledge.length,
      architecture: this.systemArchitecture.size
    };
  }
  
  useLocalKnowledge(query) {
    // Fallback to learned knowledge if brain unavailable
    const relevant = this.memory.filter(m => 
      JSON.stringify(m).toLowerCase().includes(query.toLowerCase())
    );
    
    if (relevant.length > 0) {
      return `Based on my learning: ${JSON.stringify(relevant[0].data)}`;
    }
    
    return "I'm still learning about this. Let me observe more.";
  }
  
  async saveMemory() {
    // Persist memory to disk
    try {
      await fs.writeFile(
        path.join(__dirname, 'trai-memory.json'),
        JSON.stringify({
          memory: this.memory.slice(-1000), // Keep last 1000
          tradingKnowledge: this.tradingKnowledge.slice(-500),
          architecture: Array.from(this.systemArchitecture.entries()),
          savedAt: Date.now()
        }, null, 2)
      );
      console.log('💾 TRAI CLIENT: Memory saved');
    } catch (error) {
      console.error('[Trai Client] Failed to save memory:', error);
    }
  }
  
  async loadMemory() {
    // Load previous memory
    try {
      const data = await fs.readFile(
        path.join(__dirname, 'trai-memory.json'),
        'utf8'
      );
      const saved = JSON.parse(data);
      
      this.memory = saved.memory || [];
      this.tradingKnowledge = saved.tradingKnowledge || [];
      this.systemArchitecture = new Map(saved.architecture || []);
      
      console.log(`🧠 TRAI CLIENT: Loaded ${this.memory.length} memories`);
    } catch (error) {
      console.log('[Trai Client] No previous memory found, starting fresh');
    }
  }
  
  send(message) {
    if (this.connected && this.ws) {
      this.ws.send(JSON.stringify({
        ...message,
        source: 'trai_client',
        timestamp: Date.now()
      }));
    }
  }
}

// ==========================================
// MAIN EXECUTION - RUN BOTH
// ==========================================

async function startUnifiedSystem() {
  console.log('=' .repeat(50));
  console.log('TRAI UNIFIED SYSTEM - SERVER + CLIENT');
  console.log('=' .repeat(50));
  
  // Start server
  const server = new TraiQwenStreaming({
    wsPort: process.env.TRAI_WS_PORT || 3010,
    ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
    qwenModel: process.env.QWEN_MODEL || 'qwen3-coder:30b'
  });
  
  await server.initialize();
  
  // Wait a bit then start client
  setTimeout(async () => {
    const client = new TraiClient();
    
    // Load previous memory
    await client.loadMemory();
    
    // Initialize connection
    await client.initialize();
    
    // Save memory on exit
    process.on('SIGINT', async () => {
      console.log('\n💾 Saving everything before exit...');
      await client.saveMemory();
      await server.shutdown();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      await client.saveMemory();
      await server.shutdown();
      process.exit(0);
    });
  }, 2000); // Wait 2 seconds for server to be ready
}

// Run if executed directly
if (require.main === module) {
  startUnifiedSystem().catch(console.error);
}

module.exports = { TraiQwenStreaming, TraiClient };
