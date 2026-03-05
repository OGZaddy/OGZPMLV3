// 💳 StripeEndpoints.js - OGZ Prime Payment Gateway
// Your pathway to financial freedom and Houston
// Built lean, mean, and modular for maximum profit extraction

const express = require('express');
const PaymentProcessor = require('./PaymentProcessor');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

class StripeEndpoints {
  constructor(config = {}) {
    this.config = {
      port: config.port || 4000,
      apiKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      corsOrigin: config.corsOrigin || '*',
      enableRateLimit: config.enableRateLimit !== false,
      maxRequestsPerMinute: config.maxRequestsPerMinute || 30,
      ...config
    };
    
    // Initialize payment processor
    this.paymentProcessor = new PaymentProcessor({
      currency: 'usd',
      webhookSecret: this.config.webhookSecret
    });
    
    // Express app
    this.app = express();
    this.server = null;
    
    // Subscription plans
    this.subscriptionPlans = {
      operator_core: {
        priceId: process.env.STRIPE_PRICE_CORE || 'price_operator_core',
        name: 'Operator Core',
        price: 199,
        features: ['Dashboard Access', 'Basic Trading Automation', 'Performance Analytics']
      },
      prime_operator: {
        priceId: process.env.STRIPE_PRICE_PRIME || 'price_prime_operator', 
        name: 'Prime Operator',
        price: 499,
        features: ['Everything in Core', 'Advanced Strategies', 'Multi-Symbol Support', 'Priority Support']
      },
      blacksite: {
        priceId: process.env.STRIPE_PRICE_BLACKSITE || 'price_blacksite',
        name: 'BlackSite',
        price: 999,
        features: ['Everything in Prime', 'Private Backend Install', 'Custom Symbols', 'Advanced AI Features', 'Direct Access']
      }
    };
    
    this.setupMiddleware();
    this.setupRoutes();
    
    console.log('💳 Stripe Payment Gateway initialized - Path to Houston ACTIVE');
  }
  
  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // CORS
    this.app.use('/api/stripe', cors({
      origin: this.config.corsOrigin,
      credentials: true
    }));
    
    // Rate limiting for payment endpoints
    if (this.config.enableRateLimit) {
      const paymentLimiter = rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: this.config.maxRequestsPerMinute,
        message: { error: 'Too many payment requests. Please wait.' }
      });
      this.app.use('/api/stripe', paymentLimiter);
    }
    
    // Raw body parser for webhooks
    this.app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
    
    // JSON parser for other endpoints
    this.app.use('/api/stripe', express.json());
    
    // Request logging
    this.app.use('/api/stripe', (req, res, next) => {
      console.log(`💳 ${req.method} ${req.path} - ${req.ip}`);
      next();
    });
  }
  
  /**
   * Setup all Stripe routes
   */
  setupRoutes() {
    // Get available subscription plans
    this.app.get('/api/stripe/plans', this.getPlans.bind(this));
    
    // Create customer
    this.app.post('/api/stripe/customer', this.createCustomer.bind(this));
    
    // Create subscription
    this.app.post('/api/stripe/subscription', this.createSubscription.bind(this));
    
    // Cancel subscription
    this.app.delete('/api/stripe/subscription/:id', this.cancelSubscription.bind(this));
    
    // Update subscription
    this.app.put('/api/stripe/subscription/:id', this.updateSubscription.bind(this));
    
    // Get customer subscriptions
    this.app.get('/api/stripe/customer/:id/subscriptions', this.getCustomerSubscriptions.bind(this));
    
    // Create one-time payment intent
    this.app.post('/api/stripe/payment-intent', this.createPaymentIntent.bind(this));
    
    // Create setup intent (for saving payment methods)
    this.app.post('/api/stripe/setup-intent', this.createSetupIntent.bind(this));
    
    // Get customer payment methods
    this.app.get('/api/stripe/customer/:id/payment-methods', this.getPaymentMethods.bind(this));
    
    // Stripe webhook handler
    this.app.post('/api/stripe/webhook', this.handleWebhook.bind(this));
    
    // Get subscription status
    this.app.get('/api/stripe/subscription/:id/status', this.getSubscriptionStatus.bind(this));
    
    // Upgrade/downgrade subscription
    this.app.post('/api/stripe/subscription/:id/change-plan', this.changePlan.bind(this));
    
    // Create portal session for customer self-service
    this.app.post('/api/stripe/portal', this.createPortalSession.bind(this));
    
    // Health check
    this.app.get('/api/stripe/health', (req, res) => {
      res.json({
        status: 'operational',
        service: 'OGZ Prime Payment Gateway',
        timestamp: Date.now(),
        destination: 'Houston 🚀'
      });
    });
  }
  
  /**
   * Get available subscription plans
   */
  async getPlans(req, res) {
    try {
      res.json({
        success: true,
        plans: this.subscriptionPlans,
        currency: 'USD'
      });
    } catch (error) {
      console.error('❌ Error fetching plans:', error);
      res.status(500).json({ error: 'Failed to fetch plans' });
    }
  }
  
  /**
   * Create a new Stripe customer
   */
  async createCustomer(req, res) {
    try {
      const { email, name, metadata = {} } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }
      
      const stripe = require('stripe')(this.config.apiKey);
      const customer = await stripe.customers.create({
        email,
        name,
        metadata: {
          source: 'OGZ_Prime',
          ...metadata
        }
      });
      
      res.json({
        success: true,
        customer: {
          id: customer.id,
          email: customer.email,
          name: customer.name
        }
      });
    } catch (error) {
      console.error('❌ Error creating customer:', error);
      res.status(500).json({ error: 'Failed to create customer' });
    }
  }
  
  /**
   * Create subscription
   */
  async createSubscription(req, res) {
    try {
      const { customerId, planKey, paymentMethodId } = req.body;
      
      if (!customerId || !planKey) {
        return res.status(400).json({ 
          error: 'Customer ID and plan are required' 
        });
      }
      
      const plan = this.subscriptionPlans[planKey];
      if (!plan) {
        return res.status(400).json({ error: 'Invalid plan selected' });
      }
      
      const stripe = require('stripe')(this.config.apiKey);
      
      // Attach payment method to customer if provided
      if (paymentMethodId) {
        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: customerId,
        });
        
        // Set as default payment method
        await stripe.customers.update(customerId, {
          invoice_settings: {
            default_payment_method: paymentMethodId,
          },
        });
      }
      
      // Create subscription
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: plan.priceId }],
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          plan: planKey,
          service: 'OGZ_Prime'
        }
      });
      
      res.json({
        success: true,
        subscription: {
          id: subscription.id,
          status: subscription.status,
          clientSecret: subscription.latest_invoice.payment_intent?.client_secret,
          plan: plan.name,
          amount: plan.price
        }
      });
    } catch (error) {
      console.error('❌ Error creating subscription:', error);
      res.status(500).json({ error: 'Failed to create subscription' });
    }
  }
  
  /**
   * Cancel subscription
   */
  async cancelSubscription(req, res) {
    try {
      const { id } = req.params;
      const { immediate = false } = req.body;
      
      const result = await this.paymentProcessor.cancelSubscription(id);
      
      res.json({
        success: true,
        message: immediate ? 'Subscription cancelled immediately' : 'Subscription will cancel at period end',
        subscription: result.subscription
      });
    } catch (error) {
      console.error('❌ Error cancelling subscription:', error);
      res.status(500).json({ error: 'Failed to cancel subscription' });
    }
  }
  
  /**
   * Update subscription
   */
  async updateSubscription(req, res) {
    try {
      const { id } = req.params;
      const { newPlanKey } = req.body;
      
      const newPlan = this.subscriptionPlans[newPlanKey];
      if (!newPlan) {
        return res.status(400).json({ error: 'Invalid plan selected' });
      }
      
      const stripe = require('stripe')(this.config.apiKey);
      const subscription = await stripe.subscriptions.retrieve(id);
      
      const updatedSubscription = await stripe.subscriptions.update(id, {
        items: [{
          id: subscription.items.data[0].id,
          price: newPlan.priceId,
        }],
        proration_behavior: 'create_prorations'
      });
      
      res.json({
        success: true,
        subscription: {
          id: updatedSubscription.id,
          status: updatedSubscription.status,
          plan: newPlan.name,
          amount: newPlan.price
        }
      });
    } catch (error) {
      console.error('❌ Error updating subscription:', error);
      res.status(500).json({ error: 'Failed to update subscription' });
    }
  }
  
  /**
   * Get customer subscriptions
   */
  async getCustomerSubscriptions(req, res) {
    try {
      const { id } = req.params;
      
      const stripe = require('stripe')(this.config.apiKey);
      const subscriptions = await stripe.subscriptions.list({
        customer: id,
        status: 'all',
        expand: ['data.items.data.price']
      });
      
      const formattedSubs = subscriptions.data.map(sub => ({
        id: sub.id,
        status: sub.status,
        currentPeriodEnd: sub.current_period_end,
        plan: sub.items.data[0]?.price?.nickname || 'Unknown',
        amount: sub.items.data[0]?.price?.unit_amount / 100
      }));
      
      res.json({
        success: true,
        subscriptions: formattedSubs
      });
    } catch (error) {
      console.error('❌ Error fetching subscriptions:', error);
      res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
  }
  
  /**
   * Create one-time payment intent
   */
  async createPaymentIntent(req, res) {
    try {
      const { amount, description, customerId, metadata = {} } = req.body;
      
      if (!amount || amount < 0.50) {
        return res.status(400).json({ 
          error: 'Amount must be at least $0.50' 
        });
      }
      
      const result = await this.paymentProcessor.createPaymentIntent(amount, {
        description: description || 'OGZ Prime Payment',
        customer: customerId,
        ...metadata
      });
      
      res.json({
        success: true,
        clientSecret: result.clientSecret,
        paymentIntentId: result.paymentIntentId
      });
    } catch (error) {
      console.error('❌ Error creating payment intent:', error);
      res.status(500).json({ error: 'Failed to create payment intent' });
    }
  }
  
  /**
   * Create setup intent for saving payment methods
   */
  async createSetupIntent(req, res) {
    try {
      const { customerId } = req.body;
      
      if (!customerId) {
        return res.status(400).json({ error: 'Customer ID is required' });
      }
      
      const stripe = require('stripe')(this.config.apiKey);
      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
        usage: 'off_session'
      });
      
      res.json({
        success: true,
        clientSecret: setupIntent.client_secret
      });
    } catch (error) {
      console.error('❌ Error creating setup intent:', error);
      res.status(500).json({ error: 'Failed to create setup intent' });
    }
  }
  
  /**
   * Get customer payment methods
   */
  async getPaymentMethods(req, res) {
    try {
      const { id } = req.params;
      
      const stripe = require('stripe')(this.config.apiKey);
      const paymentMethods = await stripe.paymentMethods.list({
        customer: id,
        type: 'card'
      });
      
      const formattedMethods = paymentMethods.data.map(pm => ({
        id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year
      }));
      
      res.json({
        success: true,
        paymentMethods: formattedMethods
      });
    } catch (error) {
      console.error('❌ Error fetching payment methods:', error);
      res.status(500).json({ error: 'Failed to fetch payment methods' });
    }
  }
  
  /**
   * Handle Stripe webhooks
   */
  async handleWebhook(req, res) {
    try {
      const sig = req.headers['stripe-signature'];
      const rawBody = req.body;
      
      const event = await this.paymentProcessor.handleWebhook(rawBody, sig);
      
      // Handle different event types
      switch (event.type) {
        case 'payment_success':
          console.log('💰 Payment successful:', event.data.id);
          // Update user access, send confirmation, etc.
          break;
          
        case 'subscription_update':
          console.log('📝 Subscription updated:', event.data.id);
          // Update user plan access
          break;
          
        case 'subscription_cancelled':
          console.log('❌ Subscription cancelled:', event.data.id);
          // Revoke user access
          break;
          
        default:
          console.log('📡 Webhook event:', event.type);
      }
      
      res.json({ received: true });
    } catch (error) {
      console.error('❌ Webhook error:', error);
      res.status(400).json({ error: 'Webhook failed' });
    }
  }
  
  /**
   * Get subscription status
   */
  async getSubscriptionStatus(req, res) {
    try {
      const { id } = req.params;
      
      const stripe = require('stripe')(this.config.apiKey);
      const subscription = await stripe.subscriptions.retrieve(id);
      
      res.json({
        success: true,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end
      });
    } catch (error) {
      console.error('❌ Error fetching subscription status:', error);
      res.status(500).json({ error: 'Failed to fetch subscription status' });
    }
  }
  
  /**
   * Change subscription plan
   */
  async changePlan(req, res) {
    try {
      const { id } = req.params;
      const { newPlanKey } = req.body;
      
      // Use the update subscription method
      await this.updateSubscription(req, res);
    } catch (error) {
      console.error('❌ Error changing plan:', error);
      res.status(500).json({ error: 'Failed to change plan' });
    }
  }
  
  /**
   * Create customer portal session
   */
  async createPortalSession(req, res) {
    try {
      const { customerId, returnUrl } = req.body;
      
      if (!customerId) {
        return res.status(400).json({ error: 'Customer ID is required' });
      }
      
      const stripe = require('stripe')(this.config.apiKey);
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl || 'https://yourdomain.com/dashboard'
      });
      
      res.json({
        success: true,
        url: session.url
      });
    } catch (error) {
      console.error('❌ Error creating portal session:', error);
      res.status(500).json({ error: 'Failed to create portal session' });
    }
  }
  
  /**
   * Start the Stripe endpoints server
   */
  start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, () => {
          console.log(`💳 Stripe Payment Gateway running on port ${this.config.port}`);
          console.log(`🎯 Ready to process payments for Houston fund 🚀`);
          resolve(true);
        });
      } catch (error) {
        console.error('❌ Failed to start Stripe endpoints:', error);
        reject(error);
      }
    });
  }
  
  /**
   * Stop the server
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('💳 Stripe Payment Gateway stopped');
          resolve(true);
        });
      } else {
        resolve(true);
      }
    });
  }
}

module.exports = StripeEndpoints;