// QuantumTradePredictor.js - Revolutionary market prediction using quantum-inspired algorithms
// This module uses advanced mathematical concepts never before applied to trading

const EventEmitter = require('events');

/**
 * Quantum State Superposition for Market Analysis
 * Treats market states as quantum superpositions that collapse into trades
 */
class QuantumMarketState {
    constructor() {
        // Quantum state vectors for different market conditions
        this.stateVectors = {
            bullish: { amplitude: 0, phase: 0 },
            bearish: { amplitude: 0, phase: 0 },
            neutral: { amplitude: 0, phase: 1 }
        };
        
        // Entanglement matrix - how different market factors influence each other
        this.entanglementMatrix = [
            [1.0, 0.3, -0.2],  // Price correlation
            [0.3, 1.0, 0.1],   // Volume correlation
            [-0.2, 0.1, 1.0]   // Volatility correlation
        ];
        
        // Wave function collapse threshold
        this.collapseThreshold = 0.75;
        
        // Decoherence rate (how fast quantum states decay)
        this.decoherenceRate = 0.01;
    }
    
    /**
     * Update quantum state based on market observations
     */
    updateState(marketData) {
        const { price, volume, volatility, momentum } = marketData;
        
        // Calculate quantum amplitudes
        const bullishAmplitude = this.calculateBullishAmplitude(price, volume, momentum);
        const bearishAmplitude = this.calculateBearishAmplitude(price, volume, momentum);
        
        // Update state vectors with quantum interference
        this.stateVectors.bullish.amplitude = bullishAmplitude;
        this.stateVectors.bearish.amplitude = bearishAmplitude;
        this.stateVectors.neutral.amplitude = 1 - Math.abs(bullishAmplitude - bearishAmplitude);
        
        // Apply quantum phase based on volatility
        this.stateVectors.bullish.phase = Math.sin(volatility * Math.PI);
        this.stateVectors.bearish.phase = Math.cos(volatility * Math.PI);
        
        // Apply decoherence
        this.applyDecoherence();
    }
    
    /**
     * Calculate bullish quantum amplitude
     */
    calculateBullishAmplitude(price, volume, momentum) {
        // Quantum harmonic oscillator model
        const priceOscillation = Math.sin(price * 0.01) * 0.5 + 0.5;
        const volumeAmplification = Math.tanh(volume / 1000000); // Normalize volume
        const momentumWave = (momentum + 1) / 2; // Normalize to 0-1
        
        // Quantum interference pattern
        return (priceOscillation * 0.4 + volumeAmplification * 0.3 + momentumWave * 0.3);
    }
    
    /**
     * Calculate bearish quantum amplitude
     */
    calculateBearishAmplitude(price, volume, momentum) {
        // Inverse quantum harmonic oscillator
        const priceOscillation = Math.cos(price * 0.01) * 0.5 + 0.5;
        const volumeSuppression = 1 - Math.tanh(volume / 1000000);
        const momentumWave = (-momentum + 1) / 2;
        
        return (priceOscillation * 0.4 + volumeSuppression * 0.3 + momentumWave * 0.3);
    }
    
    /**
     * Apply quantum decoherence (state decay)
     */
    applyDecoherence() {
        Object.values(this.stateVectors).forEach(state => {
            state.amplitude *= (1 - this.decoherenceRate);
        });
    }
    
    /**
     * Measure quantum state (causes wave function collapse)
     */
    measure() {
        // Calculate probability amplitudes
        const totalAmplitude = Object.values(this.stateVectors)
            .reduce((sum, state) => sum + Math.pow(state.amplitude, 2), 0);
        
        if (totalAmplitude < this.collapseThreshold) {
            return { state: 'uncertain', confidence: totalAmplitude };
        }
        
        // Collapse to most probable state
        let maxAmplitude = 0;
        let collapsedState = 'neutral';
        
        for (const [state, vector] of Object.entries(this.stateVectors)) {
            const probability = Math.pow(vector.amplitude, 2) / totalAmplitude;
            if (probability > maxAmplitude) {
                maxAmplitude = probability;
                collapsedState = state;
            }
        }
        
        return {
            state: collapsedState,
            confidence: maxAmplitude,
            phase: this.stateVectors[collapsedState].phase
        };
    }
    
    /**
     * Get quantum entanglement score between market factors
     */
    getEntanglementScore(factor1, factor2) {
        const factorMap = { price: 0, volume: 1, volatility: 2 };
        const i = factorMap[factor1] || 0;
        const j = factorMap[factor2] || 0;
        
        return this.entanglementMatrix[i][j];
    }
}

/**
 * Fractal Pattern Analyzer - Identifies self-similar patterns across timeframes
 */
class FractalPatternAnalyzer {
    constructor() {
        this.fractalDimension = 1.618; // Golden ratio for natural patterns
        this.scales = [1, 5, 15, 60, 240]; // Timeframe scales in minutes
        this.fractalMemory = new Map();
        this.maxMemorySize = 1000;
    }
    
    /**
     * Analyze fractal patterns in price data
     */
    analyzeFractals(priceData, timeframe = 1) {
        if (!priceData || priceData.length < 10) return null;
        
        // Calculate fractal dimension using box-counting method
        const dimension = this.calculateFractalDimension(priceData);
        
        // Find self-similar patterns
        const patterns = this.findSelfSimilarPatterns(priceData, dimension);
        
        // Calculate fractal strength
        const strength = this.calculateFractalStrength(patterns);
        
        // Store in fractal memory
        const fractalKey = this.generateFractalKey(priceData);
        this.fractalMemory.set(fractalKey, {
            dimension,
            patterns,
            strength,
            timeframe,
            timestamp: Date.now()
        });
        
        // Prune old fractals
        if (this.fractalMemory.size > this.maxMemorySize) {
            const oldestKey = this.fractalMemory.keys().next().value;
            this.fractalMemory.delete(oldestKey);
        }
        
        return {
            dimension,
            strength,
            patternCount: patterns.length,
            prediction: this.predictFromFractals(patterns, dimension)
        };
    }
    
    /**
     * Calculate fractal dimension of price series
     */
    calculateFractalDimension(prices) {
        const n = prices.length;
        let boxSizes = [];
        let boxCounts = [];
        
        // Try different box sizes
        for (let size = 2; size < n / 4; size *= 2) {
            let count = 0;
            
            for (let i = 0; i < n - size; i += size) {
                const segment = prices.slice(i, i + size);
                const range = Math.max(...segment) - Math.min(...segment);
                
                if (range > 0) {
                    count += Math.ceil(range / (prices[i] * 0.001)); // 0.1% boxes
                }
            }
            
            if (count > 0) {
                boxSizes.push(Math.log(size));
                boxCounts.push(Math.log(count));
            }
        }
        
        // Calculate dimension using linear regression
        if (boxSizes.length < 2) return this.fractalDimension;
        
        const n_boxes = boxSizes.length;
        const sumX = boxSizes.reduce((a, b) => a + b, 0);
        const sumY = boxCounts.reduce((a, b) => a + b, 0);
        const sumXY = boxSizes.reduce((sum, x, i) => sum + x * boxCounts[i], 0);
        const sumX2 = boxSizes.reduce((sum, x) => sum + x * x, 0);
        
        const slope = (n_boxes * sumXY - sumX * sumY) / (n_boxes * sumX2 - sumX * sumX);
        
        return Math.abs(slope);
    }
    
    /**
     * Find self-similar patterns using wavelets
     */
    findSelfSimilarPatterns(prices, dimension) {
        const patterns = [];
        const windowSize = Math.floor(dimension * 5); // Base window on fractal dimension
        
        for (let i = windowSize; i < prices.length - windowSize; i++) {
            const pattern = prices.slice(i - windowSize, i);
            const future = prices.slice(i, i + windowSize);
            
            // Calculate pattern similarity using correlation
            const similarity = this.calculatePatternSimilarity(pattern, future);
            
            if (similarity > 0.7) { // High similarity threshold
                patterns.push({
                    index: i,
                    similarity,
                    pattern: this.normalizePattern(pattern),
                    outcome: future[future.length - 1] > future[0] ? 'bullish' : 'bearish'
                });
            }
        }
        
        return patterns;
    }
    
    /**
     * Calculate similarity between two patterns
     */
    calculatePatternSimilarity(pattern1, pattern2) {
        if (pattern1.length !== pattern2.length) return 0;
        
        // Normalize patterns
        const norm1 = this.normalizePattern(pattern1);
        const norm2 = this.normalizePattern(pattern2);
        
        // Calculate correlation coefficient
        const n = norm1.length;
        const sum1 = norm1.reduce((a, b) => a + b, 0);
        const sum2 = norm2.reduce((a, b) => a + b, 0);
        const sum1Sq = norm1.reduce((sum, val) => sum + val * val, 0);
        const sum2Sq = norm2.reduce((sum, val) => sum + val * val, 0);
        const pSum = norm1.reduce((sum, val, i) => sum + val * norm2[i], 0);
        
        const num = pSum - (sum1 * sum2 / n);
        const den = Math.sqrt((sum1Sq - sum1 * sum1 / n) * (sum2Sq - sum2 * sum2 / n));
        
        return den === 0 ? 0 : num / den;
    }
    
    /**
     * Normalize pattern to 0-1 range
     */
    normalizePattern(pattern) {
        const min = Math.min(...pattern);
        const max = Math.max(...pattern);
        const range = max - min;
        
        if (range === 0) return pattern.map(() => 0.5);
        
        return pattern.map(val => (val - min) / range);
    }
    
    /**
     * Calculate fractal strength
     */
    calculateFractalStrength(patterns) {
        if (patterns.length === 0) return 0;
        
        const avgSimilarity = patterns.reduce((sum, p) => sum + p.similarity, 0) / patterns.length;
        const consistency = patterns.filter(p => p.outcome === patterns[0].outcome).length / patterns.length;
        
        return avgSimilarity * consistency;
    }
    
    /**
     * Generate unique key for fractal pattern
     */
    generateFractalKey(prices) {
        // Use statistical properties as key
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        const variance = prices.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / prices.length;
        const skew = prices.length > 0 ? prices[prices.length - 1] / prices[0] : 1;
        
        return `${mean.toFixed(2)}_${variance.toFixed(2)}_${skew.toFixed(2)}`;
    }
    
    /**
     * Predict future movement from fractal patterns
     */
    predictFromFractals(patterns, dimension) {
        if (patterns.length === 0) {
            return { direction: 'neutral', confidence: 0 };
        }
        
        // Weight recent patterns more heavily
        let bullishScore = 0;
        let bearishScore = 0;
        
        patterns.forEach((pattern, index) => {
            const recencyWeight = (index + 1) / patterns.length;
            const weight = pattern.similarity * recencyWeight;
            
            if (pattern.outcome === 'bullish') {
                bullishScore += weight;
            } else {
                bearishScore += weight;
            }
        });
        
        // Apply fractal dimension as confidence modifier
        const dimensionConfidence = Math.abs(dimension - this.fractalDimension) < 0.2 ? 1.2 : 0.8;
        
        const totalScore = bullishScore + bearishScore;
        if (totalScore === 0) {
            return { direction: 'neutral', confidence: 0 };
        }
        
        const direction = bullishScore > bearishScore ? 'bullish' : 'bearish';
        const confidence = Math.max(bullishScore, bearishScore) / totalScore * dimensionConfidence;
        
        return { direction, confidence: Math.min(confidence, 1) };
    }
}

/**
 * Neural Market Network - Self-organizing neural network for market prediction
 */
class NeuralMarketNetwork {
    constructor() {
        this.neurons = this.initializeNeurons();
        this.connections = this.initializeConnections();
        this.plasticityRate = 0.01; // How fast the network adapts
        this.activationThreshold = 0.5;
        this.rewardDecay = 0.95;
    }
    
    /**
     * Initialize neural network with market-specific neurons
     */
    initializeNeurons() {
        return {
            // Input neurons
            price: { activation: 0, bias: 0.1 },
            volume: { activation: 0, bias: 0.1 },
            volatility: { activation: 0, bias: 0.1 },
            momentum: { activation: 0, bias: 0.1 },
            sentiment: { activation: 0, bias: 0.1 },
            
            // Hidden layer neurons
            pattern: { activation: 0, bias: 0.2 },
            trend: { activation: 0, bias: 0.2 },
            reversal: { activation: 0, bias: 0.2 },
            breakout: { activation: 0, bias: 0.2 },
            
            // Output neurons
            buy: { activation: 0, bias: 0.3 },
            sell: { activation: 0, bias: 0.3 },
            hold: { activation: 0, bias: 0.3 }
        };
    }
    
    /**
     * Initialize synaptic connections with random weights
     */
    initializeConnections() {
        const connections = {};
        const inputNeurons = ['price', 'volume', 'volatility', 'momentum', 'sentiment'];
        const hiddenNeurons = ['pattern', 'trend', 'reversal', 'breakout'];
        const outputNeurons = ['buy', 'sell', 'hold'];
        
        // Input to hidden connections
        inputNeurons.forEach(input => {
            connections[input] = {};
            hiddenNeurons.forEach(hidden => {
                connections[input][hidden] = Math.random() * 0.4 - 0.2; // -0.2 to 0.2
            });
        });
        
        // Hidden to output connections
        hiddenNeurons.forEach(hidden => {
            connections[hidden] = {};
            outputNeurons.forEach(output => {
                connections[hidden][output] = Math.random() * 0.4 - 0.2;
            });
        });
        
        return connections;
    }
    
    /**
     * Forward propagation through the network
     */
    propagate(marketData) {
        // Set input neuron activations
        this.neurons.price.activation = this.sigmoid(marketData.priceChange || 0);
        this.neurons.volume.activation = this.sigmoid(marketData.volumeRatio || 0);
        this.neurons.volatility.activation = this.sigmoid(marketData.volatility || 0);
        this.neurons.momentum.activation = this.sigmoid(marketData.momentum || 0);
        this.neurons.sentiment.activation = this.sigmoid(marketData.sentiment || 0);
        
        // Calculate hidden layer activations
        const hiddenNeurons = ['pattern', 'trend', 'reversal', 'breakout'];
        hiddenNeurons.forEach(hidden => {
            let sum = this.neurons[hidden].bias;
            
            ['price', 'volume', 'volatility', 'momentum', 'sentiment'].forEach(input => {
                sum += this.neurons[input].activation * this.connections[input][hidden];
            });
            
            this.neurons[hidden].activation = this.sigmoid(sum);
        });
        
        // Calculate output layer activations
        const outputNeurons = ['buy', 'sell', 'hold'];
        outputNeurons.forEach(output => {
            let sum = this.neurons[output].bias;
            
            hiddenNeurons.forEach(hidden => {
                sum += this.neurons[hidden].activation * this.connections[hidden][output];
            });
            
            this.neurons[output].activation = this.sigmoid(sum);
        });
        
        // Return decision
        return this.makeDecision();
    }
    
    /**
     * Sigmoid activation function
     */
    sigmoid(x) {
        return 1 / (1 + Math.exp(-x));
    }
    
    /**
     * Make trading decision based on output neurons
     */
    makeDecision() {
        const outputs = {
            buy: this.neurons.buy.activation,
            sell: this.neurons.sell.activation,
            hold: this.neurons.hold.activation
        };
        
        // Find strongest activation
        let maxActivation = 0;
        let decision = 'hold';
        
        for (const [action, activation] of Object.entries(outputs)) {
            if (activation > maxActivation && activation > this.activationThreshold) {
                maxActivation = activation;
                decision = action;
            }
        }
        
        // Calculate confidence based on activation strength and competition
        const totalActivation = Object.values(outputs).reduce((sum, val) => sum + val, 0);
        const confidence = maxActivation / totalActivation;
        
        return {
            decision,
            confidence,
            activations: outputs,
            strength: maxActivation
        };
    }
    
    /**
     * Learn from trading outcome using Hebbian plasticity
     */
    learn(outcome, reward) {
        // Adjust weights based on Hebbian rule: neurons that fire together, wire together
        
        // Update hidden to output connections
        ['pattern', 'trend', 'reversal', 'breakout'].forEach(hidden => {
            ['buy', 'sell', 'hold'].forEach(output => {
                const hiddenActivation = this.neurons[hidden].activation;
                const outputActivation = this.neurons[output].activation;
                
                // Strengthen connection if both neurons were active and outcome was good
                const strengthChange = this.plasticityRate * hiddenActivation * outputActivation * reward;
                this.connections[hidden][output] += strengthChange;
                
                // Apply weight decay to prevent unbounded growth
                this.connections[hidden][output] *= 0.99;
            });
        });
        
        // Update input to hidden connections
        ['price', 'volume', 'volatility', 'momentum', 'sentiment'].forEach(input => {
            ['pattern', 'trend', 'reversal', 'breakout'].forEach(hidden => {
                const inputActivation = this.neurons[input].activation;
                const hiddenActivation = this.neurons[hidden].activation;
                
                const strengthChange = this.plasticityRate * inputActivation * hiddenActivation * reward;
                this.connections[input][hidden] += strengthChange;
                this.connections[input][hidden] *= 0.99;
            });
        });
        
        // Update biases
        Object.values(this.neurons).forEach(neuron => {
            neuron.bias += this.plasticityRate * neuron.activation * reward * 0.1;
            neuron.bias = Math.max(-0.5, Math.min(0.5, neuron.bias)); // Clamp biases
        });
    }
    
    /**
     * Get network statistics
     */
    getNetworkStats() {
        const stats = {
            averageActivation: 0,
            strongestConnection: { from: '', to: '', weight: 0 },
            weakestConnection: { from: '', to: '', weight: 1 },
            totalConnections: 0
        };
        
        // Calculate average activation
        const neurons = Object.values(this.neurons);
        stats.averageActivation = neurons.reduce((sum, n) => sum + n.activation, 0) / neurons.length;
        
        // Find strongest and weakest connections
        for (const [from, targets] of Object.entries(this.connections)) {
            for (const [to, weight] of Object.entries(targets)) {
                stats.totalConnections++;
                
                if (Math.abs(weight) > Math.abs(stats.strongestConnection.weight)) {
                    stats.strongestConnection = { from, to, weight };
                }
                
                if (Math.abs(weight) < Math.abs(stats.weakestConnection.weight)) {
                    stats.weakestConnection = { from, to, weight };
                }
            }
        }
        
        return stats;
    }
}

/**
 * Quantum Trade Predictor - Main class that combines all prediction methods
 */
class QuantumTradePredictor extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            quantumEnabled: true,
            fractalEnabled: true,
            neuralEnabled: true,
            ensembleWeights: {
                quantum: 0.3,
                fractal: 0.3,
                neural: 0.4
            },
            minConfidence: 0.65,
            ...options
        };
        
        // Initialize components
        this.quantumState = new QuantumMarketState();
        this.fractalAnalyzer = new FractalPatternAnalyzer();
        this.neuralNetwork = new NeuralMarketNetwork();
        
        // Prediction history for learning
        this.predictionHistory = [];
        this.maxHistorySize = 100;
        
        // Performance metrics
        this.metrics = {
            predictions: 0,
            correct: 0,
            quantum: { predictions: 0, correct: 0 },
            fractal: { predictions: 0, correct: 0 },
            neural: { predictions: 0, correct: 0 }
        };
        
        console.log('🚀 Quantum Trade Predictor initialized');
    }
    
    /**
     * Make a prediction using all available methods
     */
    async predict(marketData) {
        const predictions = {};
        
        // Quantum prediction
        if (this.options.quantumEnabled) {
            predictions.quantum = this.quantumPredict(marketData);
        }
        
        // Fractal prediction
        if (this.options.fractalEnabled && marketData.priceHistory) {
            predictions.fractal = this.fractalPredict(marketData);
        }
        
        // Neural prediction
        if (this.options.neuralEnabled) {
            predictions.neural = this.neuralPredict(marketData);
        }
        
        // Ensemble prediction
        const ensemble = this.ensemblePrediction(predictions);
        
        // Store prediction for later verification
        const predictionRecord = {
            timestamp: Date.now(),
            marketData: { ...marketData },
            predictions,
            ensemble,
            verified: false
        };
        
        this.addToPredictionHistory(predictionRecord);
        this.metrics.predictions++;
        
        // Emit prediction event
        this.emit('prediction', {
            ...ensemble,
            components: predictions,
            timestamp: predictionRecord.timestamp
        });
        
        return ensemble;
    }
    
    /**
     * Quantum-based prediction
     */
    quantumPredict(marketData) {
        // Update quantum state
        this.quantumState.updateState({
            price: marketData.price || 0,
            volume: marketData.volume || 0,
            volatility: marketData.volatility || 0.01,
            momentum: marketData.momentum || 0
        });
        
        // Measure quantum state
        const measurement = this.quantumState.measure();
        
        // Convert quantum state to trading signal
        let signal = 'hold';
        if (measurement.state === 'bullish' && measurement.confidence > this.options.minConfidence) {
            signal = 'buy';
        } else if (measurement.state === 'bearish' && measurement.confidence > this.options.minConfidence) {
            signal = 'sell';
        }
        
        return {
            signal,
            confidence: measurement.confidence,
            phase: measurement.phase,
            state: measurement.state
        };
    }
    
    /**
     * Fractal-based prediction
     */
    fractalPredict(marketData) {
        const fractalAnalysis = this.fractalAnalyzer.analyzeFractals(marketData.priceHistory);
        
        if (!fractalAnalysis) {
            return { signal: 'hold', confidence: 0 };
        }
        
        // Convert fractal prediction to trading signal
        let signal = 'hold';
        if (fractalAnalysis.prediction.direction === 'bullish' && 
            fractalAnalysis.prediction.confidence > this.options.minConfidence) {
            signal = 'buy';
        } else if (fractalAnalysis.prediction.direction === 'bearish' && 
                   fractalAnalysis.prediction.confidence > this.options.minConfidence) {
            signal = 'sell';
        }
        
        return {
            signal,
            confidence: fractalAnalysis.prediction.confidence,
            dimension: fractalAnalysis.dimension,
            strength: fractalAnalysis.strength
        };
    }
    
    /**
     * Neural network-based prediction
     */
    neuralPredict(marketData) {
        // Prepare neural input
        const neuralInput = {
            priceChange: marketData.priceChange || 0,
            volumeRatio: marketData.volumeRatio || 1,
            volatility: marketData.volatility || 0.01,
            momentum: marketData.momentum || 0,
            sentiment: marketData.sentiment || 0
        };
        
        // Get neural network decision
        const decision = this.neuralNetwork.propagate(neuralInput);
        
        return {
            signal: decision.decision,
            confidence: decision.confidence,
            strength: decision.strength,
            activations: decision.activations
        };
    }
    
    /**
     * Combine predictions using weighted ensemble
     */
    ensemblePrediction(predictions) {
        const signals = { buy: 0, sell: 0, hold: 0 };
        let totalConfidence = 0;
        let weightSum = 0;
        
        // Weight each prediction
        for (const [method, prediction] of Object.entries(predictions)) {
            if (!prediction || !prediction.signal) continue;
            
            const weight = this.options.ensembleWeights[method] || 0.33;
            signals[prediction.signal] += weight * prediction.confidence;
            totalConfidence += weight * prediction.confidence;
            weightSum += weight;
        }
        
        // Normalize
        if (weightSum > 0) {
            Object.keys(signals).forEach(signal => {
                signals[signal] /= weightSum;
            });
            totalConfidence /= weightSum;
        }
        
        // Find strongest signal
        let bestSignal = 'hold';
        let maxScore = 0;
        
        for (const [signal, score] of Object.entries(signals)) {
            if (score > maxScore) {
                maxScore = score;
                bestSignal = signal;
            }
        }
        
        // Calculate signal strength (difference between best and second best)
        const scores = Object.values(signals).sort((a, b) => b - a);
        const strength = scores[0] - scores[1];
        
        return {
            signal: bestSignal,
            confidence: totalConfidence,
            strength,
            scores: signals,
            unanimous: Object.values(predictions).every(p => p.signal === bestSignal)
        };
    }
    
    /**
     * Add prediction to history
     */
    addToPredictionHistory(prediction) {
        this.predictionHistory.push(prediction);
        
        if (this.predictionHistory.length > this.maxHistorySize) {
            this.predictionHistory.shift();
        }
    }
    
    /**
     * Verify prediction outcome and update models
     */
    verifyPrediction(outcome) {
        // Find most recent unverified prediction
        const prediction = this.predictionHistory
            .filter(p => !p.verified)
            .sort((a, b) => b.timestamp - a.timestamp)[0];
        
        if (!prediction) return;
        
        prediction.verified = true;
        prediction.outcome = outcome;
        
        // Calculate if prediction was correct
        const correct = (
            (prediction.ensemble.signal === 'buy' && outcome.profit > 0) ||
            (prediction.ensemble.signal === 'sell' && outcome.profit > 0) ||
            (prediction.ensemble.signal === 'hold' && Math.abs(outcome.profit) < 0.001)
        );
        
        if (correct) {
            this.metrics.correct++;
        }
        
        // Update component metrics
        for (const [method, pred] of Object.entries(prediction.predictions)) {
            if (pred.signal === prediction.ensemble.signal) {
                this.metrics[method].predictions++;
                if (correct) {
                    this.metrics[method].correct++;
                }
            }
        }
        
        // Train neural network
        if (this.options.neuralEnabled) {
            const reward = correct ? 1 : -1;
            this.neuralNetwork.learn(outcome, reward * Math.abs(outcome.profit));
        }
        
        // Emit learning event
        this.emit('learning', {
            prediction: prediction.ensemble,
            outcome,
            correct,
            metrics: this.getMetrics()
        });
    }
    
    /**
     * Get performance metrics
     */
    getMetrics() {
        const overall = this.metrics.predictions > 0
            ? this.metrics.correct / this.metrics.predictions
            : 0;
        
        const componentMetrics = {};
        for (const method of ['quantum', 'fractal', 'neural']) {
            const m = this.metrics[method];
            componentMetrics[method] = {
                accuracy: m.predictions > 0 ? m.correct / m.predictions : 0,
                predictions: m.predictions
            };
        }
        
        return {
            overall,
            predictions: this.metrics.predictions,
            correct: this.metrics.correct,
            components: componentMetrics,
            ensembleWeights: this.options.ensembleWeights
        };
    }
    
    /**
     * Optimize ensemble weights based on performance
     */
    optimizeWeights() {
        const metrics = this.getMetrics();
        const components = metrics.components;
        
        // Calculate new weights based on accuracy
        let totalAccuracy = 0;
        const newWeights = {};
        
        for (const [method, stats] of Object.entries(components)) {
            if (stats.predictions > 10) { // Need enough data
                totalAccuracy += stats.accuracy;
            }
        }
        
        if (totalAccuracy > 0) {
            for (const [method, stats] of Object.entries(components)) {
                if (stats.predictions > 10) {
                    newWeights[method] = stats.accuracy / totalAccuracy;
                } else {
                    newWeights[method] = this.options.ensembleWeights[method];
                }
            }
            
            // Update weights with smoothing
            for (const method of ['quantum', 'fractal', 'neural']) {
                this.options.ensembleWeights[method] = 
                    0.7 * this.options.ensembleWeights[method] + 
                    0.3 * (newWeights[method] || 0.33);
            }
            
            console.log('🔧 Optimized ensemble weights:', this.options.ensembleWeights);
        }
    }
    
    /**
     * Get prediction insights
     */
    getInsights() {
        return {
            quantumState: this.quantumState.stateVectors,
            fractalMemorySize: this.fractalAnalyzer.fractalMemory.size,
            neuralStats: this.neuralNetwork.getNetworkStats(),
            recentPredictions: this.predictionHistory.slice(-5).map(p => ({
                timestamp: p.timestamp,
                signal: p.ensemble.signal,
                confidence: p.ensemble.confidence,
                verified: p.verified,
                correct: p.outcome ? (
                    (p.ensemble.signal === 'buy' && p.outcome.profit > 0) ||
                    (p.ensemble.signal === 'sell' && p.outcome.profit > 0)
                ) : null
            }))
        };
    }
}

module.exports = QuantumTradePredictor;