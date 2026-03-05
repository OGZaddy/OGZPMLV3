/**
 * OGZPrime Stripe Checkout Endpoint
 * Drop this into your Express server or run standalone
 * 
 * SETUP:
 * 1. npm install stripe express cors
 * 2. Set STRIPE_SECRET_KEY in .env (NEVER commit the secret key)
 * 3. Add route to your existing Express app or run standalone
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// Price IDs from Stripe dashboard
const PRICE_MAP = {
  core: 'price_1T7Mg4CRplnSOv5bEfq29wnU',    // OGZP Core
  pro:  'price_1T7Mg2CRplnSOv5bJdfGcWnp',     // OGZPML (Pro)
};

/**
 * POST /create-checkout-session
 * Body: { priceId: "price_..." } or { tier: "core" | "pro" }
 */
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { priceId, tier } = req.body;
    
    // Accept either raw priceId or tier name
    const resolvedPriceId = priceId || PRICE_MAP[tier];
    
    if (!resolvedPriceId) {
      return res.status(400).json({ error: 'Invalid tier or priceId' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        price: resolvedPriceId,
        quantity: 1,
      }],
      subscription_data: {
        trial_period_days: 7,  // 7-day free trial
      },
      success_url: 'https://www.ogzprime.com/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.ogzprime.com/pricing.html',
      allow_promotion_codes: true,
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /checkout-status?session_id=cs_...
 * For the success page to verify payment
 */
app.get('/checkout-status', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
    res.json({
      status: session.payment_status,
      customer_email: session.customer_details?.email,
      subscription: session.subscription,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// If running standalone (not imported into existing app)
if (require.main === module) {
  const PORT = process.env.STRIPE_PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Stripe checkout server running on port ${PORT}`);
  });
}

module.exports = app;
