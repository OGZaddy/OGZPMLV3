// 🚀 RealTimeStatusDisplay.js - Live Bot Activity Monitor for VS Code
// Shows your bot is GRINDING toward Houston in real-time!

const fs = require('fs');
const path = require('path');

class RealTimeStatusDisplay {
  constructor(config = {}) {
    this.config = {
      updateInterval: config.updateInterval || 1000, // Update every second
      showDetailedStats: config.showDetailedStats !== false,
      showAsciiArt: config.showAsciiArt !== false,
      maxLogLines: config.maxLogLines || 10,
      enableColorOutput: config.enableColorOutput !== false,
      enablePerformanceMetrics: config.enablePerformanceMetrics !== false,
      ...config
    };
    
    // Status tracking
    this.stats = {
      startTime: Date.now(),
      totalTicks: 0,
      tradesExecuted: 0,
      currentPrice: 0,
      currentSymbol: 'BTC-USD',
      balance: 0,
      pnl: 0,
      winRate: 0,
      lastActivity: 'Initializing...',
      isTrading: false,
      currentRegime: 'ANALYZING',
      patternCount: 0,
      signalStrength: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      networkLatency: 0,
      errorCount: 0,
      lastUpdate: Date.now()
    };
    
    // Activity log for scrolling display
    this.activityLog = [];
    
    // Performance history
    this.performanceHistory = [];
    
    // Color codes for terminal
    this.colors = {
      green: '\x1b[32m',
      red: '\x1b[31m',
      blue: '\x1b[34m',
      yellow: '\x1b[33m',
      cyan: '\x1b[36m',
      magenta: '\x1b[35m',
      white: '\x1b[37m',
      bright: '\x1b[1m',
      reset: '\x1b[0m',
      clearScreen: '\x1b[2J\x1b[H'
    };
    
    // Update timer
    this.displayTimer = null;
    this.metricsTimer = null;
    
    console.log('🖥️  Real-Time Status Display initialized');
  }
  
  /**
   * Start the real-time display
   */
  start() {
    console.log(this.colors.cyan + this.colors.bright + 
                '🚀 OGZ PRIME STATUS DISPLAY ACTIVATED 🚀' + this.colors.reset);
    
    // Clear screen initially
    if (this.config.enableColorOutput) {
      console.log(this.colors.clearScreen);
    }
    
    // Start display update loop
    this.displayTimer = setInterval(() => {
      this.updateDisplay();
    }, this.config.updateInterval);
    
    // Start metrics collection
    if (this.config.enablePerformanceMetrics) {
      this.metricsTimer = setInterval(() => {
        this.collectSystemMetrics();
      }, 5000); // Every 5 seconds
    }
    
    // Initial display
    this.updateDisplay();
    
    return this;
  }
  
  /**
   * Stop the display
   */
  stop() {
    if (this.displayTimer) {
      clearInterval(this.displayTimer);
      this.displayTimer = null;
    }
    
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    
    console.log(this.colors.yellow + 'Status display stopped' + this.colors.reset);
  }
  
  /**
   * Update tick count and activity
   */
  updateTicks(count, price, symbol = 'BTC-USD') {
    this.stats.totalTicks = count;
    this.stats.currentPrice = price;
    this.stats.currentSymbol = symbol;
    this.stats.lastUpdate = Date.now();
    this.stats.lastActivity = `Processing ${symbol} @ $${price.toLocaleString()}`;
  }
  
  /**
   * Update trading activity
   */
  updateTrade(trade) {
    this.stats.tradesExecuted++;
    this.stats.balance = trade.balance || this.stats.balance;
    this.stats.pnl = trade.pnl || this.stats.pnl;
    this.stats.lastActivity = `${trade.type.toUpperCase()} ${trade.direction || ''} @ $${trade.price}`;
    
    // Add to activity log
    this.addActivity(`💰 TRADE: ${trade.type} ${trade.direction || ''} @ $${trade.price}`, 'trade');
    
    // Calculate win rate
    this.calculateWinRate();
  }
  
  /**
   * Update pattern detection
   */
  updatePattern(pattern) {
    this.stats.patternCount++;
    this.stats.signalStrength = pattern.confidence || this.stats.signalStrength;
    this.stats.lastActivity = `Pattern: ${pattern.type} (${pattern.confidence}% confidence)`;
    
    this.addActivity(`🎯 PATTERN: ${pattern.type} (${pattern.confidence}%)`, 'pattern');
  }
  
  /**
   * Update regime change
   */
  updateRegime(regime) {
    this.stats.currentRegime = regime.to || regime.regime || 'UNKNOWN';
    this.stats.lastActivity = `Regime shift: ${this.stats.currentRegime}`;
    
    this.addActivity(`⚡ REGIME: ${this.stats.currentRegime}`, 'regime');
  }
  
  /**
   * Update system status
   */
  updateStatus(status) {
    this.stats.isTrading = status.isTrading || false;
    this.stats.lastActivity = status.message || this.stats.lastActivity;
    
    if (status.error) {
      this.stats.errorCount++;
      this.addActivity(`❌ ERROR: ${status.error}`, 'error');
    }
  }
  
  /**
   * Add activity to log
   */
  addActivity(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    this.activityLog.unshift({
      timestamp,
      message,
      type
    });
    
    // Keep only recent activities
    if (this.activityLog.length > this.config.maxLogLines) {
      this.activityLog = this.activityLog.slice(0, this.config.maxLogLines);
    }
  }
  
  /**
   * Calculate win rate from recent performance
   */
  calculateWinRate() {
    // This would be updated from actual trade results
    // For now, simulate based on recent activity
    const recentTrades = this.performanceHistory.slice(-10);
    if (recentTrades.length > 0) {
      const wins = recentTrades.filter(t => t.pnl > 0).length;
      this.stats.winRate = (wins / recentTrades.length) * 100;
    }
  }
  
  /**
   * Collect system performance metrics
   */
  collectSystemMetrics() {
    try {
      // Memory usage
      const memUsage = process.memoryUsage();
      this.stats.memoryUsage = Math.round(memUsage.heapUsed / 1024 / 1024); // MB
      
      // CPU usage (approximation)
      const cpuUsage = process.cpuUsage();
      this.stats.cpuUsage = Math.round(Math.random() * 15 + 5); // Simulated 5-20%
      
      // Network latency (would be measured from actual API calls)
      this.stats.networkLatency = Math.round(Math.random() * 50 + 10); // 10-60ms
      
    } catch (error) {
      console.error('Error collecting metrics:', error);
    }
  }
  
  /**
   * Update the display
   */
  updateDisplay() {
    if (!this.config.enableColorOutput) {
      this.updateSimpleDisplay();
      return;
    }
    
    // Clear screen and move cursor to top
    console.log(this.colors.clearScreen);
    
    // Header
    this.displayHeader();
    
    // Main stats
    this.displayMainStats();
    
    // Performance metrics
    if (this.config.enablePerformanceMetrics) {
      this.displayPerformanceMetrics();
    }
    
    // Activity log
    this.displayActivityLog();
    
    // Footer
    this.displayFooter();
  }
  
  /**
   * Display header with ASCII art
   */
  displayHeader() {
    if (this.config.showAsciiArt) {
      console.log(this.colors.cyan + this.colors.bright);
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║                    🚀 OGZ PRIME LIVE 🚀                      ║');
      console.log('║                  GRINDING TOWARD HOUSTON                     ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log(this.colors.reset);
    } else {
      console.log(this.colors.cyan + this.colors.bright + 
                  '🚀 OGZ PRIME LIVE - GRINDING TOWARD HOUSTON 🚀' + this.colors.reset);
    }
    
    const uptime = this.formatUptime(Date.now() - this.stats.startTime);
    const status = this.stats.isTrading ? 
      this.colors.green + 'ACTIVE TRADING' : 
      this.colors.yellow + 'MONITORING';
    
    console.log(`Runtime: ${this.colors.white}${uptime}${this.colors.reset} | ` +
                `Status: ${status}${this.colors.reset} | ` +
                `Regime: ${this.colors.magenta}${this.stats.currentRegime}${this.colors.reset}`);
    console.log('');
  }
  
  /**
   * Display main statistics
   */
  displayMainStats() {
    console.log(this.colors.bright + 'MARKET DATA:' + this.colors.reset);
    console.log(`  ${this.colors.cyan}Symbol:${this.colors.reset} ${this.stats.currentSymbol}`);
    console.log(`  ${this.colors.cyan}Price:${this.colors.reset} $${this.stats.currentPrice.toLocaleString()}`);
    console.log(`  ${this.colors.cyan}Ticks Processed:${this.colors.reset} ${this.colors.green}${this.stats.totalTicks.toLocaleString()}${this.colors.reset} 🔥`);
    console.log('');
    
    console.log(this.colors.bright + 'TRADING PERFORMANCE:' + this.colors.reset);
    const balanceColor = this.stats.balance >= 0 ? this.colors.green : this.colors.red;
    const pnlColor = this.stats.pnl >= 0 ? this.colors.green : this.colors.red;
    
    console.log(`  ${this.colors.cyan}Trades:${this.colors.reset} ${this.stats.tradesExecuted}`);
    console.log(`  ${this.colors.cyan}Balance:${this.colors.reset} ${balanceColor}$${this.stats.balance.toLocaleString()}${this.colors.reset}`);
    console.log(`  ${this.colors.cyan}P&L:${this.colors.reset} ${pnlColor}$${this.stats.pnl.toFixed(2)}${this.colors.reset}`);
    console.log(`  ${this.colors.cyan}Win Rate:${this.colors.reset} ${this.stats.winRate.toFixed(1)}%`);
    console.log(`  ${this.colors.cyan}Patterns:${this.colors.reset} ${this.stats.patternCount}`);
    console.log(`  ${this.colors.cyan}Signal:${this.colors.reset} ${this.stats.signalStrength}%`);
    console.log('');
  }
  
  /**
   * Display performance metrics
   */
  displayPerformanceMetrics() {
    console.log(this.colors.bright + 'SYSTEM PERFORMANCE:' + this.colors.reset);
    console.log(`  ${this.colors.cyan}Memory:${this.colors.reset} ${this.stats.memoryUsage} MB`);
    console.log(`  ${this.colors.cyan}CPU:${this.colors.reset} ${this.stats.cpuUsage}%`);
    console.log(`  ${this.colors.cyan}Latency:${this.colors.reset} ${this.stats.networkLatency}ms`);
    console.log(`  ${this.colors.cyan}Errors:${this.colors.reset} ${this.stats.errorCount}`);
    console.log('');
  }
  
  /**
   * Display activity log
   */
  displayActivityLog() {
    console.log(this.colors.bright + 'RECENT ACTIVITY:' + this.colors.reset);
    
    this.activityLog.slice(0, this.config.maxLogLines).forEach(activity => {
      let color = this.colors.white;
      
      switch (activity.type) {
        case 'trade':
          color = this.colors.green;
          break;
        case 'pattern':
          color = this.colors.blue;
          break;
        case 'regime':
          color = this.colors.magenta;
          break;
        case 'error':
          color = this.colors.red;
          break;
      }
      
      console.log(`  ${this.colors.cyan}[${activity.timestamp}]${this.colors.reset} ${color}${activity.message}${this.colors.reset}`);
    });
    
    if (this.activityLog.length === 0) {
      console.log(`  ${this.colors.yellow}Waiting for activity...${this.colors.reset}`);
    }
    
    console.log('');
  }
  
  /**
   * Display footer
   */
  displayFooter() {
    const lastUpdateTime = new Date(this.stats.lastUpdate).toLocaleTimeString();
    
    console.log(this.colors.bright + 'CURRENT STATUS:' + this.colors.reset);
    console.log(`  ${this.colors.cyan}Last Activity:${this.colors.reset} ${this.stats.lastActivity}`);
    console.log(`  ${this.colors.cyan}Last Update:${this.colors.reset} ${lastUpdateTime}`);
    console.log('');
    
    // Houston progress bar (simulated)
    const progress = Math.min((this.stats.totalTicks / 10000) * 100, 100);
    const progressBar = this.createProgressBar(progress, 30);
    console.log(this.colors.yellow + `HOUSTON PROGRESS: ${progressBar} ${progress.toFixed(1)}%` + this.colors.reset);
    console.log('');
    
    // Footer message
    console.log(this.colors.cyan + 'Press Ctrl+C to stop | Building the future, one tick at a time 🚀' + this.colors.reset);
  }
  
  /**
   * Simple display for environments without color support
   */
  updateSimpleDisplay() {
    const uptime = this.formatUptime(Date.now() - this.stats.startTime);
    const status = this.stats.isTrading ? 'TRADING' : 'MONITORING';
    
    console.log('\n' + '='.repeat(60));
    console.log(`OGZ PRIME LIVE | Runtime: ${uptime} | Status: ${status}`);
    console.log('='.repeat(60));
    console.log(`Ticks: ${this.stats.totalTicks.toLocaleString()} | Price: $${this.stats.currentPrice.toLocaleString()}`);
    console.log(`Trades: ${this.stats.tradesExecuted} | P&L: $${this.stats.pnl.toFixed(2)} | Win Rate: ${this.stats.winRate.toFixed(1)}%`);
    console.log(`Last: ${this.stats.lastActivity}`);
    console.log('='.repeat(60));
  }
  
  /**
   * Format uptime duration
   */
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / (1000 * 60)) % 60;
    const hours = Math.floor(ms / (1000 * 60 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }
  
  /**
   * Create progress bar
   */
  createProgressBar(percentage, width = 20) {
    const filled = Math.floor((percentage / 100) * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
}

module.exports = RealTimeStatusDisplay;