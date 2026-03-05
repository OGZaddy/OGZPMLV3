// OGZNeuralBrain.js - Advanced Neural Network Trading Brain
// Reinforcement Learning with Win/Loss feedback for OGZPrime

const fs = require('fs');
const path = require('path');

class OGZNeuralBrain {
    constructor(options = {}) {
        this.learningRate = options.learningRate || 0.001;
        this.memorySize = options.memorySize || 10000;
        this.batchSize = options.batchSize || 32;
        this.epsilon = options.epsilon || 0.1; // Exploration rate
        this.epsilonDecay = options.epsilonDecay || 0.995;
        this.gamma = options.gamma || 0.95; // Discount factor
        
        // Network architecture
        this.inputSize = 50; // Market features
        this.hiddenSize = 128;
        this.outputSize = 3; // Buy, Hold, Sell
        
        // Initialize networks
        this.qNetwork = this.initializeNetwork();
        this.targetNetwork = this.cloneNetwork(this.qNetwork);
        
        // Experience replay memory
        this.memory = [];
        this.memoryIndex = 0;
        
        // Performance tracking
        this.wins = 0;
        this.losses = 0;
        this.totalReward = 0;
        
        // Load previous learning if exists
        this.loadBrain();
    }

    // Activation functions
    activationFunctions = {
        relu: x => Math.max(0, x),
        sigmoid: x => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x)))),
        tanh: x => Math.tanh(x),
        softmax: arr => {
            const max = Math.max(...arr);
            const exp = arr.map(x => Math.exp(x - max));
            const sum = exp.reduce((a, b) => a + b);
            return exp.map(x => x / sum);
        }
    };

    initializeNetwork() {
        return {
            // Input layer to hidden layer
            w1: this.randomMatrix(this.inputSize, this.hiddenSize),
            b1: this.randomArray(this.hiddenSize),
            
            // Hidden layer to output layer  
            w2: this.randomMatrix(this.hiddenSize, this.outputSize),
            b2: this.randomArray(this.outputSize)
        };
    }

    randomMatrix(rows, cols) {
        const matrix = [];
        for (let i = 0; i < rows; i++) {
            matrix[i] = [];
            for (let j = 0; j < cols; j++) {
                matrix[i][j] = (Math.random() - 0.5) * 0.2; // Xavier initialization
            }
        }
        return matrix;
    }

    randomArray(size) {
        return Array(size).fill(0).map(() => (Math.random() - 0.5) * 0.2);
    }

    // Forward pass through neural network
    predict(marketFeatures) {
        // Normalize inputs
        const normalizedInputs = this.normalizeInputs(marketFeatures);
        
        // Input to hidden layer (with ReLU activation)
        const hidden = [];
        for (let i = 0; i < this.hiddenSize; i++) {
            let sum = this.qNetwork.b1[i];
            for (let j = 0; j < this.inputSize; j++) {
                sum += normalizedInputs[j] * this.qNetwork.w1[j][i];
            }
            hidden[i] = this.activationFunctions.relu(sum);
        }
        
        // Hidden to output layer
        const output = [];
        for (let i = 0; i < this.outputSize; i++) {
            let sum = this.qNetwork.b2[i];
            for (let j = 0; j < this.hiddenSize; j++) {
                sum += hidden[j] * this.qNetwork.w2[j][i];
            }
            output[i] = sum;
        }
        
        // Apply softmax for action probabilities
        return this.activationFunctions.softmax(output);
    }

    // Main decision function
    makeDecision(marketData) {
        const features = this.extractFeatures(marketData);
        const qValues = this.predict(features);
        
        // Epsilon-greedy exploration
        if (Math.random() < this.epsilon) {
            // Explore: random action
            return {
                action: Math.floor(Math.random() * 3), // 0=Sell, 1=Hold, 2=Buy
                confidence: 0.5,
                qValues: qValues,
                reasoning: 'Exploration'
            };
        }
        
        // Exploit: best action
        const bestAction = qValues.indexOf(Math.max(...qValues));
        const confidence = Math.max(...qValues);
        
        return {
            action: bestAction,
            confidence: confidence,
            qValues: qValues,
            reasoning: this.explainDecision(features, qValues, bestAction)
        };
    }

    // Extract market features for neural network
    extractFeatures(marketData) {
        const features = [];
        
        // Price-based features
        features.push(marketData.rsi / 100); // Normalized RSI
        features.push(marketData.macd / marketData.price); // Normalized MACD
        features.push(marketData.bbPercent || 0.5); // Bollinger Band position
        features.push(marketData.volume / marketData.avgVolume || 1); // Volume ratio
        
        // Trend features
        features.push(marketData.sma20Slope || 0); // Trend direction
        features.push(marketData.ema12Slope || 0);
        features.push(marketData.priceVsSMA20 || 0); // Price relative to moving average
        
        // Volatility features
        features.push(marketData.atr / marketData.price || 0); // Normalized ATR
        features.push(marketData.volatility || 0);
        
        // Time-based features
        const hour = new Date().getHours();
        features.push(hour / 24); // Time of day
        features.push(Math.sin(2 * Math.PI * hour / 24)); // Cyclical time
        features.push(Math.cos(2 * Math.PI * hour / 24));
        
        // Pad or truncate to exact input size
        while (features.length < this.inputSize) {
            features.push(0);
        }
        return features.slice(0, this.inputSize);
    }

    // Learn from trade outcomes (WIN/LOSS FEEDBACK)
    learnFromTrade(state, action, reward, nextState, done) {
        // Store experience in replay memory
        const experience = {
            state: state,
            action: action,
            reward: reward,
            nextState: nextState,
            done: done
        };
        
        this.storeExperience(experience);
        
        // Update win/loss statistics
        if (reward > 0) {
            this.wins++;
            console.log(`🎉 WIN! Reward: ${reward.toFixed(4)} | Win Rate: ${(this.wins/(this.wins+this.losses)*100).toFixed(1)}%`);
        } else if (reward < 0) {
            this.losses++;
            console.log(`❌ LOSS! Reward: ${reward.toFixed(4)} | Win Rate: ${(this.wins/(this.wins+this.losses)*100).toFixed(1)}%`);
        }
        
        this.totalReward += reward;
        
        // Train if we have enough experiences
        if (this.memory.length >= this.batchSize) {
            this.trainNetwork();
        }
        
        // Decay exploration rate
        this.epsilon = Math.max(0.01, this.epsilon * this.epsilonDecay);
    }

    storeExperience(experience) {
        if (this.memory.length < this.memorySize) {
            this.memory.push(experience);
        } else {
            this.memory[this.memoryIndex] = experience;
            this.memoryIndex = (this.memoryIndex + 1) % this.memorySize;
        }
    }

    // Neural network training with backpropagation
    trainNetwork() {
        // Sample random batch from memory
        const batch = this.sampleBatch();
        
        // Calculate target Q-values
        const targets = this.calculateTargets(batch);
        
        // Perform gradient descent
        this.backpropagate(batch, targets);
        
        // Update target network periodically
        if (Math.random() < 0.01) { // 1% chance each training step
            this.updateTargetNetwork();
        }
    }

    sampleBatch() {
        const batch = [];
        for (let i = 0; i < this.batchSize; i++) {
            const randomIndex = Math.floor(Math.random() * this.memory.length);
            batch.push(this.memory[randomIndex]);
        }
        return batch;
    }

    calculateTargets(batch) {
        const targets = [];
        
        for (const experience of batch) {
            const currentQ = this.predict(experience.state);
            const target = [...currentQ];
            
            if (experience.done) {
                target[experience.action] = experience.reward;
            } else {
                const nextQ = this.predict(experience.nextState);
                const maxNextQ = Math.max(...nextQ);
                target[experience.action] = experience.reward + this.gamma * maxNextQ;
            }
            
            targets.push(target);
        }
        
        return targets;
    }

    // Simplified backpropagation
    backpropagate(batch, targets) {
        const learningRate = this.learningRate;
        
        // Accumulate gradients
        const gradients = {
            w1: this.zeroMatrix(this.inputSize, this.hiddenSize),
            b1: this.zeroArray(this.hiddenSize),
            w2: this.zeroMatrix(this.hiddenSize, this.outputSize),
            b2: this.zeroArray(this.outputSize)
        };
        
        for (let i = 0; i < batch.length; i++) {
            const state = batch[i].state;
            const target = targets[i];
            
            // Forward pass to get predictions and intermediate values
            const { hidden, output } = this.forwardPassWithCache(state);
            
            // Calculate output layer gradients
            const outputError = [];
            for (let j = 0; j < this.outputSize; j++) {
                outputError[j] = output[j] - target[j];
            }
            
            // Update output layer weights and biases
            for (let j = 0; j < this.hiddenSize; j++) {
                for (let k = 0; k < this.outputSize; k++) {
                    gradients.w2[j][k] += hidden[j] * outputError[k];
                }
            }
            
            for (let j = 0; j < this.outputSize; j++) {
                gradients.b2[j] += outputError[j];
            }
            
            // Calculate hidden layer gradients
            const hiddenError = [];
            for (let j = 0; j < this.hiddenSize; j++) {
                let error = 0;
                for (let k = 0; k < this.outputSize; k++) {
                    error += outputError[k] * this.qNetwork.w2[j][k];
                }
                // ReLU derivative
                hiddenError[j] = hidden[j] > 0 ? error : 0;
            }
            
            // Update hidden layer weights and biases
            for (let j = 0; j < this.inputSize; j++) {
                for (let k = 0; k < this.hiddenSize; k++) {
                    gradients.w1[j][k] += state[j] * hiddenError[k];
                }
            }
            
            for (let j = 0; j < this.hiddenSize; j++) {
                gradients.b1[j] += hiddenError[j];
            }
        }
        
        // Apply gradients
        this.applyGradients(gradients, learningRate / batch.length);
    }

    forwardPassWithCache(state) {
        // Hidden layer
        const hidden = [];
        for (let i = 0; i < this.hiddenSize; i++) {
            let sum = this.qNetwork.b1[i];
            for (let j = 0; j < this.inputSize; j++) {
                sum += state[j] * this.qNetwork.w1[j][i];
            }
            hidden[i] = this.activationFunctions.relu(sum);
        }
        
        // Output layer
        const output = [];
        for (let i = 0; i < this.outputSize; i++) {
            let sum = this.qNetwork.b2[i];
            for (let j = 0; j < this.hiddenSize; j++) {
                sum += hidden[j] * this.qNetwork.w2[j][i];
            }
            output[i] = sum;
        }
        
        return { hidden, output };
    }

    applyGradients(gradients, lr) {
        // Update weights and biases
        for (let i = 0; i < this.inputSize; i++) {
            for (let j = 0; j < this.hiddenSize; j++) {
                this.qNetwork.w1[i][j] -= lr * gradients.w1[i][j];
            }
        }
        
        for (let i = 0; i < this.hiddenSize; i++) {
            this.qNetwork.b1[i] -= lr * gradients.b1[i];
            
            for (let j = 0; j < this.outputSize; j++) {
                this.qNetwork.w2[i][j] -= lr * gradients.w2[i][j];
            }
        }
        
        for (let i = 0; i < this.outputSize; i++) {
            this.qNetwork.b2[i] -= lr * gradients.b2[i];
        }
    }

    // Utility functions
    normalizeInputs(inputs) {
        // Simple normalization - could be enhanced with running statistics
        return inputs.map(x => Math.max(-3, Math.min(3, x))); // Clip to [-3, 3]
    }

    explainDecision(features, qValues, action) {
        const actions = ['SELL', 'HOLD', 'BUY'];
        const confidence = qValues[action] * 100;
        
        return `Neural network chose ${actions[action]} with ${confidence.toFixed(1)}% confidence. RSI: ${(features[0]*100).toFixed(1)}, Trend: ${features[4] > 0 ? 'UP' : 'DOWN'}`;
    }

    cloneNetwork(network) {
        return JSON.parse(JSON.stringify(network));
    }

    updateTargetNetwork() {
        this.targetNetwork = this.cloneNetwork(this.qNetwork);
    }

    zeroMatrix(rows, cols) {
        return Array(rows).fill(0).map(() => Array(cols).fill(0));
    }

    zeroArray(size) {
        return Array(size).fill(0);
    }

    // Performance metrics
    getPerformanceStats() {
        const totalTrades = this.wins + this.losses;
        const winRate = totalTrades > 0 ? (this.wins / totalTrades) * 100 : 0;
        
        return {
            totalTrades,
            wins: this.wins,
            losses: this.losses,
            winRate: winRate.toFixed(2),
            totalReward: this.totalReward.toFixed(4),
            avgRewardPerTrade: totalTrades > 0 ? (this.totalReward / totalTrades).toFixed(4) : 0,
            epsilon: this.epsilon.toFixed(3)
        };
    }

    // Save and load brain state
    saveBrain() {
        const brainState = {
            qNetwork: this.qNetwork,
            targetNetwork: this.targetNetwork,
            memory: this.memory.slice(-1000), // Save last 1000 experiences
            wins: this.wins,
            losses: this.losses,
            totalReward: this.totalReward,
            epsilon: this.epsilon
        };
        
        const savePath = path.join(__dirname, 'neural_brain_state.json');
        fs.writeFileSync(savePath, JSON.stringify(brainState, null, 2));
        console.log(`🧠 Neural brain saved to ${savePath}`);
    }

    loadBrain() {
        const savePath = path.join(__dirname, 'neural_brain_state.json');
        
        if (fs.existsSync(savePath)) {
            try {
                const brainState = JSON.parse(fs.readFileSync(savePath, 'utf8'));
                
                this.qNetwork = brainState.qNetwork;
                this.targetNetwork = brainState.targetNetwork;
                this.memory = brainState.memory || [];
                this.wins = brainState.wins || 0;
                this.losses = brainState.losses || 0;
                this.totalReward = brainState.totalReward || 0;
                this.epsilon = brainState.epsilon || this.epsilon;
                
                console.log(`🧠 Neural brain loaded! Win rate: ${((this.wins/(this.wins+this.losses))*100).toFixed(1)}%`);
            } catch (error) {
                console.log('⚠️ Could not load neural brain state, starting fresh');
            }
        }
    }
}

module.exports = OGZNeuralBrain;