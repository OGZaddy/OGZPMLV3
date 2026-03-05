/**
 * Gate 4B: Kraken Account Snapshot Test
 * Tests authenticated access to Kraken balance endpoint
 */
require('dotenv').config();
const crypto = require('crypto');
const axios = require('axios');
const querystring = require('querystring');

const apiKey = process.env.KRAKEN_API_KEY;
const apiSecret = process.env.KRAKEN_API_SECRET;

if (!apiKey || !apiSecret) {
  console.log('❌ Missing Kraken API credentials');
  process.exit(1);
}

async function makePrivateRequest(path) {
  const nonce = Date.now() * 1000;
  const postData = querystring.stringify({ nonce });
  const message = path + crypto.createHash('sha256')
    .update(nonce + postData).digest('binary');
  const signature = crypto.createHmac('sha512', Buffer.from(apiSecret, 'base64'))
    .update(message, 'binary').digest('base64');

  const response = await axios.post('https://api.kraken.com' + path, postData, {
    headers: {
      'API-Key': apiKey,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  return response.data;
}

makePrivateRequest('/0/private/Balance')
  .then(r => {
    if (r.error && r.error.length) {
      console.log('❌ Kraken API Error:', r.error.join(', '));
      process.exit(1);
    } else {
      console.log('✅ Kraken Account: AUTHENTICATED');
      const balances = Object.entries(r.result)
        .filter(([,v]) => parseFloat(v) > 0.0001)
        .map(([k,v]) => '   ' + k + ': ' + parseFloat(v).toFixed(6));
      if (balances.length) {
        console.log('   Balances:');
        balances.forEach(b => console.log(b));
      } else {
        console.log('   (No significant balances - PAPER MODE likely)');
      }
      process.exit(0);
    }
  })
  .catch(e => {
    console.log('❌ Error:', e.message);
    process.exit(1);
  });
