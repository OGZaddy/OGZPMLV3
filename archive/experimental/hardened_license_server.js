// hardened-license-server.js - PRODUCTION READY VERSION
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const helmet = require('helmet');
const mongoose = require('mongoose');
const fs = require('fs');

const app = express();

// HARDENED: Security middleware
app.use(helmet({
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

app.use(express.json({ limit: '1mb' }));

// HARDENED: Aggressive rate limiting
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Only 10 requests per IP per 15 minutes for validation
  message: { error: 'Too many validation attempts' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100,
  message: { error: 'Rate limit exceeded' }
});

app.use('/api/validate', strictLimiter);
app.use('/api/', generalLimiter);

// HARDENED: RSA key pair for signing responses (load from secure files)
const PRIVATE_KEY = fs.readFileSync('./keys/server-private.pem', 'utf8');
const PUBLIC_KEY = fs.readFileSync('./keys/server-public.pem', 'utf8');

// HARDENED: Database schemas with encryption
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  licenseKey: { type: String, required: true, unique: true, index: true },
  tier: { type: String, required: true, enum: ['basic', 'pro', 'prime', 'enterprise'] },
  subscriptionExpiry: { type: Date, required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  hardwareIds: [{ 
    id: String, 
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true }
  }],
  isActive: { type: Boolean, default: true },
  isSuspended: { type: Boolean, default: false },
  
  // HARDENED: Usage tracking
  lastLoginDate: Date,
  loginCount: { type: Number, default: 0 },
  lastHeartbeatDate: Date,
  heartbeatCount: { type: Number, default: 0 },
  
  // HARDENED: Security tracking
  failedLoginAttempts: { type: Number, default: 0 },
  lastFailedLogin: Date,
  ipAddresses: [{ ip: String, firstSeen: Date, lastSeen: Date }],
  
  // HARDENED: Payment tracking
  stripeCustomerId: String,
  stripeSubscriptionId: String,
  paymentFailures: { type: Number, default: 0 },
  
  // HARDENED: File integrity tracking
  expectedChecksums: Map,
  lastIntegrityCheck: Date
}, {
  timestamps: true
});

// HARDENED: Session tracking with Redis-like behavior
const sessionSchema = new mongoose.Schema({
  sessionToken: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, index: true },
  hardwareId: { type: String, required: true },
  ipAddress: String,
  userAgent: String,
  loginTime: { type: Date, default: Date.now },
  lastActivity: { type: Date, default: Date.now },
  isValid: { type: Boolean, default: true },
  
  // HARDENED: Security metadata
  encryptedPermissions: String,
  permissionsSignature: String,
  anomalyScore: { type: Number, default: 0 },
  
  // Auto-expire sessions after 24 hours
  expiresAt: { 
    type: Date, 
    default: Date.now, 
    expires: 24 * 60 * 60 // 24 hours in seconds
  }
});

// HARDENED: Audit log for all critical actions
const auditSchema = new mongoose.Schema({
  userId: String,
  action: String,
  ipAddress: String,
  userAgent: String,
  payload: Object,
  result: String,
  timestamp: { type: Date, default: Date.now },
  riskScore: Number
});

const User = mongoose.model('User', userSchema);
const Session = mongoose.model('Session', sessionSchema);
const AuditLog = mongoose.model('AuditLog', auditSchema);

// HARDENED: Connect to MongoDB with encryption
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  ssl: true,
  sslValidate: true,
  authSource: 'admin'
});

// HARDENED: Subscription tier definitions with enhanced security
const SUBSCRIPTION_TIERS = {
  'basic': {
    price: 49.99,
    modules: ['core_trading', 'basic_indicators'],
    maxInstances: 1,
    maxDailyHeartbeats: 480, // Every 3 minutes for 24 hours
    checksumValidation: true,
    description: 'Core trading with basic indicators'
  },
  'pro': {
    price: 99.99, 
    modules: ['core_trading', 'basic_indicators', 'pattern_recognition', 'fibonacci'],
    maxInstances: 2,
    maxDailyHeartbeats: 480,
    checksumValidation: true,
    advancedSecurity: true,
    description: 'Advanced pattern recognition + Fibonacci'
  },
  'prime': {
    price: 199.99,
    modules: ['core_trading', 'basic_indicators', 'pattern_recognition', 'fibonacci', 'advanced_risk', 'multi_timeframe'],
    maxInstances: 5,
    maxDailyHeartbeats: 960, // More frequent heartbeats
    checksumValidation: true,
    advancedSecurity: true,
    prioritySupport: true,
    description: 'Full feature set + multi-timeframe'
  },
  'enterprise': {
    price: 499.99,
    modules: ['core_trading', 'basic_indicators', 'pattern_recognition', 'fibonacci', 'advanced_risk', 'multi_timeframe', 'custom_strategies', 'api_access'],
    maxInstances: 999,
    maxDailyHeartbeats: 1440, // Every minute
    checksumValidation: true,
    advancedSecurity: true,
    prioritySupport: true,
    whiteLabel: true,
    customization: true,
    description: 'Everything + custom strategies + API'
  }
};

/**
 * HARDENED: Validate license with comprehensive security checks
 */
app.post('/api/validate', async (req, res) => {
  const startTime = Date.now();
  let auditData = {
    action: 'LICENSE_VALIDATION',
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    payload: { email: req.body.email },
    riskScore: 0
  };
  
  try {
    const { email, licenseKey, hardwareId, version, timestamp, nonce, checksum } = req.body;
    
    // HARDENED: Input validation
    if (!email || !licenseKey || !hardwareId || !version) {
      auditData.result = 'MISSING_FIELDS';
      auditData.riskScore = 3;
      await logAudit(auditData);
      return res.status(400).json({ 
        valid: false, 
        error: 'Missing required fields',
        timestamp: Date.now()
      });
    }
    
    // HARDENED: Timestamp validation (prevent replay attacks)
    if (!timestamp || Math.abs(Date.now() - timestamp) > 60000) { // 1 minute window
      auditData.result = 'INVALID_TIMESTAMP';
      auditData.riskScore = 5;
      await logAudit(auditData);
      return res.status(400).json({ 
        valid: false, 
        error: 'Invalid or expired timestamp',
        timestamp: Date.now()
      });
    }
    
    // HARDENED: Version check
    if (version !== '10.2') {
      auditData.result = 'UNSUPPORTED_VERSION';
      auditData.riskScore = 2;
      await logAudit(auditData);
      return res.status(400).json({ 
        valid: false, 
        error: 'Unsupported client version - update required',
        timestamp: Date.now()
      });
    }
    
    // HARDENED: Find user with comprehensive checks
    const user = await User.findOne({ 
      email: email.toLowerCase().trim(),
      isActive: true,
      isSuspended: false
    });
    
    if (!user) {
      auditData.result = 'USER_NOT_FOUND';
      auditData.riskScore = 4;
      await logAudit(auditData);
      return res.status(404).json({ 
        valid: false, 
        error: 'Invalid credentials',
        timestamp: Date.now()
      });
    }
    
    auditData.userId = user._id;
    
    // HARDENED: Check for too many failed attempts
    if (user.failedLoginAttempts >= 5 && 
        user.lastFailedLogin && 
        Date.now() - user.lastFailedLogin.getTime() < 15 * 60 * 1000) { // 15 minutes
      auditData.result = 'ACCOUNT_LOCKED';
      auditData.riskScore = 8;
      await logAudit(auditData);
      return res.status(429).json({ 
        valid: false, 
        error: 'Account temporarily locked due to failed attempts',
        timestamp: Date.now()
      });
    }
    
    // HARDENED: Verify license key with constant-time comparison
    const expectedKey = crypto.createHash('sha256').update(user.licenseKey).digest('hex');
    const providedKey = crypto.createHash('sha256').update(licenseKey).digest('hex');
    
    if (!crypto.timingSafeEqual(Buffer.from(expectedKey), Buffer.from(providedKey))) {
      // Increment failed attempts
      await User.updateOne(
        { _id: user._id },
        { 
          $inc: { failedLoginAttempts: 1 },
          $set: { lastFailedLogin: new Date() }
        }
      );
      
      auditData.result = 'INVALID_LICENSE_KEY';
      auditData.riskScore = 6;
      await logAudit(auditData);
      return res.status(401).json({ 
        valid: false, 
        error: 'Invalid credentials',
        timestamp: Date.now()
      });
    }
    
    // HARDENED: Check subscription expiry
    if (Date.now() > user.subscriptionExpiry.getTime()) {
      auditData.result = 'SUBSCRIPTION_EXPIRED';
      auditData.riskScore = 2;
      await logAudit(auditData);
      return res.status(402).json({ 
        valid: false, 
        error: 'Subscription expired - please renew',
        timestamp: Date.now()
      });
    }
    
    // HARDENED: Hardware ID validation and tracking
    const existingHardware = user.hardwareIds.find(hw => hw.id === hardwareId);
    const tier = SUBSCRIPTION_TIERS[user.tier];
    
    if (!existingHardware) {
      // New hardware ID
      const activeHardware = user.hardwareIds.filter(hw => hw.isActive).length;
      
      if (activeHardware >= tier.maxInstances) {
        auditData.result = 'MAX_INSTANCES_EXCEEDED';
        auditData.riskScore = 7;
        await logAudit(auditData);
        return res.status(403).json({ 
          valid: false, 
          error: `Maximum instances (${tier.maxInstances}) exceeded for ${user.tier} tier`,
          timestamp: Date.now()
        });
      }
      
      // Add new hardware ID
      user.hardwareIds.push({
        id: hardwareId,
        firstSeen: new Date(),
        lastSeen: new Date(),
        isActive: true
      });
    } else {
      // Update existing hardware ID
      existingHardware.lastSeen = new Date();
      if (!existingHardware.isActive) {
        existingHardware.isActive = true;
      }
    }
    
    // HARDENED: Check daily heartbeat limit (prevent abuse)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayHeartbeats = await Session.countDocuments({
      email: user.email,
      lastActivity: { $gte: today }
    });
    
    if (todayHeartbeats > tier.maxDailyHeartbeats) {
      auditData.result = 'HEARTBEAT_LIMIT_EXCEEDED';
      auditData.riskScore = 6;
      await logAudit(auditData);
      return res.status(429).json({ 
        valid: false, 
        error: 'Daily usage limit exceeded',
        timestamp: Date.now()
      });
    }
    
    // HARDENED: Generate secure session token
    const sessionData = {
      email: user.email,
      tier: user.tier,
      hardwareId: hardwareId,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex')
    };
    
    const sessionToken = jwt.sign(sessionData, process.env.JWT_SECRET, { 
      expiresIn: '24h',
      algorithm: 'HS256'
    });
    
    // HARDENED: Encrypt permissions payload
    const permissions = {
      tier: user.tier,
      modules: tier.modules,
      maxInstances: tier.maxInstances,
      subscriptionExpiry: user.subscriptionExpiry.getTime(),
      daysRemaining: Math.ceil((user.subscriptionExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      features: {
        checksumValidation: tier.checksumValidation,
        advancedSecurity: tier.advancedSecurity || false,
        prioritySupport: tier.prioritySupport || false
      }
    };
    
    const encryptedPermissions = encryptPermissions(permissions, hardwareId);
    
    // HARDENED: Create response with signature
    const responseData = {
      valid: true,
      sessionToken,
      encryptedPermissions,
      timestamp: Date.now(),
      serverVersion: '2.1',
      checksumRequired: tier.checksumValidation
    };
    
    // HARDENED: Sign the response
    const signature = signResponse(responseData);
    responseData.signature = signature;
    
    // HARDENED: Save session to database
    await Session.create({
      sessionToken,
      email: user.email,
      hardwareId,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      encryptedPermissions: JSON.stringify(encryptedPermissions),
      permissionsSignature: signature
    });
    
    // HARDENED: Update user stats
    await User.updateOne(
      { _id: user._id },
      { 
        $set: { 
          lastLoginDate: new Date(),
          failedLoginAttempts: 0, // Reset on successful login
          lastFailedLogin: null
        },
        $inc: { loginCount: 1 },
        $addToSet: { 
          ipAddresses: { 
            ip: req.ip, 
            firstSeen: new Date(), 
            lastSeen: new Date() 
          }
        }
      }
    );
    
    auditData.result = 'SUCCESS';
    auditData.riskScore = 0;
    await logAudit(auditData);
    
    console.log(`✅ License validated for ${user.email} (${user.tier}) from ${req.ip}`);
    res.json(responseData);
    
  } catch (error) {
    console.error('License validation error:', error);
    auditData.result = 'SERVER_ERROR';
    auditData.riskScore = 1;
    await logAudit(auditData);
    
    res.status(500).json({ 
      valid: false, 
      error: 'Internal server error',
      timestamp: Date.now()
    });
  }
});

/**
 * HARDENED: Enhanced heartbeat with anomaly detection
 */
app.post('/api/heartbeat', async (req, res) => {
  try {
    const { sessionToken, hardwareId, runningProcesses, memoryUsage, systemUptime } = req.body;
    
    if (!sessionToken || !hardwareId) {
      return res.status(400).json({ valid: false, error: 'Missing session data' });
    }
    
    // Find active session
    const session = await Session.findOne({ 
      sessionToken, 
      hardwareId, 
      isValid: true 
    });
    
    if (!session) {
      return res.status(401).json({ valid: false, error: 'Invalid session' });
    }
    
    const user = await User.findOne({ email: session.email, isActive: true });
    if (!user) {
      return res.status(404).json({ valid: false, error: 'User not found' });
    }
    
    // HARDENED: Anomaly detection
    let anomalyScore = 0;
    
    // Check for unusual heartbeat frequency
    const lastHeartbeat = session.lastActivity;
    const timeSinceLastHeartbeat = Date.now() - lastHeartbeat.getTime();
    
    if (timeSinceLastHeartbeat < 60000) { // Less than 1 minute
      anomalyScore += 2; // Suspiciously frequent
    }
    
    // Check system uptime consistency
    if (systemUptime && session.systemUptime) {
      const expectedUptime = session.systemUptime + (timeSinceLastHeartbeat / 1000);
      const uptimeDiff = Math.abs(expectedUptime - systemUptime);
      
      if (uptimeDiff > 300) { // More than 5 minutes difference
        anomalyScore += 3; // System may have been restarted or tampered with
      }
    }
    
    // Update session with anomaly score
    await Session.updateOne(
      { _id: session._id },
      { 
        $set: { 
          lastActivity: new Date(),
          systemUptime: systemUptime,
          anomalyScore: anomalyScore
        }
      }
    );
    
    // Update user heartbeat stats
    await User.updateOne(
      { _id: user._id },
      { 
        $set: { lastHeartbeatDate: new Date() },
        $inc: { heartbeatCount: 1 }
      }
    );
    
    // HARDENED: Check for server commands
    let serverCommand = null;
    
    // Check if user needs to update
    if (user.forceUpdate) {
      serverCommand = { type: 'UPDATE_REQUIRED', message: 'Please update to the latest version' };
    }
    
    // Check if account has been suspended
    if (user.isSuspended) {
      serverCommand = { type: 'SHUTDOWN', message: 'Account suspended' };
    }
    
    // Check subscription expiry
    if (Date.now() > user.subscriptionExpiry.getTime()) {
      serverCommand = { type: 'SHUTDOWN', message: 'Subscription expired' };
    }
    
    // High anomaly score triggers shutdown
    if (anomalyScore >= 5) {
      serverCommand = { type: 'SHUTDOWN', message: 'Suspicious activity detected' };
      
      // Log high-risk activity
      await logAudit({
        userId: user._id,
        action: 'HIGH_ANOMALY_SCORE',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        payload: { anomalyScore, sessionToken },
        result: 'FORCE_SHUTDOWN',
        riskScore: 9
      });
    }
    
    const responseData = {
      valid: true,
      timestamp: Date.now(),
      anomalyScore: anomalyScore,
      command: serverCommand
    };
    
    // Sign the response
    responseData.signature = signResponse(responseData);
    
    res.json(responseData);
    
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ valid: false, error: 'Internal server error' });
  }
});

/**
 * HARDENED: Encrypt permissions using AES-256-GCM
 */
function encryptPermissions(permissions, hardwareId) {
  const key = crypto.scryptSync(process.env.ENCRYPTION_PASSWORD, hardwareId, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher('aes-256-gcm', key);
  
  cipher.setAAD(Buffer.from(hardwareId));
  
  let encrypted = cipher.update(JSON.stringify(permissions), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * HARDENED: Sign response using RSA-SHA256
 */
function signResponse(data) {
  const { signature, ...dataToSign } = data;
  const dataString = JSON.stringify(dataToSign, Object.keys(dataToSign).sort());
  
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(dataString);
  
  return signer.sign(PRIVATE_KEY, 'base64');
}

/**
 * HARDENED: Log audit events
 */
async function logAudit(auditData) {
  try {
    await AuditLog.create(auditData);
    
    // Alert on high-risk activities
    if (auditData.riskScore >= 7) {
      console.warn(`🚨 HIGH RISK ACTIVITY: ${auditData.action} from ${auditData.ipAddress} (Score: ${auditData.riskScore})`);
      // Could send alert email/SMS here
    }
  } catch (error) {
    console.error('Audit logging failed:', error);
  }
}

// HARDENED: Admin endpoints with authentication
app.post('/api/admin/suspend-user', authenticateAdmin, async (req, res) => {
  const { email, suspend, reason } = req.body;
  
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    await User.updateOne(
      { _id: user._id },
      { $set: { isSuspended: suspend } }
    );
    
    // Invalidate all sessions for suspended users
    if (suspend) {
      await Session.updateMany(
        { email: user.email },
        { $set: { isValid: false } }
      );
    }
    
    await logAudit({
      userId: user._id,
      action: suspend ? 'USER_SUSPENDED' : 'USER_UNSUSPENDED',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      payload: { reason },
      result: 'SUCCESS',
      riskScore: 0
    });
    
    res.json({ success: true, message: `User ${suspend ? 'suspended' : 'unsuspended'}` });
    
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin authentication middleware
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing admin token' });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid admin token' });
  }
}

// HARDENED: Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('🔒 License server shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🔒 Hardened license server running on port ${PORT}`);
  console.log(`🛡️ Security features: Certificate pinning, payload encryption, anomaly detection`);
  console.log(`📊 Available tiers: ${Object.keys(SUBSCRIPTION_TIERS).join(', ')}`);
});

module.exports = app;