/**
 * 🎯 PERFORMANCE DASHBOARD INTEGRATION
 * 
 * This module connects all the hidden performance tracking systems
 * to the live dashboard for real-time visibility and content creation
 */

const EventEmitter = require('events');
const path = require('path');

// Import all the hidden performance modules
const PerformanceVisualizer = require('./PerformanceVisualizer');
const PerformanceValidator = require('./PerformanceValidator');
// Phase 2 REWRITE: TradingProfileManager deleted - profiles now in TradingConfig
// CHANGE 2025-12-11: TradingSafetyNet commented out - module doesn't exist

class PerformanceDashboardIntegration extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      updateInterval: config.updateInterval || 5000, // 5 second updates
      enableVisualizations: config.enableVisualizations !== false,
      enableProfileTracking: config.enableProfileTracking !== false,
      enableSafetyTracking: false, // CHANGE 2025-12-11: Disabled - TradingSafetyNet doesn't exist
      ...config
    };
    
    // Initialize all performance modules
    this.visualizer = new PerformanceVisualizer({
      outputDir: path.join(process.cwd(), 'public', 'performance'),
      captureFrequency: 10, // Every 10 trades
      generateHtml: true
    });
    
    this.validator = new PerformanceValidator();

    // Phase 2 REWRITE: TradingProfileManager deleted - profiles now in TradingConfig
    this.profileManager = null;

    // CHANGE 2025-12-11: TradingSafetyNet commented out - module doesn't exist
    // this.safetyNet = new TradingSafetyNet({
    //   maxDailyLoss: 0.05,
    //   maxDrawdown: 0.10,
    //   enableLogging: true
    // });
    this.safetyNet = null;
    
    // Real-time metrics storage
    this.liveMetrics = {
      performance: {},
      profiles: {},
      safety: {},
      visualizations: {},
      lastUpdate: Date.now()
    };
    
    // Start real-time updates
    this.startRealTimeUpdates();
    
    console.log('🎯 Performance Dashboard Integration initialized');
  }
  
  /**
   * 📊 TRACK TRADE: Connect to main trading bot
   */
  trackTrade(tradeData, currentBalance) {
    try {
      // Update visualizer
      if (this.config.enableVisualizations) {
        this.visualizer.trackTrade(tradeData, currentBalance);
      }
      
      // Update validator
      this.validator.recordTrade(tradeData);
      
      // Update profile manager
      if (this.config.enableProfileTracking) {
        this.profileManager.trackPerformance(tradeData);
      }
      
      // Update safety net
      if (this.config.enableSafetyTracking) {
        this.safetyNet.updateBalance(currentBalance);
        this.safetyNet.recordTrade(tradeData);
      }
      
      // Emit update for dashboard
      this.emit('metricsUpdate', this.getLiveMetrics());
      
    } catch (error) {
      console.error('❌ Performance tracking error:', error);
    }
  }
  
  /**
   * 📈 GET LIVE METRICS: For dashboard display
   */
  getLiveMetrics() {
    try {
      // Get performance metrics
      const performanceReport = this.validator.getPerformanceReport();
      
      // Get profile performance
      const profilePerformance = this.profileManager?.getPerformanceStats?.() || {
        activeProfile: 'default',
        trades: 0,
        winRate: 0,
        totalPnL: 0
      };
      
      // Get safety metrics
      const safetyMetrics = this.safetyNet?.getMetrics?.() || {
        emergencyStop: false,
        dailyPnL: 0,
        currentDrawdown: 0,
        consecutiveLosses: 0,
        tradesThisHour: 0,
        violations: []
      };
      
      // Get visualization data
      const visualizationData = this.visualizer?.getMetrics?.() || {
        totalTrades: 0,
        winRate: 0,
        profitFactor: 1,
        sharpeRatio: 0,
        maxDrawdown: 0,
        currentBalance: 10000
      };
      
      this.liveMetrics = {
        performance: {
          totalTrades: performanceReport.overview.totalTrades,
          winRate: (performanceReport.overview.winRate * 100).toFixed(2),
          totalPnL: performanceReport.overview.totalPnL.toFixed(2),
          bestComponent: performanceReport.overview.bestComponent,
          worstComponent: performanceReport.overview.worstComponent,
          components: performanceReport.components
        },
        
        profiles: {
          activeProfile: this.profileManager?.activeProfile?.name || 'default',
          profileStats: profilePerformance,
          availableProfiles: this.profileManager?.profiles ? Object.keys(this.profileManager.profiles) : ['default']
        },
        
        safety: {
          emergencyStop: safetyMetrics.emergencyStop,
          dailyPnL: safetyMetrics.dailyPnL.toFixed(2),
          currentDrawdown: (safetyMetrics.currentDrawdown * 100).toFixed(2),
          consecutiveLosses: safetyMetrics.consecutiveLosses,
          tradesThisHour: safetyMetrics.tradesThisHour,
          violations: safetyMetrics.violations.length,
          riskLevel: this.calculateRiskLevel(safetyMetrics)
        },
        
        visualizations: {
          totalTrades: visualizationData.totalTrades,
          winRate: (visualizationData.winRate * 100).toFixed(2),
          profitFactor: visualizationData.profitFactor.toFixed(2),
          sharpeRatio: visualizationData.sharpeRatio.toFixed(2),
          maxDrawdown: (visualizationData.maxDrawdown * 100).toFixed(2),
          currentBalance: visualizationData.currentBalance.toFixed(2)
        },
        
        lastUpdate: Date.now(),
        timestamp: new Date().toISOString()
      };
      
      return this.liveMetrics;
      
    } catch (error) {
      console.error('❌ Error getting live metrics:', error);
      return this.liveMetrics; // Return last known good state
    }
  }
  
  /**
   * 🚨 CALCULATE RISK LEVEL: For dashboard display
   */
  calculateRiskLevel(safetyMetrics) {
    let riskScore = 0;
    
    // Drawdown risk
    if (safetyMetrics.currentDrawdown > 0.05) riskScore += 2;
    if (safetyMetrics.currentDrawdown > 0.08) riskScore += 3;
    
    // Consecutive losses
    if (safetyMetrics.consecutiveLosses >= 3) riskScore += 2;
    if (safetyMetrics.consecutiveLosses >= 5) riskScore += 4;
    
    // Daily loss
    if (safetyMetrics.dailyPnL < -100) riskScore += 1;
    if (safetyMetrics.dailyPnL < -500) riskScore += 3;
    
    // Violations
    riskScore += safetyMetrics.violations.length;
    
    // Convert to level
    if (riskScore === 0) return 'LOW';
    if (riskScore <= 3) return 'MEDIUM';
    if (riskScore <= 6) return 'HIGH';
    return 'CRITICAL';
  }
  
  /**
   * 🔄 START REAL-TIME UPDATES: For dashboard
   */
  startRealTimeUpdates() {
    // CHANGE 2026-01-29: Store interval for cleanup
    this.realTimeUpdateInterval = setInterval(() => {
      try {
        const metrics = this.getLiveMetrics();
        this.emit('dashboardUpdate', metrics);
      } catch (error) {
        console.error('❌ Real-time update error:', error);
      }
    }, this.config.updateInterval);
  }

  /**
   * CHANGE 2026-01-29: Shutdown to clear intervals
   */
  shutdown() {
    if (this.realTimeUpdateInterval) {
      clearInterval(this.realTimeUpdateInterval);
      this.realTimeUpdateInterval = null;
    }
  }
  
  /**
   * 📊 GET PERFORMANCE CHARTS: For content creation
   */
  getPerformanceCharts() {
    return this.visualizer.generateChartData();
  }
  
  /**
   * 📈 GET DETAILED REPORT: For analysis
   */
  getDetailedReport() {
    return {
      performance: this.validator.getPerformanceReport(),
      profiles: this.profileManager.getDetailedStats(),
      safety: this.safetyNet.getDetailedMetrics(),
      visualizations: this.visualizer.getDetailedMetrics()
    };
  }
  
  /**
   * 🎯 VALIDATE TRADE: Before execution
   */
  validateTrade(tradeParams) {
    if (this.config.enableSafetyTracking) {
      return this.safetyNet.validateTrade(tradeParams);
    }
    return { approved: true, reason: 'Safety tracking disabled' };
  }
  
  /**
   * 🔧 SWITCH PROFILE: Change trading profile
   */
  switchProfile(profileName) {
    if (this.config.enableProfileTracking) {
      return this.profileManager.switchProfile(profileName);
    }
    return false;
  }
}

module.exports = PerformanceDashboardIntegration;
