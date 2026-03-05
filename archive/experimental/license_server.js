// license-server.js - Your authentication & licensing server
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// In-memory database (replace with real DB in production)
const users = new Map();
const activeSessions = new Map();

// Subscription tiers and their allowed modules
const SUBSCRIPTION_TIERS = {
  'basic': {
    price: 49.99,
    modules: ['core_trading', 'basic_indicators'],
    maxInstances: 1,
    description: 'Core trading with basic indicators'
  },
  'pro': {
    price: 99.99, 
    modules: ['core_trading', 'basic_indicators', 'pattern_recognition', 'fibonacci'],
    maxInstances: 2,
    description: 'Advanced pattern recognition + Fibonacci'
  },
  'prime': {
    price: 199.99,
    modules: ['core_trading', 'basic_indicators', 'pattern_recognition', 'fibonacci', 'advanced_risk', 'multi_timeframe'],
    maxInstances: 5,
    description: 'Full feature set + multi-timeframe'
  },
  'enterprise': {
    price: 499.99,
    modules: ['core_trading', 'basic_indicators', 'pattern_recognition', 'fibonacci', 'advanced_risk', 'multi_timeframe', 'custom_strategies', 'api_access'],
    maxInstances: 999,
    description: 'Everything + custom strategies + API'
  }
};

// Generate hardware fingerprint
function generateHardwareId(req) {
  const factors = [
    req.headers['user-agent'],
    req.ip,
    req.headers['accept-language']
  ].join('|');
  
  return crypto.createHash('sha256').update(factors).digest('hex').substring(0, 16);
}

// Register new user
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, licenseKey, hardwareId } = req.body;
    
    if (!email || !password || !licenseKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if user already exists
    if (users.has(email)) {
      return res.status(409).json({ error: 'User already exists' });
    }
    
    // Validate license key format (you'd check against your license database)
    if (!isValidLicenseKey(licenseKey)) {
      return res.status(400).json({ error: 'Invalid license key' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Store user data
    users.set(email, {
      email,
      password: hashedPassword,
      licenseKey,
      tier: 'basic', // Default tier
      subscriptionExpiry: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
      createdAt: Date.now(),
      hardwareIds: [hardwareId],
      isActive: true
    });
    
    res.json({ success: true, message: 'Registration successful' });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Validate license and return permissions
app.post('/api/validate', async (req, res) => {
  try {
    const { email, licenseKey, hardwareId, version } = req.body;
    
    if (!email || !licenseKey || !hardwareId) {
      return res.status(400).json({ 
        valid: false, 
        error: 'Missing credentials' 
      });
    }
    
    const user = users.get(email);
    if (!user) {
      return res.status(404).json({ 
        valid: false, 
        error: 'User not found' 
      });
    }
    
    // Check license key
    if (user.licenseKey !== licenseKey) {
      return res.status(401).json({ 
        valid: false, 
        error: 'Invalid license key' 
      });
    }
    
    // Check if subscription is active
    if (Date.now() > user.subscriptionExpiry) {
      return res.status(402).json({ 
        valid: false, 
        error: 'Subscription expired' 
      });
    }
    
    // Check hardware ID
    if (!user.hardwareIds.includes(hardwareId)) {
      const tier = SUBSCRIPTION_TIERS[user.tier];
      if (user.hardwareIds.length >= tier.maxInstances) {
        return res.status(403).json({ 
          valid: false, 
          error: 'Maximum instances exceeded' 
        });
      }
      // Add new hardware ID
      user.hardwareIds.push(hardwareId);
    }
    
    // Check if user is suspended
    if (!user.isActive) {
      return res.status(403).json({ 
        valid: false, 
        error: 'Account suspended' 
      });
    }
    
    const tier = SUBSCRIPTION_TIERS[user.tier];
    
    // Generate session token
    const sessionToken = jwt.sign(
      { 
        email: user.email, 
        tier: user.tier,
        hardwareId 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    // Store active session
    activeSessions.set(sessionToken, {
      email: user.email,
      hardwareId,
      loginTime: Date.now(),
      lastActivity: Date.now()
    });
    
    // Return permissions
    res.json({
      valid: true,
      sessionToken,
      permissions: {
        tier: user.tier,
        modules: tier.modules,
        maxInstances: tier.maxInstances,
        subscriptionExpiry: user.subscriptionExpiry,
        daysRemaining: Math.ceil((user.subscriptionExpiry - Date.now()) / (1000 * 60 * 60 * 24))
      }
    });
    
  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({ 
      valid: false, 
      error: 'Internal server error' 
    });
  }
});

// Heartbeat endpoint - bot calls this every few minutes
app.post('/api/heartbeat', (req, res) => {
  try {
    const { sessionToken } = req.body;
    
    const session = activeSessions.get(sessionToken);
    if (!session) {
      return res.status(401).json({ valid: false, error: 'Invalid session' });
    }
    
    // Update last activity
    session.lastActivity = Date.now();
    
    res.json({ valid: true, timestamp: Date.now() });
    
  } catch (error) {
    res.status(500).json({ valid: false, error: 'Internal server error' });
  }
});

// Upgrade subscription tier
app.post('/api/upgrade', async (req, res) => {
  try {
    const { email, newTier, paymentToken } = req.body;
    
    const user = users.get(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (!SUBSCRIPTION_TIERS[newTier]) {
      return res.status(400).json({ error: 'Invalid tier' });
    }
    
    // Process payment here (integrate with Stripe, PayPal, etc.)
    const paymentSuccess = await processPayment(paymentToken, SUBSCRIPTION_TIERS[newTier].price);
    
    if (paymentSuccess) {
      user.tier = newTier;
      user.subscriptionExpiry = Date.now() + (30 * 24 * 60 * 60 * 1000); // Extend 30 days
      
      res.json({ 
        success: true, 
        message: `Upgraded to ${newTier}`,
        newExpiry: user.subscriptionExpiry
      });
    } else {
      res.status(402).json({ error: 'Payment failed' });
    }
    
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin endpoint to manage users
app.post('/api/admin/suspend', (req, res) => {
  // Add admin authentication here
  const { email, suspend } = req.body;
  
  const user = users.get(email);
  if (user) {
    user.isActive = !suspend;
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// Helper functions
function isValidLicenseKey(key) {
  // Implement your license key validation logic
  return key && key.length >= 20;
}

async function processPayment(token, amount) {
  // Integrate with your payment processor
  // Return true if payment successful
  return true; // Mock success
}

// Clean up expired sessions every hour
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [token, session] of activeSessions) {
    if (now - session.lastActivity > oneHour) {
      activeSessions.delete(token);
    }
  }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🔒 License server running on port ${PORT}`);
  console.log(`📊 Available tiers: ${Object.keys(SUBSCRIPTION_TIERS).join(', ')}`);
});

module.exports = app;