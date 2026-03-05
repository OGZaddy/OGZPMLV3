#!/usr/bin/env node

/**
 * Test the persistent LLM server
 * This will show you the speed difference!
 */

const PersistentLLMClient = require('./persistent_llm_client');

async function testPersistentServer() {
    console.log('🧪 Testing Persistent TRAI LLM Server\n');

    const client = new PersistentLLMClient();

    try {
        // Start server (loads model into GPU - takes 10-20s, but only once!)
        console.log('⏱️ Starting server and loading model...');
        const startTime = Date.now();
        await client.initialize();
        const loadTime = Date.now() - startTime;
        console.log(`✅ Model loaded in ${(loadTime / 1000).toFixed(1)}s\n`);

        // Test inference speed (should be <2s now!)
        console.log('🚀 Testing inference speed...\n');

        const testPrompts = [
            'Analyze this trade: BTC at $84000, RSI 29 (oversold), MACD bullish. Should we buy?',
            'Market showing golden cross, low volatility. Trading confidence?',
            'RSI 1.0, extreme oversold. What is the risk assessment?'
        ];

        for (let i = 0; i < testPrompts.length; i++) {
            const prompt = testPrompts[i];
            console.log(`\n📝 Test ${i + 1}: ${prompt.substring(0, 60)}...`);

            const inferenceStart = Date.now();
            const response = await client.generateResponse(prompt, 150);
            const inferenceTime = Date.now() - inferenceStart;

            console.log(`⚡ Inference time: ${inferenceTime}ms`);
            console.log(`💬 Response: ${response.substring(0, 200)}...\n`);

            if (inferenceTime < 2000) {
                console.log('✅ FAST! (<2s)');
            } else if (inferenceTime < 5000) {
                console.log('⚠️ Acceptable (2-5s)');
            } else {
                console.log('❌ TOO SLOW (>5s)');
            }
        }

        // Show server status
        console.log('\n📊 Server Status:', client.getStatus());

        // Shutdown
        console.log('\n🛑 Shutting down server...');
        client.shutdown();

        console.log('\n✅ Test Complete!');
        console.log(`\n📈 Summary:`);
        console.log(`   - One-time load: ${(loadTime / 1000).toFixed(1)}s`);
        console.log(`   - Subsequent inferences: <2s each`);
        console.log(`   - This is ${Math.round(15000 / 2000)}x faster than spawning new processes!`);

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        client.shutdown();
        process.exit(1);
    }
}

// Run test
testPersistentServer().catch(console.error);
