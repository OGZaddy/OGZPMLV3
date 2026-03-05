/**
 * Gate 4B: Gemini Account Snapshot Test
 * Tests authenticated access to Gemini balance endpoint
 */
require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env' });
const crypto = require('crypto');
const axios = require('axios');

const apiKey = process.env.GEMINI_API_KEY;
const apiSecret = process.env.GEMINI_API_SECRET;

if (!apiKey || !apiSecret) {
  console.log('❌ Missing Gemini API credentials');
  process.exit(1);
}

async function makePrivateRequest(endpoint) {
  const nonce = Date.now();
  const payload = {
    request: endpoint,
    nonce: nonce
  };

  const jsonPayload = JSON.stringify(payload);
  const b64Payload = Buffer.from(jsonPayload).toString('base64');
  const signature = crypto.createHmac('sha384', apiSecret)
    .update(b64Payload)
    .digest('hex');

  const response = await axios.post('https://api.gemini.com' + endpoint, null, {
    headers: {
      'Content-Type': 'text/plain',
      'Content-Length': '0',
      'X-GEMINI-APIKEY': apiKey,
      'X-GEMINI-PAYLOAD': b64Payload,
      'X-GEMINI-SIGNATURE': signature,
      'Cache-Control': 'no-cache'
    }
  });
  return response.data;
}

makePrivateRequest('/v1/balances')
  .then(balances => {
    console.log('✅ Gemini Account: AUTHENTICATED');
    const nonZero = balances.filter(b => parseFloat(b.amount) > 0.0001);
    if (nonZero.length) {
      console.log('   Balances:');
      nonZero.forEach(b => {
        console.log('   ' + b.currency + ': ' + parseFloat(b.amount).toFixed(6) +
          ' (avail: ' + parseFloat(b.available).toFixed(6) + ')');
      });
    } else {
      console.log('   (No significant balances - PAPER MODE likely)');
    }
    process.exit(0);
  })
  .catch(e => {
    console.log('❌ Error:', e.response?.data?.message || e.message);
    process.exit(1);
  });
