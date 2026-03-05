// license-manager.js - Add this to your bot for license validation
const crypto = require('crypto');
const os = require('os');
const https = require('https');

class LicenseManager {
  constructor(licenseServerUrl = 'https://your-license-server.com') {
    this.licenseServerUrl = licenseServerUrl;
    this.sessionToken = null;
    this.permissions = null;
    this.hardwareId = this.generateHardwareId();
    this.lastHeartbeat = 0;
    this.heartbeatInterval = 5 * 60 * 1000; // 5 minutes
    this.isValid = false;
  }
  
  /**
   * Generate unique hardware fingerprint
   */
  generateHardwareId() {
    const factors = [
      os.hostname(),
      os.arch(),
      os.platform(),
      os.cpus()[0].model,
      JSON.stringify(os.networkInterfaces())
    ].join('|');
    
    return crypto.createHash('sha256').update(factors).digest('hex').substring(0, 16);
  }
  
  /**
   * Validate license with server
   */
  async validateLicense(email, licenseKey) {
    try {
      const response = await this.makeRequest('/api/validate', {
        email,
        licenseKey,
        hardwareId: this.hardwareId,
        version: '10.2'
      });
      
      if (response.valid) {
        this.sessionToken = response.sessionToken;
        this.permissions = response.permissions;
        this.isValid = true;
        
        console.log(`✅ License validated - Tier: ${response.permissions.tier}`);
        console.log(`📦 Available modules: ${response.permissions.modules.join(', ')}`);
        console.log(`⏰ Days remaining: ${response.permissions.daysRemaining}`);
        
        // Start heartbeat
        this.startHeartbeat();
        
        return {
          success: true,
          permissions: this.permissions
        };
      } else {
        console.error(`❌ License validation failed: ${response.error}`);
        return {
          success: false,
          error: response.error
        };
      }
      
    } catch (error) {
      console.error(`❌ License server unreachable: ${error.message}`);
      return {
        success: false,
        error: 'Unable to validate license - check internet connection'
      };
    }
  }
  
  /**
   * Check if specific module is allowed
   */
  hasModule(moduleName) {
    if (!this.isValid || !this.permissions) {
      return false;
    }
    
    return this.permissions.modules.includes(moduleName);
  }
  
  /**
   * Get current subscription tier
   */
  getTier() {
    return this.permissions ? this.permissions.tier : 'none';
  }
  
  /**
   * Start heartbeat to maintain session
   */
  startHeartbeat() {
    setInterval(async () => {
      try {
        const response = await this.makeRequest('/api/heartbeat', {
          sessionToken: this.sessionToken
        });
        
        if (!response.valid) {
          console.error('❌ Session expired - license invalid');
          this.isValid = false;
          process.exit(1); // Force shutdown if license becomes invalid
        }
        
        this.lastHeartbeat = Date.now();
        
      } catch (error) {
        console.warn(`⚠️ Heartbeat failed: ${error.message}`);
        // Allow a few failed heartbeats before shutting down
        if (Date.now() - this.lastHeartbeat > this.heartbeatInterval * 3) {
          console.error('❌ Lost connection to license server - shutting down');
          process.exit(1);
        }
      }
    }, this.heartbeatInterval);
  }
  
  /**
   * Make HTTP request to license server
   */
  async makeRequest(endpoint, data) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(data);
      
      const options = {
        hostname: new URL(this.licenseServerUrl).hostname,
        port: 443,
        path: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'OGZPrime/10.2'
        }
      };
      
      const req = https.request(options, (res) => {
        let body = '';
        
        res.on('data', (chunk) => {
          body += chunk;
        });
        
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error('Invalid response format'));
          }
        });
      });
      
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }
  
  /**
   * Display tier comparison for upgrades
   */
  displayTierInfo() {
    const tiers = {
      'basic': 'Core trading + basic indicators ($49.99/mo)',
      'pro': 'Advanced patterns + Fibonacci ($99.99/mo)', 
      'prime': 'Full features + multi-timeframe ($199.99/mo)',
      'enterprise': 'Everything + custom strategies ($499.99/mo)'
    };
    
    console.log('\n💰 Available Subscription Tiers:');
    Object.entries(tiers).forEach(([tier, description]) => {
      const current = tier === this.getTier() ? ' (CURRENT)' : '';
      console.log(`  ${tier.toUpperCase()}${current}: ${description}`);
    });
    
    if (this.permissions && this.permissions.daysRemaining < 7) {
      console.log(`\n⚠️  Subscription expires in ${this.permissions.daysRemaining} days!`);
      console.log('Visit https://ogzprime.com/upgrade to renew');
    }
  }
}

/**
 * Modified OGZPrimeV10 constructor with license validation
 */
class OGZPrimeV10Licensed {
  constructor(config) {
    this.config = config;
    this.licenseManager = new LicenseManager(config.licenseServerUrl);
    this.isLicensed = false;
  }
  
  /**
   * Initialize with license check
   */
  async initialize() {
    // Prompt for credentials if not provided
    if (!this.config.email || !this.config.licenseKey) {
      throw new Error('Email and license key required. Set in config or environment variables.');
    }
    
    console.log('🔒 Validating OGZ Prime license...');
    
    const validation = await this.licenseManager.validateLicense(
      this.config.email,
      this.config.licenseKey
    );
    
    if (!validation.success) {
      throw new Error(`License validation failed: ${validation.error}`);
    }
    
    this.isLicensed = true;
    
    // Display tier information
    this.licenseManager.displayTierInfo();
    
    // Initialize components based on license
    await this.initializeComponents();
    
    console.log('🚀 OGZ Prime initialized successfully!');
  }
  
  /**
   * Initialize components based on subscription tier
   */
  async initializeComponents() {
    // Always available
    this.initializeCore();
    
    // Tier-gated features
    if (this.licenseManager.hasModule('pattern_recognition')) {
      this.initializePatternRecognition();
      console.log('✅ Pattern Recognition enabled');
    } else {
      console.log('❌ Pattern Recognition disabled (requires Pro tier or higher)');
    }
    
    if (this.licenseManager.hasModule('fibonacci')) {
      this.initializeFibonacci();
      console.log('✅ Fibonacci Detection enabled');
    } else {
      console.log('❌ Fibonacci Detection disabled (requires Pro tier or higher)');
    }
    
    if (this.licenseManager.hasModule('advanced_risk')) {
      this.initializeAdvancedRisk();
      console.log('✅ Advanced Risk Management enabled');
    } else {
      console.log('❌ Advanced Risk Management disabled (requires Prime tier or higher)');
    }
    
    if (this.licenseManager.hasModule('multi_timeframe')) {
      this.initializeMultiTimeframe();
      console.log('✅ Multi-Timeframe Analysis enabled');
    } else {
      console.log('❌ Multi-Timeframe Analysis disabled (requires Prime tier or higher)');
    }
    
    if (this.licenseManager.hasModule('custom_strategies')) {
      this.initializeCustomStrategies();
      console.log('✅ Custom Strategies enabled');
    } else {
      console.log('❌ Custom Strategies disabled (requires Enterprise tier)');
    }
  }
  
  /**
   * Core components (always available)
   */
  initializeCore() {
    // Initialize basic trading brain and indicators
    // This runs regardless of tier
  }
  
  /**
   * Pattern recognition (Pro+)
   */
  initializePatternRecognition() {
    if (!this.licenseManager.hasModule('pattern_recognition')) {
      throw new Error('Pattern Recognition not available in current tier');
    }
    // Initialize pattern recognition
  }
  
  /**
   * Fibonacci detection (Pro+)
   */
  initializeFibonacci() {
    if (!this.licenseManager.hasModule('fibonacci')) {
      throw new Error('Fibonacci Detection not available in current tier');
    }
    // Initialize Fibonacci detector
  }
  
  /**
   * Advanced risk management (Prime+)
   */
  initializeAdvancedRisk() {
    if (!this.licenseManager.hasModule('advanced_risk')) {
      throw new Error('Advanced Risk Management not available in current tier');
    }
    // Initialize advanced risk features
  }
  
  /**
   * Multi-timeframe analysis (Prime+)
   */
  initializeMultiTimeframe() {
    if (!this.licenseManager.hasModule('multi_timeframe')) {
      throw new Error('Multi-Timeframe Analysis not available in current tier');
    }
    // Initialize multi-timeframe features
  }
  
  /**
   * Custom strategies (Enterprise only)
   */
  initializeCustomStrategies() {
    if (!this.licenseManager.hasModule('custom_strategies')) {
      throw new Error('Custom Strategies not available in current tier');
    }
    // Initialize custom strategy engine
  }
  
  /**
   * Override any method that uses licensed features
   */
  async executeTrade(signal) {
    if (!this.isLicensed) {
      throw new Error('Valid license required to execute trades');
    }
    
    // Check if advanced features are being used
    if (signal.usesPatterns && !this.licenseManager.hasModule('pattern_recognition')) {
      console.warn('⚠️ Pattern-based signal detected but Pattern Recognition not licensed');
      // Fall back to basic signal
    }
    
    // Execute trade logic here
  }
}

// Export for use in your main bot file
module.exports = { LicenseManager, OGZPrimeV10Licensed };