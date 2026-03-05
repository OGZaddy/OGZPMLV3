// bulletproof-license-manager.js - HARDENED VERSION
const crypto = require('crypto');
const os = require('os');
const https = require('https');
const fs = require('fs');
const path = require('path');

/**
 * BULLETPROOF LICENSE MANAGER
 * - Certificate pinning
 * - Encrypted payloads
 * - Signed responses
 * - Runtime integrity checks
 * - Anti-tampering measures
 */
class BulletproofLicenseManager {
  constructor(config = {}) {
    // HARDENED: Multiple fallback servers with certificate pinning
    this.licenseServers = [
      { 
        url: 'https://license1.ogzprime.com',
        fingerprint: 'A1:B2:C3:D4:E5:F6:...' // SSL cert fingerprint
      },
      { 
        url: 'https://license2.ogzprime.com',
        fingerprint: 'B2:C3:D4:E5:F6:A1:...' // Backup server
      }
    ];
    
    // HARDENED: RSA keys for payload encryption (embed public key only)
    this.serverPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA... (embed your public key)
-----END PUBLIC KEY-----`;
    
    // HARDENED: Integrity checksums for critical files
    this.expectedChecksums = {
      'OGZPrimeV10.2.js': 'sha256:a1b2c3d4e5f6...',
      'OptimizedTradingBrain.js': 'sha256:b2c3d4e5f6a1...',
      // Add all your core files
    };
    
    this.sessionToken = null;
    this.permissions = null;
    this.hardwareId = this.generateSecureHardwareId();
    this.lastHeartbeat = 0;
    this.heartbeatInterval = 3 * 60 * 1000; // 3 minutes
    this.isValid = false;
    this.encryptionKey = this.deriveEncryptionKey();
    
    // HARDENED: Anti-debugging measures
    this.startAntiTamperChecks();
  }
  
  /**
   * HARDENED: Generate cryptographically secure hardware ID
   * Uses multiple system identifiers and encrypts them
   */
  generateSecureHardwareId() {
    try {
      const systemInfo = {
        hostname: os.hostname(),
        arch: os.arch(),
        platform: os.platform(),
        cpus: os.cpus().map(cpu => ({ model: cpu.model, speed: cpu.speed })),
        totalmem: os.totalmem(),
        networkInterfaces: this.hashNetworkInterfaces(),
        machineId: this.getMachineId(),
        diskSerial: this.getDiskSerial()
      };
      
      const serialized = JSON.stringify(systemInfo, Object.keys(systemInfo).sort());
      const hash = crypto.createHash('sha256').update(serialized).digest('hex');
      
      // HARDENED: XOR with system-specific salt
      const salt = this.getSystemSalt();
      return this.xorHexStrings(hash, salt).substring(0, 32);
      
    } catch (error) {
      // Fallback ID if system info gathering fails
      return crypto.randomBytes(16).toString('hex');
    }
  }
  
  /**
   * HARDENED: Get machine-specific salt for hardware ID
   */
  getSystemSalt() {
    const factors = [
      process.pid.toString(),
      process.ppid ? process.ppid.toString() : '0',
      __dirname,
      process.version
    ].join('|');
    
    return crypto.createHash('md5').update(factors).digest('hex');
  }
  
  /**
   * HARDENED: Hash network interfaces without exposing real MACs
   */
  hashNetworkInterfaces() {
    const interfaces = os.networkInterfaces();
    const filtered = {};
    
    Object.keys(interfaces).forEach(name => {
      if (!name.includes('lo') && !name.includes('docker')) {
        const addr = interfaces[name].find(i => !i.internal);
        if (addr && addr.mac) {
          filtered[name] = crypto.createHash('md5').update(addr.mac).digest('hex');
        }
      }
    });
    
    return filtered;
  }
  
  /**
   * HARDENED: Get machine ID from system
   */
  getMachineId() {
    try {
      if (process.platform === 'linux') {
        return fs.readFileSync('/etc/machine-id', 'utf8').trim();
      } else if (process.platform === 'darwin') {
        // macOS: Use hardware UUID
        const { execSync } = require('child_process');
        return execSync('system_profiler SPHardwareDataType | grep UUID', { encoding: 'utf8' })
          .split(':')[1].trim();
      } else if (process.platform === 'win32') {
        // Windows: Use WMIC to get motherboard serial
        const { execSync } = require('child_process');
        return execSync('wmic baseboard get serialnumber /value', { encoding: 'utf8' })
          .split('=')[1].trim();
      }
    } catch (error) {
      // Fallback
      return crypto.createHash('md5').update(os.hostname() + os.arch()).digest('hex');
    }
  }
  
  /**
   * HARDENED: Get disk serial number
   */
  getDiskSerial() {
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'linux') {
        return execSync('lsblk -no SERIAL | head -1', { encoding: 'utf8' }).trim();
      } else if (process.platform === 'win32') {
        return execSync('wmic diskdrive get serialnumber /value | findstr SerialNumber', { encoding: 'utf8' })
          .split('=')[1].trim();
      }
    } catch (error) {
      return 'unknown';
    }
  }
  
  /**
   * HARDENED: XOR two hex strings
   */
  xorHexStrings(hex1, hex2) {
    const minLength = Math.min(hex1.length, hex2.length);
    let result = '';
    
    for (let i = 0; i < minLength; i++) {
      const a = parseInt(hex1[i], 16);
      const b = parseInt(hex2[i % hex2.length], 16);
      result += (a ^ b).toString(16);
    }
    
    return result;
  }
  
  /**
   * HARDENED: Derive encryption key from hardware ID
   */
  deriveEncryptionKey() {
    const iterations = 10000;
    const keyLength = 32;
    const salt = crypto.createHash('sha256').update(this.hardwareId).digest();
    
    return crypto.pbkdf2Sync(this.hardwareId, salt, iterations, keyLength, 'sha256');
  }
  
  /**
   * HARDENED: Validate license with encrypted payload and signature verification
   */
  async validateLicense(email, licenseKey) {
    try {
      // HARDENED: Check file integrity first
      if (!await this.verifyFileIntegrity()) {
        throw new Error('Core files have been tampered with');
      }
      
      // HARDENED: Create encrypted payload
      const payload = {
        email,
        licenseKey: this.encryptString(licenseKey),
        hardwareId: this.hardwareId,
        version: '10.2',
        timestamp: Date.now(),
        nonce: crypto.randomBytes(16).toString('hex'),
        checksum: this.calculatePayloadChecksum(email, licenseKey)
      };
      
      // Try each server until one succeeds
      for (const server of this.licenseServers) {
        try {
          const response = await this.makeSecureRequest(server, '/api/validate', payload);
          
          if (response.valid && this.verifyResponseSignature(response)) {
            this.sessionToken = response.sessionToken;
            this.permissions = this.decryptPermissions(response.encryptedPermissions);
            this.isValid = true;
            
            console.log(`✅ License validated - Tier: ${this.permissions.tier}`);
            console.log(`🔒 Security: Certificate pinned, payload encrypted`);
            
            // Start enhanced heartbeat
            this.startSecureHeartbeat();
            
            return {
              success: true,
              permissions: this.permissions
            };
          }
        } catch (serverError) {
          console.warn(`Server ${server.url} failed: ${serverError.message}`);
          continue; // Try next server
        }
      }
      
      throw new Error('All license servers unreachable or invalid');
      
    } catch (error) {
      console.error(`❌ License validation failed: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * HARDENED: Verify file integrity using checksums
   */
  async verifyFileIntegrity() {
    try {
      for (const [filename, expectedChecksum] of Object.entries(this.expectedChecksums)) {
        const filePath = path.join(__dirname, filename);
        
        if (!fs.existsSync(filePath)) {
          console.error(`❌ Critical file missing: ${filename}`);
          return false;
        }
        
        const fileContent = fs.readFileSync(filePath);
        const actualChecksum = 'sha256:' + crypto.createHash('sha256').update(fileContent).digest('hex');
        
        if (actualChecksum !== expectedChecksum) {
          console.error(`❌ File integrity check failed: ${filename}`);
          console.error(`Expected: ${expectedChecksum}`);
          console.error(`Actual: ${actualChecksum}`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error(`❌ Integrity check error: ${error.message}`);
      return false;
    }
  }
  
  /**
   * HARDENED: Calculate payload checksum to prevent tampering
   */
  calculatePayloadChecksum(email, licenseKey) {
    const data = `${email}|${licenseKey}|${this.hardwareId}|10.2`;
    return crypto.createHmac('sha256', this.encryptionKey).update(data).digest('hex');
  }
  
  /**
   * HARDENED: Encrypt string using AES-256-GCM
   */
  encryptString(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-gcm', this.encryptionKey);
    cipher.setAAD(Buffer.from(this.hardwareId));
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }
  
  /**
   * HARDENED: Decrypt permissions from server response
   */
  decryptPermissions(encryptedData) {
    try {
      const decipher = crypto.createDecipher('aes-256-gcm', this.encryptionKey);
      decipher.setAAD(Buffer.from(this.hardwareId));
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
      
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
    } catch (error) {
      throw new Error('Failed to decrypt server response - possible tampering');
    }
  }
  
  /**
   * HARDENED: Verify server response signature using RSA
   */
  verifyResponseSignature(response) {
    try {
      const { signature, ...data } = response;
      const dataString = JSON.stringify(data, Object.keys(data).sort());
      
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(dataString);
      
      return verifier.verify(this.serverPublicKey, signature, 'base64');
    } catch (error) {
      console.error('Signature verification failed:', error.message);
      return false;
    }
  }
  
  /**
   * HARDENED: Make secure request with certificate pinning
   */
  async makeSecureRequest(server, endpoint, data) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(data);
      
      const options = {
        hostname: new URL(server.url).hostname,
        port: 443,
        path: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'OGZPrime/10.2-Hardened',
          'X-Hardware-ID': crypto.createHash('md5').update(this.hardwareId).digest('hex')
        },
        // HARDENED: Certificate pinning
        checkServerIdentity: (hostname, cert) => {
          const fingerprint = cert.fingerprint256;
          if (fingerprint !== server.fingerprint) {
            throw new Error(`Certificate fingerprint mismatch. Expected: ${server.fingerprint}, Got: ${fingerprint}`);
          }
          return undefined;
        }
      };
      
      const req = https.request(options, (res) => {
        let body = '';
        
        res.on('data', (chunk) => {
          body += chunk;
        });
        
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            
            // HARDENED: Verify response timestamp to prevent replay attacks
            if (Math.abs(Date.now() - response.timestamp) > 30000) { // 30 second window
              reject(new Error('Response timestamp too old - possible replay attack'));
              return;
            }
            
            resolve(response);
          } catch (error) {
            reject(new Error('Invalid response format'));
          }
        });
      });
      
      req.on('error', (error) => {
        if (error.message.includes('fingerprint')) {
          reject(new Error('SSL certificate validation failed - possible MITM attack'));
        } else {
          reject(error);
        }
      });
      
      // HARDENED: Request timeout
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      req.write(postData);
      req.end();
    });
  }
  
  /**
   * HARDENED: Enhanced heartbeat with anti-tampering checks
   */
  startSecureHeartbeat() {
    setInterval(async () => {
      try {
        // Check for tampering before heartbeat
        if (!await this.verifyFileIntegrity()) {
          console.error('❌ File tampering detected - shutting down');
          this.emergencyShutdown('FILE_TAMPERED');
          return;
        }
        
        const heartbeatPayload = {
          sessionToken: this.sessionToken,
          hardwareId: this.hardwareId,
          timestamp: Date.now(),
          runningProcesses: this.getRunningProcessCount(),
          memoryUsage: process.memoryUsage(),
          systemUptime: os.uptime()
        };
        
        const response = await this.makeSecureRequest(
          this.licenseServers[0], 
          '/api/heartbeat', 
          heartbeatPayload
        );
        
        if (!response.valid || !this.verifyResponseSignature(response)) {
          console.error('❌ Invalid heartbeat response - license may be compromised');
          this.emergencyShutdown('INVALID_HEARTBEAT');
          return;
        }
        
        this.lastHeartbeat = Date.now();
        
        // Check for server commands
        if (response.command) {
          this.handleServerCommand(response.command);
        }
        
      } catch (error) {
        console.warn(`⚠️ Heartbeat failed: ${error.message}`);
        
        // Allow 3 failed heartbeats before shutdown
        if (Date.now() - this.lastHeartbeat > this.heartbeatInterval * 3) {
          console.error('❌ Lost connection to license server - shutting down');
          this.emergencyShutdown('CONNECTION_LOST');
        }
      }
    }, this.heartbeatInterval);
  }
  
  /**
   * HARDENED: Anti-tampering checks running in background
   */
  startAntiTamperChecks() {
    // Check every 5 minutes
    setInterval(async () => {
      try {
        // 1. Verify file integrity
        if (!await this.verifyFileIntegrity()) {
          this.emergencyShutdown('FILE_INTEGRITY_FAILED');
          return;
        }
        
        // 2. Check for debugging tools
        if (this.isDebuggerPresent()) {
          console.error('❌ Debugger detected - shutting down');
          this.emergencyShutdown('DEBUGGER_DETECTED');
          return;
        }
        
        // 3. Verify memory hasn't been tampered with
        if (!this.verifyMemoryIntegrity()) {
          this.emergencyShutdown('MEMORY_TAMPERED');
          return;
        }
        
      } catch (error) {
        console.error('Anti-tamper check error:', error.message);
      }
    }, 5 * 60 * 1000);
  }
  
  /**
   * HARDENED: Detect if debugger is attached
   */
  isDebuggerPresent() {
    // Simple timing-based detection
    const start = Date.now();
    debugger; // Will pause if debugger is present
    const end = Date.now();
    
    return (end - start) > 100; // If more than 100ms, debugger likely present
  }
  
  /**
   * HARDENED: Verify critical objects haven't been tampered with
   */
  verifyMemoryIntegrity() {
    try {
      // Check if critical methods have been overridden
      const criticalMethods = [
        'validateLicense',
        'hasModule',
        'makeSecureRequest'
      ];
      
      for (const method of criticalMethods) {
        if (typeof this[method] !== 'function') {
          console.error(`Critical method ${method} has been tampered with`);
          return false;
        }
      }
      
      // Check if crypto module has been replaced
      if (!crypto.createHash || !crypto.createHmac) {
        console.error('Crypto module has been tampered with');
        return false;
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * HARDENED: Handle server commands (remote control)
   */
  handleServerCommand(command) {
    switch (command.type) {
      case 'SHUTDOWN':
        console.log('🔒 Remote shutdown command received');
        this.emergencyShutdown('REMOTE_SHUTDOWN');
        break;
        
      case 'UPDATE_REQUIRED':
        console.log('📥 Update required - please download latest version');
        process.exit(2); // Exit code 2 = update required
        break;
        
      case 'FEATURE_TOGGLE':
        console.log(`🔧 Feature ${command.feature} toggled to ${command.enabled}`);
        // Handle feature toggles
        break;
        
      default:
        console.warn(`Unknown server command: ${command.type}`);
    }
  }
  
  /**
   * HARDENED: Emergency shutdown with cleanup
   */
  emergencyShutdown(reason) {
    console.error(`🚨 EMERGENCY SHUTDOWN: ${reason}`);
    
    // Clean up sensitive data
    this.sessionToken = null;
    this.permissions = null;
    this.encryptionKey = null;
    
    // Close any open positions (implement based on your trading logic)
    if (typeof this.closeAllPositions === 'function') {
      this.closeAllPositions();
    }
    
    // Exit with specific code
    process.exit(99);
  }
  
  /**
   * Get process count for anomaly detection
   */
  getRunningProcessCount() {
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'win32') {
        return execSync('tasklist | find /c /v ""', { encoding: 'utf8' }).trim();
      } else {
        return execSync('ps aux | wc -l', { encoding: 'utf8' }).trim();
      }
    } catch (error) {
      return 'unknown';
    }
  }
  
  /**
   * Check if specific module is allowed (unchanged)
   */
  hasModule(moduleName) {
    if (!this.isValid || !this.permissions) {
      return false;
    }
    
    return this.permissions.modules.includes(moduleName);
  }
  
  /**
   * Get current subscription tier (unchanged)
   */
  getTier() {
    return this.permissions ? this.permissions.tier : 'none';
  }
}

module.exports = { BulletproofLicenseManager };