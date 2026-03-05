// Integration Example: Adding Stripe to your main OGZ Prime application
// Add this to your main server file or create a new payment-server.js

const StripeEndpoints = require('./StripeEndpoints');

// Option 1: Standalone payment server
async function startPaymentServer() {
  const stripeServer = new StripeEndpoints({
    port: 4000,
    corsOrigin: ['http://localhost:3000', 'https://yourdomain.com'],
    enableRateLimit: true,
    maxRequestsPerMinute: 30
  });
  
  await stripeServer.start();
  console.log('💰 Payment gateway ready for Houston fund collection!');
}

// Option 2: Integrate with existing Express app
function addStripeToExistingApp(existingApp) {
  const stripeEndpoints = new StripeEndpoints();
  
  // Mount Stripe routes on existing app
  existingApp.use(stripeEndpoints.app);
  
  console.log('💳 Stripe endpoints added to existing server');
}

// Option 3: Add to your main OGZ Prime class
class OGZPrime {
  constructor(config) {
    // ... your existing code ...
    
    // Add payment processing
    this.paymentGateway = new StripeEndpoints({
      port: config.paymentPort || 4000
    });
  }
  
  async start() {
    // ... your existing startup code ...
    
    // Start payment gateway
    await this.paymentGateway.start();
    console.log('🚀 OGZ Prime fully operational with monetization ACTIVE');
  }
}

// Start it up
if (require.main === module) {
  startPaymentServer();
}

module.exports = { StripeEndpoints };