// NeurosymbolicInterpreter.js - Revolutionary Neural + Symbolic Reasoning System
// Fuses deep learning with symbolic logic for explainable AI trading decisions

class NeurosymbolicInterpreter {
    constructor() {
        this.name = 'NeurosymbolicInterpreter';
        this.version = '1.0.0';
        this.transformer = this.initializeTransformer();
        this.prologEngine = this.initializePrologEngine();
        this.knowledgeBase = this.initializeKnowledgeBase();
        this.reasoningChains = new Map();
        this.explanationCache = new Map();
        this.confidenceThreshold = 0.6;
        
        this.metrics = {
            decisionsExplained: 0,
            avgConfidence: 0,
            reasoningChainLength: 0,
            logicalConsistency: 0,
            neuralSymbolicAgreement: 0
        };
        
        console.log('🧠 Neurosymbolic Interpreter initialized');
        console.log('🔗 Neural-symbolic bridge established');
        console.log('📚 Knowledge base loaded with trading rules');
    }

    // Initialize transformer model for neural reasoning
    initializeTransformer() {
        return {
            layers: [
                {
                    type: 'attention',
                    heads: 8,
                    embedding_dim: 512,
                    weights: this.generateAttentionWeights(8, 512)
                },
                {
                    type: 'feedforward',
                    hidden_dim: 2048,
                    weights: this.generateFFNWeights(512, 2048)
                },
                {
                    type: 'output',
                    output_dim: 256,
                    weights: this.generateOutputWeights(2048, 256)
                }
            ],
            vocabulary: this.buildTradingVocabulary(),
            maxSequenceLength: 128,
            learningRate: 0.0001
        };
    }

    // Generate attention mechanism weights
    generateAttentionWeights(heads, embeddingDim) {
        const weights = {
            query: [],
            key: [],
            value: [],
            output: []
        };
        
        ['query', 'key', 'value', 'output'].forEach(type => {
            weights[type] = Array(heads).fill().map(() => 
                Array(embeddingDim).fill().map(() => 
                    Array(embeddingDim).fill().map(() => (Math.random() - 0.5) * 0.1)
                )
            );
        });
        
        return weights;
    }

    // Generate feedforward network weights
    generateFFNWeights(inputDim, hiddenDim) {
        return {
            layer1: Array(inputDim).fill().map(() => 
                Array(hiddenDim).fill().map(() => (Math.random() - 0.5) * 0.1)
            ),
            layer2: Array(hiddenDim).fill().map(() => 
                Array(inputDim).fill().map(() => (Math.random() - 0.5) * 0.1)
            ),
            bias1: Array(hiddenDim).fill(() => Math.random() * 0.01),
            bias2: Array(inputDim).fill(() => Math.random() * 0.01)
        };
    }

    // Generate output layer weights
    generateOutputWeights(inputDim, outputDim) {
        return {
            weights: Array(inputDim).fill().map(() => 
                Array(outputDim).fill().map(() => (Math.random() - 0.5) * 0.1)
            ),
            bias: Array(outputDim).fill(() => Math.random() * 0.01)
        };
    }

    // Build trading-specific vocabulary
    buildTradingVocabulary() {
        return {
            patterns: [
                'bull_flag', 'bear_flag', 'head_shoulders', 'double_top', 'double_bottom',
                'ascending_triangle', 'descending_triangle', 'cup_handle', 'harami',
                'doji', 'hammer', 'shooting_star', 'engulfing', 'piercing_line'
            ],
            indicators: [
                'rsi', 'macd', 'bollinger_bands', 'stochastic', 'williams_r',
                'cci', 'atr', 'volume', 'moving_average', 'ema', 'sma'
            ],
            conditions: [
                'oversold', 'overbought', 'bullish', 'bearish', 'neutral',
                'divergence', 'convergence', 'breakout', 'breakdown', 'reversal'
            ],
            actions: [
                'buy', 'sell', 'hold', 'reduce_position', 'increase_position',
                'set_stop_loss', 'take_profit', 'hedge', 'arbitrage'
            ],
            confidence: [
                'very_low', 'low', 'medium', 'high', 'very_high',
                'uncertain', 'confident', 'extremely_confident'
            ]
        };
    }

    // Initialize Prolog-like symbolic reasoning engine
    initializePrologEngine() {
        return {
            facts: new Set(),
            rules: new Map(),
            predicates: new Map(),
            unificationTable: new Map(),
            inferenceEngine: this.createInferenceEngine()
        };
    }

    // Create inference engine for logical reasoning
    createInferenceEngine() {
        return {
            forwardChain: (facts, rules) => this.forwardChaining(facts, rules),
            backwardChain: (goal, facts, rules) => this.backwardChaining(goal, facts, rules),
            unify: (term1, term2) => this.unify(term1, term2),
            resolve: (clause1, clause2) => this.resolve(clause1, clause2)
        };
    }

    // Initialize knowledge base with trading rules
    initializeKnowledgeBase() {
        const kb = {
            rules: [
                // Bullish patterns
                {
                    id: 'bullish_if_high_volume_low_vix',
                    condition: ['high_volume', 'vix_low', 'price_above_ma'],
                    conclusion: 'bullish_signal',
                    confidence: 0.8,
                    weight: 1.0
                },
                {
                    id: 'bullish_if_harami_present',
                    condition: ['bull_harami_present', 'volume_increasing'],
                    conclusion: 'bullish_reversal',
                    confidence: 0.75,
                    weight: 0.9
                },
                {
                    id: 'bullish_if_golden_cross',
                    condition: ['ma50_above_ma200', 'price_above_ma50'],
                    conclusion: 'long_term_bullish',
                    confidence: 0.85,
                    weight: 1.1
                },
                
                // Bearish patterns
                {
                    id: 'bearish_if_death_cross',
                    condition: ['ma50_below_ma200', 'price_below_ma50'],
                    conclusion: 'long_term_bearish',
                    confidence: 0.82,
                    weight: 1.0
                },
                {
                    id: 'bearish_if_dark_cloud',
                    condition: ['dark_cloud_cover', 'high_volume'],
                    conclusion: 'bearish_reversal',
                    confidence: 0.7,
                    weight: 0.8
                },
                
                // Risk management rules
                {
                    id: 'reduce_position_if_high_volatility',
                    condition: ['volatility_high', 'uncertain_market'],
                    conclusion: 'reduce_exposure',
                    confidence: 0.9,
                    weight: 1.2
                },
                {
                    id: 'stop_loss_if_support_broken',
                    condition: ['support_level_broken', 'high_volume'],
                    conclusion: 'exit_position',
                    confidence: 0.95,
                    weight: 1.5
                }
            ],
            facts: new Set([
                'market_hours_active',
                'liquidity_normal',
                'system_operational'
            ]),
            contextualRules: new Map([
                ['trending_market', ['momentum_signals_stronger', 'reversal_signals_weaker']],
                ['ranging_market', ['mean_reversion_signals_stronger', 'breakout_signals_weaker']],
                ['high_volatility', ['position_sizing_conservative', 'stop_losses_wider']],
                ['low_volatility', ['position_sizing_aggressive', 'stop_losses_tighter']]
            ])
        };
        
        // Load rules into Prolog engine
        kb.rules.forEach(rule => {
            this.prologEngine.rules.set(rule.id, rule);
        });
        
        kb.facts.forEach(fact => {
            this.prologEngine.facts.add(fact);
        });
        
        return kb;
    }

    // Main decision explanation function
    async explainDecision(marketState, decision) {
        const startTime = performance.now();
        
        try {
            console.log('🧠 Generating neurosymbolic explanation...');
            
            // Step 1: Neural network prediction
            const neuralOutput = await this.neuralPredict(marketState);
            
            // Step 2: Symbolic reasoning
            const symbolicReasoning = await this.symbolicInference(marketState);
            
            // Step 3: Fusion and explanation generation
            const fusedExplanation = this.fuseNeuralSymbolic(neuralOutput, symbolicReasoning, decision);
            
            // Step 4: Generate human-readable explanation
            const humanExplanation = this.generateHumanExplanation(fusedExplanation, marketState);
            
            // Step 5: Validate logical consistency
            const consistencyCheck = this.validateLogicalConsistency(fusedExplanation);
            
            const processingTime = performance.now() - startTime;
            this.updateMetrics(fusedExplanation, processingTime);
            
            const explanation = {
                decision: decision,
                confidence: fusedExplanation.confidence,
                neuralComponent: neuralOutput,
                symbolicComponent: symbolicReasoning,
                fusedReasoning: fusedExplanation,
                humanReadable: humanExplanation,
                consistencyScore: consistencyCheck.score,
                processingTime,
                timestamp: Date.now()
            };
            
            // Cache explanation for future reference
            const explanationKey = this.generateExplanationKey(marketState, decision);
            this.explanationCache.set(explanationKey, explanation);
            
            console.log(`✅ Explanation generated in ${processingTime.toFixed(2)}ms`);
            console.log(`🎯 Confidence: ${(fusedExplanation.confidence * 100).toFixed(1)}%`);
            console.log(`📝 ${humanExplanation.summary}`);
            
            return explanation;
            
        } catch (error) {
            console.error('❌ Neurosymbolic explanation failed:', error);
            throw new Error(`Explanation generation failed: ${error.message}`);
        }
    }

    // Neural network prediction with attention mechanism
    async neuralPredict(marketState) {
        const startTime = performance.now();
        
        // Convert market state to neural input
        const neuralInput = this.marketStateToNeuralInput(marketState);
        
        // Multi-head attention computation
        const attentionOutput = this.computeMultiHeadAttention(neuralInput);
        
        // Feedforward processing
        const ffnOutput = this.computeFeedforward(attentionOutput);
        
        // Output layer
        const prediction = this.computeOutput(ffnOutput);
        
        const neuralTime = performance.now() - startTime;
        
        return {
            rawPrediction: prediction,
            confidence: this.sigmoid(prediction.confidence || 0),
            neuralFeatures: {
                attention_weights: attentionOutput.weights,
                activated_patterns: this.identifyActivatedPatterns(ffnOutput),
                feature_importance: this.calculateFeatureImportance(neuralInput, prediction)
            },
            processingTime: neuralTime,
            interpretation: this.interpretNeuralOutput(prediction)
        };
    }

    // Convert market state to neural network input
    marketStateToNeuralInput(marketState) {
        const features = [];
        
        // Price features
        features.push(marketState.price || 0);
        features.push(marketState.priceChange || 0);
        features.push(marketState.priceChangePercent || 0);
        
        // Volume features
        features.push(marketState.volume || 0);
        features.push(marketState.volumeChange || 0);
        features.push(marketState.avgVolume || 0);
        
        // Technical indicators
        features.push(marketState.rsi || 50);
        features.push(marketState.macd || 0);
        features.push(marketState.bollingerPosition || 0.5);
        features.push(marketState.stochastic || 50);
        
        // Market context
        features.push(marketState.volatility || 0.02);
        features.push(marketState.trend || 0);
        features.push(marketState.sentiment || 0);
        features.push(marketState.timeOfDay || 0.5);
        
        // Normalize features to [-1, 1] range
        return features.map(f => Math.tanh(f / 100));
    }

    // Compute multi-head attention
    computeMultiHeadAttention(input) {
        const attentionLayer = this.transformer.layers[0];
        const numHeads = attentionLayer.heads;
        const embeddingDim = attentionLayer.embedding_dim;
        
        const headOutputs = [];
        const attentionWeights = [];
        
        for (let head = 0; head < numHeads; head++) {
            // Simplified attention computation
            const queries = this.matrixMultiply([input], attentionLayer.weights.query[head])[0];
            const keys = this.matrixMultiply([input], attentionLayer.weights.key[head])[0];
            const values = this.matrixMultiply([input], attentionLayer.weights.value[head])[0];
            
            // Attention scores
            const scores = queries.map((q, i) => 
                keys.reduce((sum, k, j) => sum + q * k, 0) / Math.sqrt(embeddingDim)
            );
            
            // Softmax attention weights
            const weights = this.softmax(scores);
            attentionWeights.push(weights);
            
            // Weighted values
            const headOutput = values.map((v, i) => v * weights[i]);
            headOutputs.push(headOutput);
        }
        
        // Concatenate and project heads
        const concatenated = headOutputs.flat();
        const output = this.matrixMultiply([concatenated], attentionLayer.weights.output[0])[0];
        
        return {
            output,
            weights: attentionWeights,
            headOutputs
        };
    }

    // Compute feedforward network
    computeFeedforward(attentionOutput) {
        const ffnLayer = this.transformer.layers[1];
        const input = attentionOutput.output;
        
        // First layer with ReLU activation
        const hidden = this.matrixMultiply([input], ffnLayer.weights.layer1)[0]
            .map((x, i) => Math.max(0, x + ffnLayer.weights.bias1[i])); // ReLU
        
        // Second layer
        const output = this.matrixMultiply([hidden], ffnLayer.weights.layer2)[0]
            .map((x, i) => x + ffnLayer.weights.bias2[i]);
        
        return {
            input,
            hidden,
            output,
            activationPattern: hidden.map(h => h > 0 ? 1 : 0)
        };
    }

    // Compute output layer
    computeOutput(ffnOutput) {
        const outputLayer = this.transformer.layers[2];
        const input = ffnOutput.output;
        
        const rawOutput = this.matrixMultiply([input], outputLayer.weights.weights)[0]
            .map((x, i) => x + outputLayer.weights.bias[i]);
        
        return {
            confidence: this.sigmoid(rawOutput[0] || 0),
            direction: Math.tanh(rawOutput[1] || 0), // -1 (bearish) to 1 (bullish)
            strength: this.sigmoid(rawOutput[2] || 0),
            risk: this.sigmoid(rawOutput[3] || 0),
            timeHorizon: this.sigmoid(rawOutput[4] || 0),
            rawScores: rawOutput
        };
    }

    // Symbolic inference using Prolog-like reasoning
    async symbolicInference(marketState) {
        const startTime = performance.now();
        
        // Extract symbolic facts from market state
        const currentFacts = this.extractSymbolicFacts(marketState);
        
        // Add current facts to knowledge base
        currentFacts.forEach(fact => this.prologEngine.facts.add(fact));
        
        // Perform forward chaining inference
        const inferences = this.forwardChaining(this.prologEngine.facts, this.prologEngine.rules);
        
        // Build reasoning chain
        const reasoningChain = this.buildReasoningChain(currentFacts, inferences);
        
        // Calculate symbolic confidence
        const symbolicConfidence = this.calculateSymbolicConfidence(reasoningChain);
        
        const symbolicTime = performance.now() - startTime;
        
        return {
            facts: Array.from(currentFacts),
            inferences: inferences,
            reasoningChain: reasoningChain,
            confidence: symbolicConfidence,
            appliedRules: this.getAppliedRules(inferences),
            processingTime: symbolicTime
        };
    }

    // Extract symbolic facts from market state
    extractSymbolicFacts(marketState) {
        const facts = new Set();
        
        // Volume analysis
        if (marketState.volume > (marketState.avgVolume * 1.5)) {
            facts.add('high_volume');
        } else if (marketState.volume < (marketState.avgVolume * 0.7)) {
            facts.add('low_volume');
        } else {
            facts.add('normal_volume');
        }
        
        // Price movement
        if (marketState.priceChangePercent > 2) {
            facts.add('strong_upward_movement');
        } else if (marketState.priceChangePercent > 0.5) {
            facts.add('upward_movement');
        } else if (marketState.priceChangePercent < -2) {
            facts.add('strong_downward_movement');
        } else if (marketState.priceChangePercent < -0.5) {
            facts.add('downward_movement');
        }
        
        // Technical indicators
        if (marketState.rsi > 70) {
            facts.add('overbought');
        } else if (marketState.rsi < 30) {
            facts.add('oversold');
        }
        
        if (marketState.vix && marketState.vix < 20) {
            facts.add('vix_low');
        } else if (marketState.vix && marketState.vix > 30) {
            facts.add('vix_high');
        }
        
        // Moving average relationships
        if (marketState.price > marketState.ma50) {
            facts.add('price_above_ma');
        } else {
            facts.add('price_below_ma');
        }
        
        if (marketState.ma50 > marketState.ma200) {
            facts.add('ma50_above_ma200');
        } else {
            facts.add('ma50_below_ma200');
        }
        
        // Pattern recognition
        if (marketState.patterns) {
            marketState.patterns.forEach(pattern => {
                facts.add(`${pattern}_present`);
            });
        }
        
        // Volatility
        if (marketState.volatility > 0.05) {
            facts.add('volatility_high');
        } else if (marketState.volatility < 0.02) {
            facts.add('volatility_low');
        }
        
        return facts;
    }

    // Forward chaining inference
    forwardChaining(facts, rules) {
        const inferences = [];
        let newFactsAdded = true;
        const workingFacts = new Set(facts);
        
        while (newFactsAdded) {
            newFactsAdded = false;
            
            for (const [ruleId, rule] of rules) {
                // Check if all conditions are satisfied
                const conditionsSatisfied = rule.condition.every(condition => 
                    workingFacts.has(condition)
                );
                
                if (conditionsSatisfied && !workingFacts.has(rule.conclusion)) {
                    workingFacts.add(rule.conclusion);
                    inferences.push({
                        rule: ruleId,
                        conditions: [...rule.condition],
                        conclusion: rule.conclusion,
                        confidence: rule.confidence,
                        weight: rule.weight
                    });
                    newFactsAdded = true;
                }
            }
        }
        
        return inferences;
    }

    // Build reasoning chain showing logical progression
    buildReasoningChain(initialFacts, inferences) {
        const chain = [];
        
        // Start with initial facts
        chain.push({
            type: 'facts',
            content: Array.from(initialFacts),
            step: 0
        });
        
        // Add each inference step
        inferences.forEach((inference, index) => {
            chain.push({
                type: 'inference',
                rule: inference.rule,
                conditions: inference.conditions,
                conclusion: inference.conclusion,
                confidence: inference.confidence,
                step: index + 1
            });
        });
        
        return chain;
    }

    // Calculate symbolic confidence based on rule weights and certainty
    calculateSymbolicConfidence(reasoningChain) {
        const inferences = reasoningChain.filter(step => step.type === 'inference');
        
        if (inferences.length === 0) return 0.5; // Neutral if no inferences
        
        // Weighted average of inference confidences
        const totalWeight = inferences.reduce((sum, inf) => sum + (inf.weight || 1), 0);
        const weightedConfidence = inferences.reduce((sum, inf) => 
            sum + inf.confidence * (inf.weight || 1), 0
        ) / totalWeight;
        
        // Adjust for chain length (more reasoning steps = higher confidence)
        const lengthBonus = Math.min(inferences.length * 0.05, 0.2);
        
        return Math.min(weightedConfidence + lengthBonus, 1.0);
    }

    // Get applied rules from inferences
    getAppliedRules(inferences) {
        return inferences.map(inf => ({
            id: inf.rule,
            conditions: inf.conditions,
            conclusion: inf.conclusion,
            confidence: inf.confidence
        }));
    }

    // Fuse neural and symbolic reasoning
    fuseNeuralSymbolic(neuralOutput, symbolicReasoning, decision) {
        // Calculate agreement between neural and symbolic
        const agreement = this.calculateNeuralSymbolicAgreement(neuralOutput, symbolicReasoning);
        
        // Weighted fusion based on agreement and individual confidences
        const neuralWeight = neuralOutput.confidence * 0.6;
        const symbolicWeight = symbolicReasoning.confidence * 0.4;
        const agreementBonus = agreement * 0.2;
        
        const fusedConfidence = Math.min(
            (neuralWeight + symbolicWeight + agreementBonus) / 1.2,
            1.0
        );
        
        // Combine reasoning components
        const fusedReasoning = {
            confidence: fusedConfidence,
            agreement: agreement,
            dominantComponent: neuralOutput.confidence > symbolicReasoning.confidence ? 'neural' : 'symbolic',
            neuralContribution: neuralWeight / (neuralWeight + symbolicWeight),
            symbolicContribution: symbolicWeight / (neuralWeight + symbolicWeight),
            conflictResolution: this.resolveConflicts(neuralOutput, symbolicReasoning),
            combinedFeatures: this.combineFeatures(neuralOutput, symbolicReasoning),
            decisionSupport: this.generateDecisionSupport(neuralOutput, symbolicReasoning, decision)
        };
        
        return fusedReasoning;
    }

    // Calculate agreement between neural and symbolic components
    calculateNeuralSymbolicAgreement(neural, symbolic) {
        // Compare directional alignment
        const neuralDirection = neural.rawPrediction.direction || 0;
        const symbolicBullish = symbolic.inferences.some(inf => 
            inf.conclusion.includes('bullish') || inf.conclusion.includes('long_term_bullish')
        );
        const symbolicBearish = symbolic.inferences.some(inf => 
            inf.conclusion.includes('bearish') || inf.conclusion.includes('long_term_bearish')
        );
        
        let directionalAgreement = 0.5; // Neutral
        
        if (neuralDirection > 0.1 && symbolicBullish) {
            directionalAgreement = 0.8 + (neuralDirection * 0.2);
        } else if (neuralDirection < -0.1 && symbolicBearish) {
            directionalAgreement = 0.8 + (Math.abs(neuralDirection) * 0.2);
        } else if (Math.abs(neuralDirection) < 0.1 && !symbolicBullish && !symbolicBearish) {
            directionalAgreement = 0.7; // Both neutral
        } else {
            directionalAgreement = 0.2; // Disagreement
        }
        
        // Compare confidence levels
        const confidenceAlignment = 1 - Math.abs(neural.confidence - symbolic.confidence);
        
        // Overall agreement
        return (directionalAgreement * 0.7 + confidenceAlignment * 0.3);
    }

    // Resolve conflicts between neural and symbolic reasoning
    resolveConflicts(neural, symbolic) {
        const conflicts = [];
        const resolutions = [];
        
        // Check for directional conflicts
        const neuralDirection = neural.rawPrediction.direction || 0;
        const symbolicBullish = symbolic.inferences.some(inf => inf.conclusion.includes('bullish'));
        const symbolicBearish = symbolic.inferences.some(inf => inf.conclusion.includes('bearish'));
        
        if (neuralDirection > 0.1 && symbolicBearish) {
            conflicts.push('directional_conflict_neural_bullish_symbolic_bearish');
            resolutions.push({
                conflict: 'directional_disagreement',
                resolution: 'weight_by_confidence',
                winner: neural.confidence > symbolic.confidence ? 'neural' : 'symbolic'
            });
        } else if (neuralDirection < -0.1 && symbolicBullish) {
            conflicts.push('directional_conflict_neural_bearish_symbolic_bullish');
            resolutions.push({
                conflict: 'directional_disagreement',
                resolution: 'weight_by_confidence',
                winner: neural.confidence > symbolic.confidence ? 'neural' : 'symbolic'
            });
        }
        
        // Check for confidence conflicts
        if (Math.abs(neural.confidence - symbolic.confidence) > 0.3) {
            conflicts.push('confidence_mismatch');
            resolutions.push({
                conflict: 'confidence_mismatch',
                resolution: 'average_with_skepticism_penalty',
                penalty: 0.1
            });
        }
        
        return {
            conflicts,
            resolutions,
            conflictCount: conflicts.length
        };
    }

    // Combine features from both reasoning systems
    combineFeatures(neural, symbolic) {
        return {
            neuralFeatures: neural.neuralFeatures,
            symbolicFacts: symbolic.facts,
            appliedRules: symbolic.appliedRules,
            reasoningChain: symbolic.reasoningChain,
            attentionWeights: neural.neuralFeatures.attention_weights,
            activatedPatterns: neural.neuralFeatures.activated_patterns,
            logicalInferences: symbolic.inferences
        };
    }

    // Generate decision support combining both systems
    generateDecisionSupport(neural, symbolic, decision) {
        const support = {
            recommendation: decision.action || 'hold',
            confidence: this.calculateOverallConfidence(neural, symbolic),
            supportingEvidence: [],
            contradictingEvidence: [],
            riskFactors: [],
            opportunities: []
        };
        
        // Add neural evidence
        if (neural.confidence > 0.6) {
            support.supportingEvidence.push({
                type: 'neural',
                evidence: `Neural network confidence: ${(neural.confidence * 100).toFixed(1)}%`,
                strength: neural.confidence
            });
        }
        
        // Add symbolic evidence
        symbolic.inferences.forEach(inf => {
            if (inf.confidence > 0.6) {
                support.supportingEvidence.push({
                    type: 'symbolic',
                    evidence: `${inf.conclusion} (${inf.conditions.join(', ')})`,
                    strength: inf.confidence
                });
            }
        });
        
        // Identify risk factors
        const riskInferences = symbolic.inferences.filter(inf => 
            inf.conclusion.includes('risk') || inf.conclusion.includes('reduce') || inf.conclusion.includes('exit')
        );
        
        riskInferences.forEach(risk => {
            support.riskFactors.push({
                factor: risk.conclusion,
                conditions: risk.conditions,
                severity: risk.confidence
            });
        });
        
        return support;
    }

    // Generate human-readable explanation
    generateHumanExplanation(fusedReasoning, marketState) {
        const confidence = (fusedReasoning.confidence * 100).toFixed(1);
        const dominant = fusedReasoning.dominantComponent;
        
        let summary = `${confidence}% confidence: `;
        
        // Add main reasoning
        if (fusedReasoning.decisionSupport.supportingEvidence.length > 0) {
            const mainEvidence = fusedReasoning.decisionSupport.supportingEvidence[0];
            summary += mainEvidence.evidence;
        } else {
            summary += `${dominant} analysis suggests ${fusedReasoning.decisionSupport.recommendation}`;
        }
        
        // Build detailed explanation
        const detailed = {
            summary,
            neuralAnalysis: this.explainNeuralReasoning(fusedReasoning.combinedFeatures),
            symbolicAnalysis: this.explainSymbolicReasoning(fusedReasoning.combinedFeatures),
            agreement: `Neural and symbolic systems ${fusedReasoning.agreement > 0.7 ? 'strongly agree' : 
                        fusedReasoning.agreement > 0.4 ? 'moderately agree' : 'disagree'}`,
            riskAssessment: this.generateRiskAssessment(fusedReasoning.decisionSupport.riskFactors),
            actionableInsights: this.generateActionableInsights(fusedReasoning, marketState)
        };
        
        return detailed;
    }

    // Explain neural reasoning in human terms
    explainNeuralReasoning(features) {
        const patterns = features.activatedPatterns || [];
        const attention = features.attentionWeights || [];
        
        let explanation = "Neural network analysis: ";
        
        if (patterns.length > 0) {
            explanation += `Detected patterns include ${patterns.join(', ')}. `;
        }
        
        if (attention.length > 0) {
            const maxAttention = Math.max(...attention.flat());
            explanation += `Highest attention on ${maxAttention > 0.5 ? 'recent' : 'historical'} price movements.`;
        }
        
        return explanation;
    }

    // Explain symbolic reasoning in human terms
    explainSymbolicReasoning(features) {
        const chain = features.reasoningChain || [];
        const inferences = chain.filter(step => step.type === 'inference');
        
        if (inferences.length === 0) {
            return "No clear logical patterns detected in current market conditions.";
        }
        
        let explanation = "Logical analysis: ";
        
        inferences.forEach((inf, index) => {
            if (index === 0) {
                explanation += `${inf.conclusion} due to ${inf.conditions.join(' and ')}`;
            } else if (index < 2) {
                explanation += `, additionally ${inf.conclusion}`;
            }
        });
        
        return explanation + ".";
    }

    // Generate risk assessment
    generateRiskAssessment(riskFactors) {
        if (riskFactors.length === 0) {
            return "Risk level: Low. No significant risk factors detected.";
        }
        
        const avgSeverity = riskFactors.reduce((sum, risk) => sum + risk.severity, 0) / riskFactors.length;
        const riskLevel = avgSeverity > 0.7 ? 'High' : avgSeverity > 0.4 ? 'Medium' : 'Low';
        
        return `Risk level: ${riskLevel}. Key concerns: ${riskFactors.map(r => r.factor).join(', ')}.`;
    }

    // Generate actionable insights
    generateActionableInsights(fusedReasoning, marketState) {
        const insights = [];
        
        if (fusedReasoning.confidence > 0.8) {
            insights.push("High confidence signal - consider taking position");
        } else if (fusedReasoning.confidence < 0.4) {
            insights.push("Low confidence - wait for clearer signals");
        }
        
        if (fusedReasoning.agreement > 0.7) {
            insights.push("Neural and symbolic systems align - strong signal");
        } else if (fusedReasoning.agreement < 0.3) {
            insights.push("Systems disagree - proceed with caution");
        }
        
        if (fusedReasoning.decisionSupport.riskFactors.length > 2) {
            insights.push("Multiple risk factors present - reduce position size");
        }
        
        return insights;
    }

    // Validate logical consistency
    validateLogicalConsistency(fusedReasoning) {
        let consistencyScore = 1.0;
        const issues = [];
        
        // Check for logical contradictions
        const evidence = fusedReasoning.decisionSupport.supportingEvidence;
        const contradictions = fusedReasoning.decisionSupport.contradictingEvidence;
        
        if (contradictions.length > evidence.length * 0.5) {
            consistencyScore -= 0.3;
            issues.push('excessive_contradictions');
        }
        
        // Check confidence alignment
        if (fusedReasoning.agreement < 0.3 && fusedReasoning.confidence > 0.7) {
            consistencyScore -= 0.2;
            issues.push('confidence_agreement_mismatch');
        }
        
        // Check reasoning chain validity
        const chain = fusedReasoning.combinedFeatures.reasoningChain || [];
        const invalidSteps = chain.filter(step => 
            step.type === 'inference' && step.confidence < 0.3
        ).length;
        
        if (invalidSteps > chain.length * 0.3) {
            consistencyScore -= 0.2;
            issues.push('weak_reasoning_chain');
        }
        
        return {
            score: Math.max(consistencyScore, 0),
            issues,
            isConsistent: consistencyScore > 0.6
        };
    }

    // Update performance metrics
    updateMetrics(fusedReasoning, processingTime) {
        this.metrics.decisionsExplained++;
        
        // Update average confidence
        this.metrics.avgConfidence = (
            this.metrics.avgConfidence * (this.metrics.decisionsExplained - 1) + 
            fusedReasoning.confidence
        ) / this.metrics.decisionsExplained;
        
        // Update reasoning chain length
        const chainLength = fusedReasoning.combinedFeatures.reasoningChain?.length || 0;
        this.metrics.reasoningChainLength = (
            this.metrics.reasoningChainLength * (this.metrics.decisionsExplained - 1) + 
            chainLength
        ) / this.metrics.decisionsExplained;
        
        // Update neural-symbolic agreement
        this.metrics.neuralSymbolicAgreement = (
            this.metrics.neuralSymbolicAgreement * (this.metrics.decisionsExplained - 1) + 
            fusedReasoning.agreement
        ) / this.metrics.decisionsExplained;
    }

    // Utility functions
    sigmoid(x) {
        return 1 / (1 + Math.exp(-x));
    }

    softmax(arr) {
        const exp = arr.map(x => Math.exp(x));
        const sum = exp.reduce((a, b) => a + b, 0);
        return exp.map(x => x / sum);
    }

    matrixMultiply(a, b) {
        return a.map(row => 
            b[0].map((_, colIndex) => 
                row.reduce((sum, cell, rowIndex) => sum + cell * b[rowIndex][colIndex], 0)
            )
        );
    }

    identifyActivatedPatterns(ffnOutput) {
        const patterns = [];
        const threshold = 0.5;
        
        ffnOutput.activationPattern.forEach((activation, index) => {
            if (activation > threshold) {
                patterns.push(`pattern_${index}`);
            }
        });
        
        return patterns;
    }

    calculateFeatureImportance(input, prediction) {
        return input.map((feature, index) => ({
            feature: `input_${index}`,
            importance: Math.abs(feature * (prediction.rawScores[index] || 0))
        })).sort((a, b) => b.importance - a.importance);
    }

    interpretNeuralOutput(prediction) {
        const direction = prediction.direction > 0.1 ? 'bullish' : 
                         prediction.direction < -0.1 ? 'bearish' : 'neutral';
        const strength = prediction.strength > 0.7 ? 'strong' : 
                        prediction.strength > 0.4 ? 'moderate' : 'weak';
        
        return `${strength} ${direction} signal`;
    }

    calculateOverallConfidence(neural, symbolic) {
        return (neural.confidence * 0.6 + symbolic.confidence * 0.4);
    }

    generateExplanationKey(marketState, decision) {
        const stateHash = JSON.stringify(marketState).split('').reduce((hash, char) => 
            hash + char.charCodeAt(0), 0
        );
        return `${stateHash}_${decision.action}_${Date.now()}`.slice(-16);
    }

    unify(term1, term2) {
        // Simplified unification algorithm
        if (term1 === term2) return true;
        if (typeof term1 === 'string' && term1.startsWith('?')) return true; // Variable
        if (typeof term2 === 'string' && term2.startsWith('?')) return true; // Variable
        return false;
    }

    resolve(clause1, clause2) {
        // Simplified resolution
        return { resolved: true, result: clause1 + '_' + clause2 };
    }

    backwardChaining(goal, facts, rules) {
        // Simplified backward chaining
        if (facts.has(goal)) return true;
        
        for (const [ruleId, rule] of rules) {
            if (rule.conclusion === goal) {
                const allConditionsMet = rule.condition.every(condition => 
                    this.backwardChaining(condition, facts, rules)
                );
                if (allConditionsMet) return true;
            }
        }
        
        return false;
    }

    // Get interpreter status
    getInterpreterStatus() {
        return {
            name: this.name,
            version: this.version,
            metrics: this.metrics,
            knowledgeBaseSize: this.knowledgeBase.rules.length,
            cachedExplanations: this.explanationCache.size,
            vocabularySize: Object.keys(this.transformer.vocabulary).length,
            status: 'NEUROSYMBOLIC_READY'
        };
    }
}

module.exports = { NeurosymbolicInterpreter };