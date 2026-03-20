// core/SingletonLock.js - CRITICAL SAFETY SYSTEM
// Prevents multiple bot instances from running simultaneously
// ADD THIS TO YOUR BOT STARTUP (run-trading-bot files)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class OGZSingletonLock {
  constructor(botName = 'ogz-prime') {
    this.botName = botName;
    // CHANGE: Use DATA_DIR for lock file if set (enables isolated testing instances)
    // This allows gates/test instances to run alongside main bot without conflict
    const lockDir = process.env.DATA_DIR || process.cwd();
    this.lockFile = path.join(lockDir, `.${botName}.lock`);
    this.pid = process.pid;
    this.startTime = Date.now();
    this.lockToken = crypto.randomBytes(16).toString('hex');
  }

  /**
   * Check if we should skip the lock (backtest/test mode)
   * Centralized here - not scattered in run-empire-v2.js
   */
  shouldSkipLock() {
    const isFileSource = process.env.CANDLE_SOURCE === 'file';
    const isBacktestMode = process.env.EXECUTION_MODE === 'backtest' ||
                           process.env.BACKTEST_MODE === 'true' ||
                           process.env.TEST_MODE === 'true';
    // Require BOTH: file source AND backtest mode
    return isFileSource && isBacktestMode;
  }

  /**
   * Acquire lock with full safety checks
   */
  acquireLock() {
    // Skip lock entirely for backtests (file source + backtest mode)
    if (this.shouldSkipLock()) {
      if (process.env.BACKTEST_SILENT !== 'true') {
        console.log(`🔓 [${this.botName}] Lock skipped (backtest mode)`);
      }
      return true;
    }

    console.log(`🔒 [${this.botName}] Attempting to acquire singleton lock...`);

    // Check if lock file exists
    if (fs.existsSync(this.lockFile)) {
      try {
        const lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
        
        // Check if that process is still running
        if (this.isProcessRunning(lockData.pid)) {
          console.error(`
🚨🚨🚨 CRITICAL SAFETY ERROR 🚨🚨🚨
Another ${this.botName} instance is already running!

Running Instance:
  PID: ${lockData.pid}
  Started: ${new Date(lockData.startTime).toLocaleString()}
  Token: ${lockData.token}

🛑 ABORTING TO PREVENT:
  - Duplicate trades
  - Portfolio conflicts  
  - WebSocket port conflicts
  - Data corruption

To force start (DANGEROUS):
1. Kill existing process: kill -9 ${lockData.pid}
2. Remove lock file: rm ${this.lockFile}
3. Start again

Houston Mission Status: PROTECTED ✅
          `);
          process.exit(1);
        } else {
          // Process is dead, clean up stale lock
          console.log(`🧹 [${this.botName}] Cleaning up stale lock file (PID ${lockData.pid} not running)`);
          fs.unlinkSync(this.lockFile);
        }
      } catch (error) {
        console.warn(`⚠️ [${this.botName}] Error reading lock file:`, error.message);
        // Remove corrupted lock file
        try {
          fs.unlinkSync(this.lockFile);
        } catch (e) {
          console.error('Error removing corrupted lock file:', e.message);
        }
      }
    }
    
    // Create new lock with metadata
    const lockData = {
      pid: this.pid,
      botName: this.botName,
      startTime: this.startTime,
      token: this.lockToken,
      hostname: require('os').hostname(),
      nodeVersion: process.version,
      platform: process.platform
    };
    
    try {
      fs.writeFileSync(this.lockFile, JSON.stringify(lockData, null, 2));
      console.log(`🔒 [${this.botName}] Singleton lock acquired successfully`);
      console.log(`   PID: ${this.pid}`);
      console.log(`   Token: ${this.lockToken}`);
      console.log(`   Lock file: ${this.lockFile}`);
    } catch (error) {
      console.error(`❌ [${this.botName}] Failed to create lock file:`, error.message);
      process.exit(1);
    }
    
    // Set up cleanup handlers
    this.setupCleanupHandlers();
    
    // Verify lock integrity every 30 seconds
    this.startLockMonitoring();
    
    return true;
  }

  /**
   * Check if a process is still running
   */
  isProcessRunning(pid) {
    try {
      // Process.kill with signal 0 just checks if process exists
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // ESRCH means process doesn't exist
      return error.code !== 'ESRCH';
    }
  }

  /**
   * Set up cleanup handlers for graceful shutdown
   */
  setupCleanupHandlers() {
    const cleanup = () => {
      this.releaseLock();
      process.exit(0);
    };

    // Handle different exit scenarios
    process.on('exit', () => this.releaseLock());
    process.on('SIGINT', cleanup);  // Ctrl+C
    process.on('SIGTERM', cleanup); // Termination signal
    process.on('SIGQUIT', cleanup); // Quit signal
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('🚨 Uncaught Exception:', error);
      this.releaseLock();
      process.exit(1);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
      this.releaseLock();
      process.exit(1);
    });
  }

  /**
   * Monitor lock integrity
   */
  startLockMonitoring() {
    // CHANGE 2026-01-29: Store interval for cleanup
    this.lockMonitorInterval = setInterval(() => {
      try {
        if (!fs.existsSync(this.lockFile)) {
          console.error(`🚨 [${this.botName}] Lock file disappeared! Exiting for safety.`);
          process.exit(1);
        }

        const lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
        if (lockData.token !== this.lockToken || lockData.pid !== this.pid) {
          console.error(`🚨 [${this.botName}] Lock file modified by another process! Exiting for safety.`);
          process.exit(1);
        }
      } catch (error) {
        console.error(`🚨 [${this.botName}] Lock monitoring error:`, error.message);
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Release the lock
   */
  releaseLock() {
    // CHANGE 2026-01-29: Clear monitoring interval
    if (this.lockMonitorInterval) {
      clearInterval(this.lockMonitorInterval);
      this.lockMonitorInterval = null;
    }

    try {
      if (fs.existsSync(this.lockFile)) {
        const lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));

        // Only remove if we own the lock
        if (lockData.pid === this.pid && lockData.token === this.lockToken) {
          fs.unlinkSync(this.lockFile);
          console.log(`🔓 [${this.botName}] Singleton lock released`);
        } else {
          console.warn(`⚠️ [${this.botName}] Lock file owned by different process - not removing`);
        }
      }
    } catch (error) {
      console.error(`❌ [${this.botName}] Error releasing lock:`, error.message);
    }
  }

  /**
   * Check if we hold the lock
   */
  hasLock() {
    try {
      if (!fs.existsSync(this.lockFile)) return false;
      
      const lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
      return lockData.pid === this.pid && lockData.token === this.lockToken;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get lock status information
   */
  getLockStatus() {
    try {
      if (!fs.existsSync(this.lockFile)) {
        return { locked: false, message: 'No lock file exists' };
      }
      
      const lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
      const isOwnLock = lockData.pid === this.pid && lockData.token === this.lockToken;
      
      return {
        locked: true,
        isOwnLock,
        data: lockData,
        message: isOwnLock ? 'Lock owned by this process' : 'Lock owned by another process'
      };
    } catch (error) {
      return { locked: false, error: error.message };
    }
  }
}

// ============================================================================
// ADDITIONAL SAFETY: PORT CHECKER
// ============================================================================

const net = require('net');

/**
 * Check if critical ports are available before starting
 */
async function checkCriticalPorts(ports = [3001, 3002, 3003, 3010]) {
  console.log('🔍 Checking critical ports availability...');
  
  for (const port of ports) {
    const inUse = await isPortInUse(port);
    if (inUse) {
      console.error(`
🚨 PORT ${port} ALREADY IN USE!
This likely means another bot instance is running.

Check what's using the port:
  Linux/Mac: lsof -i :${port}
  Windows: netstat -ano | findstr :${port}

Kill the process or use different ports.
      `);
      return false;
    }
  }
  
  console.log('✅ All critical ports available');
  return true;
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err) => {
      resolve(err.code === 'EADDRINUSE');
    });
    
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    
    server.listen(port);
  });
}

// ============================================================================
// USAGE INTEGRATION
// ============================================================================

/**
 * Add this to the TOP of your bot files (run-trading-bot-*.js):
 * 
 * const { OGZSingletonLock, checkCriticalPorts } = require('./core/SingletonLock');
 * 
 * // At the very start of your bot
 * async function startBot() {
 *   // Create lock for this specific bot
 *   const lock = new OGZSingletonLock('valhalla-bot'); // or 'v13-bot'
 *   
 *   // Acquire lock (will exit if another instance running)
 *   lock.acquireLock();
 *   
 *   // Check ports
 *   const portsOk = await checkCriticalPorts([3001, 3002, 3003, 3010]);
 *   if (!portsOk) process.exit(1);
 *   
 *   // Now start your bot safely
 *   console.log('🚀 Starting bot with singleton protection...');
 *   // ... rest of your bot initialization
 * }
 */

module.exports = { 
  OGZSingletonLock, 
  checkCriticalPorts,
  isPortInUse
};