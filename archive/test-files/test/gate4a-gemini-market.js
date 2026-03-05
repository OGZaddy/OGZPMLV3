/**
 * Gate 4A: Gemini Market Data Test
 * Tests public market data endpoint
 */
const axios = require('axios');

async function testGemini() {
  try {
    // Test public ticker
    const response = await axios.get('https://api.gemini.com/v1/pubticker/btcusd');
    const data = response.data;

    console.log('✅ Gemini Public API: CONNECTED');
    console.log('   BTC/USD Last:', data.last);
    console.log('   Bid:', data.bid);
    console.log('   Ask:', data.ask);
    console.log('   Volume:', JSON.stringify(data.volume));
    process.exit(0);
  } catch (e) {
    console.log('❌ Gemini API Error:', e.message);
    process.exit(1);
  }
}

testGemini();
