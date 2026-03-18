/**
 * Persistent LLM Client for TRAI
 * Uses Ollama HTTP API for fast inference
 *
 * CHANGE 630: Switched from ctransformers Python server to Ollama
 * - Ollama keeps model loaded in GPU RAM
 * - HTTP API is simpler and more reliable
 * - Uses custom 'trai' model with trading personality
 *
 * Usage:
 *   const client = new PersistentLLMClient();
 *   await client.initialize();
 *   const response = await client.generateResponse("Your prompt here");
 */

const http = require('http');

class PersistentLLMClient {
    constructor(config = {}) {
        this.host = config.host || 'localhost';
        this.port = config.port || 11434;
        this.model = config.model || 'trai';  // Our custom trading model
        this.isReady = false;
        this.requestCount = 0;
        this.totalLatency = 0;
    }

    /**
     * Initialize - verify Ollama is running and model is available
     */
    async initialize() {
        console.log('🚀 Connecting to Ollama for TRAI inference...');

        try {
            // Check if Ollama is running by listing models
            const models = await this._makeRequest('/api/tags', 'GET');

            // Check if our model exists
            const modelList = models.models || [];
            const hasTraiModel = modelList.some(m => m.name === this.model || m.name === `${this.model}:latest`);

            if (!hasTraiModel) {
                console.warn(`⚠️ Model '${this.model}' not found. Available: ${modelList.map(m => m.name).join(', ')}`);
                console.log('💡 Falling back to deepseek-r1:8b if available...');

                const hasDeepseek = modelList.some(m => m.name.includes('deepseek'));
                if (hasDeepseek) {
                    this.model = 'deepseek-r1:8b';
                    console.log(`✅ Using fallback model: ${this.model}`);
                } else {
                    throw new Error(`No suitable model found. Run: ollama create trai -f trai_brain/Modelfile.trai`);
                }
            }

            // Warm up the model with a quick inference
            console.log(`🔥 Warming up ${this.model} model...`);
            const warmupStart = Date.now();
            await this.generateResponse('Hello', 100);  // Reasoning models need room for <think> blocks
            const warmupTime = Date.now() - warmupStart;
            console.log(`✅ Model warm-up complete (${warmupTime}ms)`);

            this.isReady = true;
            console.log(`✅ TRAI Ollama Client Ready! Model: ${this.model}`);

        } catch (error) {
            console.error('❌ Failed to connect to Ollama:', error.message);
            console.log('💡 Make sure Ollama is running: systemctl status ollama');
            throw error;
        }
    }

    /**
     * Generate response using Ollama (FAST with model in GPU!)
     * @param {string} prompt - The prompt to send
     * @param {number} maxTokens - Max tokens to generate (num_predict in Ollama)
     * @returns {Promise<string>} - The generated response
     */
    async generateResponse(prompt, maxTokens = 1000) {
        if (!this.isReady && this.requestCount > 0) {
            throw new Error('TRAI Ollama Client not ready');
        }

        const startTime = Date.now();

        try {
            const response = await this._makeRequest('/api/generate', 'POST', {
                model: this.model,
                prompt: prompt,
                stream: false,
                keep_alive: '20m',  // Keep model in VRAM between 15-min cycles
                options: {
                    num_predict: maxTokens,
                    temperature: 0.6,  // Match Modelfile setting
                    stop: ['<|end▁of▁sentence|>', '<｜end▁of▁sentence｜>']
                }
            });

            const latency = Date.now() - startTime;
            this.requestCount++;
            this.totalLatency += latency;

            // Log slow responses
            if (latency > 8000) {
                console.warn(`⚠️ Slow TRAI inference: ${latency}ms`);
            }

            // Extract and clean response
            let text = response.response || '';

            // DEBUG: Log raw response to see what we're getting
            console.log('🔍 [TRAI DEBUG] Raw response length:', text.length);
            console.log('🔍 [TRAI DEBUG] Has <think>:', text.includes('<think>'));
            console.log('🔍 [TRAI DEBUG] Has </think>:', text.includes('</think>'));
            if (text.length < 500) {
                console.log('🔍 [TRAI DEBUG] Raw:', text.substring(0, 200));
            }

            // CHANGE 2026-01-31: Smarter thinking tag cleanup
            // Only remove complete <think>...</think> blocks, preserve text after
            if (text.includes('<think>') && text.includes('</think>')) {
                // Complete block - remove just the block
                text = text.replace(/<think>[\s\S]*?<\/think>/g, '');
            } else if (text.includes('<think>') && !text.includes('</think>')) {
                // Incomplete block - model cut off mid-thought
                // Try to find if there's text BEFORE the <think> tag
                const thinkIndex = text.indexOf('<think>');
                if (thinkIndex > 10) {
                    // There's content before <think>, keep it
                    text = text.substring(0, thinkIndex);
                } else {
                    // <think> is at start, response is all thinking - use fallback
                    text = '';
                }
            }
            // Remove any orphan </think> tags
            text = text.replace(/<\/think>/g, '');
            // Remove garbage/partial tokens that sometimes appear before <think>
            text = text.replace(/^[a-z]{1,5}<think/i, '');

            // CHANGE 2026-01-31: Clean leading garbage (punctuation, newlines at start)
            text = text.replace(/^[\s.,;:!?\-\n\r]+/, '');

            // CHANGE 2026-01-31: Remove LLM output labels (model sometimes prefixes with field names)
            text = text.replace(/^(advice|response|answer|output|result|reply|indicates|analysis|recommendation|summary)[\s:]+/i, '');

            // CHANGE 2026-01-31: If sentence is cut off (doesn't end with punctuation),
            // try to end at last complete sentence
            text = text.trim();
            if (text.length > 20 && !/[.!?]$/.test(text)) {
                // Find last sentence-ending punctuation
                const lastPeriod = text.lastIndexOf('.');
                const lastQuestion = text.lastIndexOf('?');
                const lastExclaim = text.lastIndexOf('!');
                const lastEnd = Math.max(lastPeriod, lastQuestion, lastExclaim);
                if (lastEnd > text.length * 0.5) {
                    // Only truncate if we're keeping at least half the response
                    text = text.substring(0, lastEnd + 1);
                }
            }

            // Final cleanup
            text = text.trim();

            // If response is empty after cleaning, return a fallback
            if (!text || text.length < 5) {
                console.warn('⚠️ TRAI response empty after cleaning, using fallback');
                text = 'I understand your question. Based on current market conditions, I recommend staying cautious and monitoring key levels.';
            }

            return text;

        } catch (error) {
            console.error('❌ TRAI inference error:', error.message);
            throw error;
        }
    }

    /**
     * Make HTTP request to Ollama API
     */
    _makeRequest(path, method = 'GET', body = null) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: this.host,
                port: this.port,
                path: path,
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 60000  // 60s timeout for reasoning models
            };

            const req = http.request(options, (res) => {
                let data = '';

                res.on('data', chunk => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json);
                    } catch (e) {
                        // If not JSON, return raw
                        resolve({ response: data });
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (body) {
                req.write(JSON.stringify(body));
            }

            req.end();
        });
    }

    /**
     * Shutdown - nothing to do for HTTP client
     */
    shutdown() {
        console.log('🛑 TRAI Ollama Client shutdown');
        this.isReady = false;
    }

    /**
     * Get client status and stats
     */
    getStatus() {
        return {
            ready: this.isReady,
            model: this.model,
            requestCount: this.requestCount,
            avgLatency: this.requestCount > 0 ? Math.round(this.totalLatency / this.requestCount) : 0,
            host: `${this.host}:${this.port}`
        };
    }
}

module.exports = PersistentLLMClient;
