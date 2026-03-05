// ConsciousnessRiskNeuron.js - Revolutionary Consciousness-Driven Risk Assessment
// Models primate neural pathways for fear conditioning and cognitive risk control

class ConsciousnessRiskNeuron {
    constructor() {
        this.name = 'ConsciousnessRiskNeuron';
        this.version = '1.0.0';
        this.basolateralAmygdala = this.initializeAmygdala();
        this.prefrontalCortex = this.initializePrefrontalCortex();
        this.hippocampus = this.initializeHippocampus();
        this.neurotransmitters = this.initializeNeurotransmitters();
        this.memoryConsolidation = this.initializeMemorySystem();
        this.consciousnessState = this.initializeConsciousness();
        
        this.emotionalMemory = new Map();
        this.fearConditioning = new Map();
        this.riskAssessmentHistory = [];
        this.panicThresholds = this.initializePanicThresholds();
        
        this.metrics = {
            fearSignalsProcessed: 0,
            panicEventsDetected: 0,
            avgFearLevel: 0,
            cognitiveBiasCorrections: 0,
            consciousnessLevel: 1.0,
            riskAccuracy: 0.75
        };
        
        console.log('🧠 Consciousness Risk Neuron initialized');
        console.log('⚡ Amygdala fear processing activated');
        console.log('🎭 Prefrontal cortex cognitive control enabled');
        console.log('🌊 Consciousness substrate online');
    }

    // Initialize amygdala for fear conditioning and threat detection
    initializeAmygdala() {
        return {
            // Basolateral amygdala - fear learning and memory
            basolateral: {
                neurons: this.createNeuralNetwork(256, 128, 64),
                learningRate: 0.01,
                fearMemoryStrength: 1.0,
                conditioningDecay: 0.995,
                activationThreshold: 0.3
            },
            
            // Central amygdala - fear expression and autonomic responses
            central: {
                neurons: this.createNeuralNetwork(128, 64, 32),
                learningRate: 0.005,
                outputGains: {
                    autonomic: 1.0,      // Heart rate, stress response
                    behavioral: 0.8,     // Fight/flight behavior
                    cognitive: 0.6       // Attention and memory modulation
                }
            },
            
            // Intercalated cells - fear extinction and regulation
            intercalated: {
                neurons: this.createNeuralNetwork(64, 32, 16),
                extinctionRate: 0.02,
                inhibitionStrength: 0.7,
                plasticity: 0.05
            },
            
            // Neurotransmitter receptors
            receptors: {
                glutamate: { sensitivity: 1.0, saturation: 10.0 },
                gaba: { sensitivity: 0.8, saturation: 5.0 },
                dopamine: { sensitivity: 0.6, saturation: 3.0 },
                norepinephrine: { sensitivity: 1.2, saturation: 8.0 },
                serotonin: { sensitivity: 0.7, saturation: 4.0 }
            }
        };
    }

    // Initialize prefrontal cortex for cognitive control and executive function
    initializePrefrontalCortex() {
        return {
            // Dorsolateral PFC - working memory and cognitive control
            dorsolateral: {
                neurons: this.createNeuralNetwork(512, 256, 128),
                workingMemoryCapacity: 7, // Miller's 7±2 rule
                attentionalControl: 1.0,
                cognitiveFlexibility: 0.8,
                executiveAttention: 0.9
            },
            
            // Ventromedial PFC - emotion regulation and decision making
            ventromedial: {
                neurons: this.createNeuralNetwork(256, 128, 64),
                emotionRegulation: 0.85,
                valuationSystem: 1.0,
                socialCognition: 0.3, // Less relevant for trading
                empathy: 0.1 // Minimal for trading decisions
            },
            
            // Anterior cingulate cortex - conflict monitoring and error detection
            anteriorCingulate: {
                neurons: this.createNeuralNetwork(128, 64, 32),
                conflictMonitoring: 1.0,
                errorDetection: 0.95,
                painProcessing: 0.7, // Financial pain from losses
                motivationalControl: 0.8
            },
            
            // Orbitofrontal cortex - reward prediction and impulse control
            orbitofrontal: {
                neurons: this.createNeuralNetwork(256, 128, 64),
                rewardPrediction: 1.0,
                impulseControl: 0.9,
                riskAssessment: 1.0,
                outcomeEvaluation: 0.95
            }
        };
    }

    // Initialize hippocampus for contextual memory and pattern separation
    initializeHippocampus() {
        return {
            // CA1 region - temporal sequence processing
            ca1: {
                neurons: this.createNeuralNetwork(1024, 512, 256),
                temporalProcessing: 1.0,
                patternCompletion: 0.9,
                memoryConsolidation: 0.8
            },
            
            // CA3 region - pattern separation and associative recall
            ca3: {
                neurons: this.createNeuralNetwork(512, 256, 128),
                patternSeparation: 0.95,
                associativeRecall: 0.85,
                autoAssociation: 0.9
            },
            
            // Dentate gyrus - new memory encoding
            dentateGyrus: {
                neurons: this.createNeuralNetwork(256, 128, 64),
                neurogenesis: 0.1, // New neuron formation
                patternEncoding: 1.0,
                memoryGating: 0.8
            },
            
            // Entorhinal cortex - spatial and temporal context
            entorhinaLCortex: {
                neurons: this.createNeuralNetwork(512, 256, 128),
                spatialContext: 0.3, // Less relevant for trading
                temporalContext: 1.0,
                gridCells: 0.2,
                borderCells: 0.1
            }
        };
    }

    // Initialize neurotransmitter systems
    initializeNeurotransmitters() {
        return {
            dopamine: {
                level: 0.7,
                reuptakeRate: 0.1,
                synthesisRate: 0.08,
                receptorSensitivity: 1.0,
                functions: ['reward_prediction', 'motivation', 'learning']
            },
            serotonin: {
                level: 0.8,
                reuptakeRate: 0.15,
                synthesisRate: 0.12,
                receptorSensitivity: 0.9,
                functions: ['mood_regulation', 'impulse_control', 'risk_tolerance']
            },
            norepinephrine: {
                level: 0.6,
                reuptakeRate: 0.12,
                synthesisRate: 0.1,
                receptorSensitivity: 1.1,
                functions: ['attention', 'arousal', 'stress_response']
            },
            gaba: {
                level: 0.9,
                reuptakeRate: 0.2,
                synthesisRate: 0.18,
                receptorSensitivity: 1.0,
                functions: ['inhibition', 'anxiety_reduction', 'cognitive_control']
            },
            glutamate: {
                level: 1.0,
                reuptakeRate: 0.25,
                synthesisRate: 0.22,
                receptorSensitivity: 1.0,
                functions: ['excitation', 'learning', 'memory_formation']
            },
            acetylcholine: {
                level: 0.75,
                reuptakeRate: 0.3,
                synthesisRate: 0.25,
                receptorSensitivity: 0.95,
                functions: ['attention', 'learning', 'memory_consolidation']
            }
        };
    }

    // Initialize memory consolidation system
    initializeMemorySystem() {
        return {
            shortTermMemory: {
                capacity: 7, // Items in working memory
                decayRate: 0.1,
                rehearsalBoost: 2.0,
                contents: []
            },
            longTermMemory: {
                declarative: new Map(), // Explicit memories
                procedural: new Map(),  // Implicit skills
                episodic: new Map(),    // Personal experiences
                semantic: new Map()     // General knowledge
            },
            consolidationProcess: {
                sleepConsolidation: 0.3, // Memory strengthening during downtime
                interferenceDecay: 0.05, // Memory degradation from interference
                emotionalTagging: 1.5,   // Emotional memories are stronger
                rehearsalStrength: 2.0   // Active recall strengthens memory
            }
        };
    }

    // Initialize consciousness state monitoring
    initializeConsciousness() {
        return {
            awarenessLevel: 1.0,
            attentionalFocus: 0.8,
            metacognition: 0.7, // Thinking about thinking
            selfAwareness: 0.6,
            globalWorkspace: {
                activeCoalitions: [],
                competingNarratives: [],
                dominantTheme: 'neutral',
                coherenceLevel: 0.8
            },
            bindingProblem: {
                visualBinding: 0.3,   // Less relevant for trading
                auditoryBinding: 0.2, // Less relevant for trading
                conceptualBinding: 1.0, // Very relevant for trading concepts
                temporalBinding: 0.9   // Binding events across time
            }
        };
    }

    // Initialize panic detection thresholds
    initializePanicThresholds() {
        return {
            fear: {
                mild: 0.3,
                moderate: 0.6,
                severe: 0.8,
                panic: 0.95
            },
            volatility: {
                normal: 0.02,
                elevated: 0.05,
                high: 0.1,
                extreme: 0.2
            },
            drawdown: {
                acceptable: 0.05,
                concerning: 0.1,
                dangerous: 0.2,
                catastrophic: 0.35
            },
            time: {
                shortTerm: 300,    // 5 minutes
                mediumTerm: 1800,  // 30 minutes
                longTerm: 7200     // 2 hours
            }
        };
    }

    // Create a basic neural network structure
    createNeuralNetwork(inputSize, hiddenSize, outputSize) {
        return {
            layers: [
                {
                    type: 'input',
                    size: inputSize,
                    activation: null
                },
                {
                    type: 'hidden',
                    size: hiddenSize,
                    weights: this.generateSynapticWeights(inputSize, hiddenSize),
                    bias: this.generateNeuronBias(hiddenSize),
                    activation: 'sigmoid'
                },
                {
                    type: 'output',
                    size: outputSize,
                    weights: this.generateSynapticWeights(hiddenSize, outputSize),
                    bias: this.generateNeuronBias(outputSize),
                    activation: 'sigmoid'
                }
            ],
            synapticPlasticity: 0.01,
            neurotransmitterLevels: { ...this.neurotransmitters }
        };
    }

    // Generate synaptic weights with biological constraints
    generateSynapticWeights(presynaptic, postsynaptic) {
        const weights = [];
        
        for (let i = 0; i < presynaptic; i++) {
            weights[i] = [];
            for (let j = 0; j < postsynaptic; j++) {
                // Initialize with small random weights (biological synapses are weak initially)
                weights[i][j] = (Math.random() - 0.5) * 0.1;
            }
        }
        
        return weights;
    }

    // Generate neuron bias with biological realism
    generateNeuronBias(size) {
        return Array(size).fill(0).map(() => 
            (Math.random() - 0.5) * 0.05 // Small random bias
        );
    }

    // Main risk assessment function combining all neural systems
    async assessRisk(marketState, currentPosition, recentHistory) {
        const startTime = performance.now();
        
        try {
            console.log('🧠 Consciousness risk assessment initiated');
            
            // Step 1: Process threat signals through amygdala
            const fearSignal = await this.processAmygdalaResponse(marketState, recentHistory);
            
            // Step 2: Apply prefrontal cortex cognitive control
            const cognitiveAssessment = await this.applyCognitiveControl(fearSignal, currentPosition);
            
            // Step 3: Retrieve and integrate contextual memories
            const contextualMemory = await this.retrieveContextualMemory(marketState);
            
            // Step 4: Update neurotransmitter levels
            this.updateNeurotransmitters(fearSignal, cognitiveAssessment);
            
            // Step 5: Integrate consciousness and metacognition
            const consciousAssessment = await this.integrateConsciousness(
                fearSignal, 
                cognitiveAssessment, 
                contextualMemory
            );
            
            // Step 6: Generate final risk recommendation
            const riskRecommendation = this.generateRiskRecommendation(consciousAssessment);
            
            // Step 7: Update memory and learning
            await this.updateMemoryConsolidation(marketState, riskRecommendation);
            
            const processingTime = performance.now() - startTime;
            this.updateMetrics(fearSignal, riskRecommendation);
            
            const result = {
                fearLevel: fearSignal.intensity,
                cognitiveControl: cognitiveAssessment.controlStrength,
                consciousnessLevel: this.consciousnessState.awarenessLevel,
                riskAssessment: riskRecommendation,
                neurotransmitterState: this.getCurrentNeurotransmitterState(),
                memoryContext: contextualMemory,
                processingTime,
                biologicalBasis: this.generateBiologicalExplanation(consciousAssessment),
                timestamp: Date.now()
            };
            
            console.log(`✅ Consciousness risk assessment completed in ${processingTime.toFixed(2)}ms`);
            console.log(`😰 Fear level: ${(fearSignal.intensity * 100).toFixed(1)}%`);
            console.log(`🧠 Cognitive control: ${(cognitiveAssessment.controlStrength * 100).toFixed(1)}%`);
            console.log(`⚠️ Risk recommendation: ${riskRecommendation.action}`);
            
            return result;
            
        } catch (error) {
            console.error('❌ Consciousness risk assessment failed:', error);
            throw new Error(`Consciousness assessment failed: ${error.message}`);
        }
    }

    // Process threat signals through amygdala fear conditioning
    async processAmygdalaResponse(marketState, recentHistory) {
        // Extract threat-relevant features from market state
        const threatFeatures = this.extractThreatFeatures(marketState, recentHistory);
        
        // Process through basolateral amygdala (fear learning)
        const basolateralResponse = this.forwardPassNeuralNetwork(
            this.basolateralAmygdala.basolateral.neurons,
            threatFeatures
        );
        
        // Check for conditioned fear responses
        const conditionedFear = this.checkConditionedFear(threatFeatures);
        
        // Process through central amygdala (fear expression)
        const centralResponse = this.forwardPassNeuralNetwork(
            this.basolateralAmygdala.central.neurons,
            basolateralResponse.output
        );
        
        // Apply intercalated cell inhibition (fear regulation)
        const intercalatedInhibition = this.forwardPassNeuralNetwork(
            this.basolateralAmygdala.intercalated.neurons,
            centralResponse.output
        );
        
        // Calculate final fear intensity
        const rawFearIntensity = centralResponse.output.reduce((sum, val) => sum + val, 0) / 
                               centralResponse.output.length;
        
        const inhibitionFactor = intercalatedInhibition.output.reduce((sum, val) => sum + val, 0) / 
                               intercalatedInhibition.output.length;
        
        const fearIntensity = Math.max(0, rawFearIntensity - inhibitionFactor * 
                            this.basolateralAmygdala.intercalated.inhibitionStrength);
        
        // Generate autonomic responses
        const autonomicResponse = this.generateAutonomicResponse(fearIntensity);
        
        const fearSignal = {
            intensity: fearIntensity,
            conditionedComponent: conditionedFear.strength,
            unconditionedComponent: rawFearIntensity - conditionedFear.strength,
            autonomicResponse,
            threatFeatures,
            neuralActivation: {
                basolateral: basolateralResponse.activation,
                central: centralResponse.activation,
                intercalated: intercalatedInhibition.activation
            }
        };
        
        // Update fear conditioning if significant threat
        if (fearIntensity > this.panicThresholds.fear.moderate) {
            this.updateFearConditioning(threatFeatures, fearIntensity);
        }
        
        return fearSignal;
    }

    // Extract threat-relevant features from market data
    extractThreatFeatures(marketState, recentHistory) {
        const features = [];
        
        // Volatility threats
        features.push(Math.min(marketState.volatility / 0.1, 1.0)); // Normalized to max 10%
        
        // Price movement threats
        const priceChange = marketState.priceChangePercent || 0;
        features.push(Math.abs(priceChange) / 10); // Normalized to max 10%
        features.push(priceChange < 0 ? 1 : 0); // Downward movement threat
        
        // Volume threats (unusual volume)
        const volumeRatio = marketState.volume / (marketState.avgVolume || marketState.volume);
        features.push(Math.min(volumeRatio / 5, 1.0)); // Normalized to max 5x volume
        
        // Liquidity threats
        const spread = marketState.spread || 0.001;
        features.push(Math.min(spread / 0.01, 1.0)); // Normalized to max 1%
        
        // Technical indicator threats
        features.push(marketState.rsi > 80 ? 1 : 0); // Overbought threat
        features.push(marketState.rsi < 20 ? 1 : 0); // Oversold threat
        features.push(Math.abs(marketState.macd || 0) / 100); // MACD divergence
        
        // Temporal threats (time-based patterns)
        const hour = new Date().getHours();
        features.push(hour < 6 || hour > 22 ? 1 : 0); // Off-hours trading threat
        
        // Historical loss patterns
        if (recentHistory && recentHistory.length > 0) {
            const recentLosses = recentHistory.filter(h => h.pnl < 0).length;
            features.push(recentLosses / recentHistory.length); // Loss frequency
            
            const maxDrawdown = Math.min(...recentHistory.map(h => h.cumulativePnl || 0));
            features.push(Math.abs(maxDrawdown) / 1000); // Normalized max drawdown
        } else {
            features.push(0, 0);
        }
        
        // Market structure threats
        features.push(marketState.correlation || 0); // Market correlation
        features.push(marketState.vix ? Math.min(marketState.vix / 50, 1.0) : 0.5);
        
        // Pad to consistent length
        while (features.length < 16) {
            features.push(0);
        }
        
        return features.slice(0, 16); // Ensure exactly 16 features
    }

    // Check for conditioned fear responses
    checkConditionedFear(threatFeatures) {
        let maxConditionedFear = 0;
        let matchedPattern = null;
        
        // Check against stored fear conditioning patterns
        for (const [pattern, conditioning] of this.fearConditioning) {
            const similarity = this.calculatePatternSimilarity(threatFeatures, pattern);
            
            if (similarity > 0.7) { // High similarity threshold
                const conditionedStrength = conditioning.strength * conditioning.reliability;
                
                if (conditionedStrength > maxConditionedFear) {
                    maxConditionedFear = conditionedStrength;
                    matchedPattern = pattern;
                }
            }
        }
        
        return {
            strength: maxConditionedFear,
            pattern: matchedPattern,
            confidence: maxConditionedFear > 0 ? 0.8 : 0.0
        };
    }

    // Calculate similarity between threat patterns
    calculatePatternSimilarity(pattern1, pattern2) {
        if (pattern1.length !== pattern2.length) return 0;
        
        let similarity = 0;
        for (let i = 0; i < pattern1.length; i++) {
            similarity += 1 - Math.abs(pattern1[i] - pattern2[i]);
        }
        
        return similarity / pattern1.length;
    }

    // Generate autonomic nervous system response
    generateAutonomicResponse(fearIntensity) {
        return {
            heartRate: 60 + fearIntensity * 40, // 60-100 BPM
            cortisol: fearIntensity * 2.0,      // Stress hormone
            adrenaline: fearIntensity * 1.5,    // Fight/flight hormone
            sweating: fearIntensity > 0.6 ? 1 : 0,
            muscletension: fearIntensity * 0.8,
            breathing: 12 + fearIntensity * 8,  // 12-20 breaths per minute
            bloodPressure: 120 + fearIntensity * 20 // Systolic pressure
        };
    }

    // Apply prefrontal cortex cognitive control
    async applyCognitiveControl(fearSignal, currentPosition) {
        // Dorsolateral PFC - working memory and cognitive control
        const workingMemoryLoad = this.calculateWorkingMemoryLoad(fearSignal, currentPosition);
        const attentionalControl = this.calculateAttentionalControl(fearSignal.intensity);
        
        // Process through dorsolateral PFC
        const dlpfcInput = [
            fearSignal.intensity,
            workingMemoryLoad,
            attentionalControl,
            ...fearSignal.threatFeatures.slice(0, 5)
        ];
        
        const dlpfcResponse = this.forwardPassNeuralNetwork(
            this.prefrontalCortex.dorsolateral.neurons,
            dlpfcInput
        );
        
        // Ventromedial PFC - emotion regulation
        const vmPfcInput = [
            fearSignal.intensity,
            fearSignal.autonomicResponse.cortisol / 2.0,
            ...Object.values(this.getCurrentNeurotransmitterState()).slice(0, 6)
        ];
        
        const vmPfcResponse = this.forwardPassNeuralNetwork(
            this.prefrontalCortex.ventromedial.neurons,
            vmPfcInput
        );
        
        // Anterior cingulate cortex - conflict monitoring
        const accInput = [
            fearSignal.intensity,
            this.detectCognitiveBias(),
            this.calculateDecisionConflict(fearSignal, currentPosition),
            ...dlpfcResponse.output.slice(0, 5)
        ];
        
        const accResponse = this.forwardPassNeuralNetwork(
            this.prefrontalCortex.anteriorCingulate.neurons,
            accInput
        );
        
        // Orbitofrontal cortex - reward prediction and impulse control
        const ofcInput = [
            currentPosition.unrealizedPnl || 0,
            currentPosition.riskReward || 1,
            fearSignal.intensity,
            this.predictOutcome(fearSignal),
            ...vmPfcResponse.output.slice(0, 4)
        ];
        
        const ofcResponse = this.forwardPassNeuralNetwork(
            this.prefrontalCortex.orbitofrontal.neurons,
            ofcInput
        );
        
        // Calculate overall cognitive control strength
        const controlComponents = {
            cognitive: dlpfcResponse.output.reduce((sum, val) => sum + val, 0) / dlpfcResponse.output.length,
            emotional: vmPfcResponse.output.reduce((sum, val) => sum + val, 0) / vmPfcResponse.output.length,
            conflict: accResponse.output.reduce((sum, val) => sum + val, 0) / accResponse.output.length,
            impulse: ofcResponse.output.reduce((sum, val) => sum + val, 0) / ofcResponse.output.length
        };
        
        const controlStrength = (controlComponents.cognitive * 0.3 + 
                               controlComponents.emotional * 0.3 + 
                               controlComponents.conflict * 0.2 + 
                               controlComponents.impulse * 0.2);
        
        // Generate cognitive biases and corrections
        const biasCorrections = this.generateBiasCorrections(fearSignal, controlComponents);
        
        return {
            controlStrength,
            components: controlComponents,
            workingMemoryLoad,
            attentionalControl,
            biasCorrections,
            conflictLevel: this.calculateDecisionConflict(fearSignal, currentPosition),
            regulationStrategy: this.selectRegulationStrategy(controlComponents)
        };
    }

    // Calculate working memory cognitive load
    calculateWorkingMemoryLoad(fearSignal, currentPosition) {
        let load = 0;
        
        // Base load from fear processing
        load += fearSignal.intensity * 2; // Fear consumes working memory
        
        // Load from current position complexity
        if (currentPosition.multiplePositions) {
            load += currentPosition.positionCount * 0.5;
        }
        
        // Load from decision complexity
        load += fearSignal.threatFeatures.filter(f => f > 0.5).length * 0.3;
        
        // Normalize to working memory capacity
        return Math.min(load / this.prefrontalCortex.dorsolateral.workingMemoryCapacity, 1.0);
    }

    // Calculate attentional control based on fear level
    calculateAttentionalControl(fearIntensity) {
        // Yerkes-Dodson law: moderate arousal optimizes performance
        const optimalArousal = 0.3;
        const arousalDifference = Math.abs(fearIntensity - optimalArousal);
        
        // Attention is best at moderate arousal, worse at very low or very high
        return Math.max(0.1, 1.0 - arousalDifference * 2);
    }

    // Detect cognitive biases affecting decision making
    detectCognitiveBias() {
        // Simulated bias detection based on recent history
        const recentDecisions = this.riskAssessmentHistory.slice(-10);
        
        let biasLevel = 0;
        
        // Loss aversion bias
        const lossAversionBias = recentDecisions.filter(d => 
            d.action === 'reduce_position' && d.fearLevel > 0.7
        ).length / Math.max(recentDecisions.length, 1);
        
        biasLevel += lossAversionBias * 0.3;
        
        // Confirmation bias
        const confirmationBias = recentDecisions.filter(d => 
            d.override === 'ignored_contradictory_signals'
        ).length / Math.max(recentDecisions.length, 1);
        
        biasLevel += confirmationBias * 0.2;
        
        // Anchoring bias
        const anchoringBias = this.detectAnchoringBias(recentDecisions);
        biasLevel += anchoringBias * 0.2;
        
        return Math.min(biasLevel, 1.0);
    }

    // Detect anchoring bias in recent decisions
    detectAnchoringBias(decisions) {
        if (decisions.length < 5) return 0;
        
        // Check if decisions are too similar (anchored to initial assessment)
        const riskLevels = decisions.map(d => d.riskLevel || 0.5);
        const variance = this.calculateVariance(riskLevels);
        
        // Low variance indicates potential anchoring
        return Math.max(0, 0.5 - variance * 10);
    }

    // Calculate variance for anchoring bias detection
    calculateVariance(values) {
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const squaredDifferences = values.map(val => Math.pow(val - mean, 2));
        return squaredDifferences.reduce((sum, val) => sum + val, 0) / values.length;
    }

    // Calculate decision conflict level
    calculateDecisionConflict(fearSignal, currentPosition) {
        let conflict = 0;
        
        // Conflict between fear and opportunity
        const opportunitySignal = this.assessOpportunity(currentPosition);
        conflict += Math.abs(fearSignal.intensity - opportunitySignal) * 0.4;
        
        // Conflict between different time horizons
        const shortTermFear = fearSignal.intensity;
        const longTermFear = this.assessLongTermRisk(fearSignal);
        conflict += Math.abs(shortTermFear - longTermFear) * 0.3;
        
        // Conflict between logical and emotional assessment
        const logicalRisk = this.calculateLogicalRisk(fearSignal.threatFeatures);
        conflict += Math.abs(fearSignal.intensity - logicalRisk) * 0.3;
        
        return Math.min(conflict, 1.0);
    }

    // Assess opportunity signals (opposite of threat)
    assessOpportunity(currentPosition) {
        // Simplified opportunity assessment
        const unrealizedGain = Math.max(0, currentPosition.unrealizedPnl || 0);
        const trendStrength = currentPosition.trendAlignment || 0.5;
        const volumeSupport = currentPosition.volumeConfirmation || 0.5;
        
        return (unrealizedGain / 1000 + trendStrength + volumeSupport) / 3;
    }

    // Assess long-term risk perspective
    assessLongTermRisk(fearSignal) {
        // Long-term risk is typically lower than short-term fear
        const longTermFactor = 0.7;
        return fearSignal.intensity * longTermFactor;
    }

    // Calculate logical/analytical risk assessment
    calculateLogicalRisk(threatFeatures) {
        // Simple weighted average of threat features
        const weights = [0.2, 0.15, 0.15, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05];
        
        let logicalRisk = 0;
        for (let i = 0; i < Math.min(threatFeatures.length, weights.length); i++) {
            logicalRisk += threatFeatures[i] * (weights[i] || 0.02);
        }
        
        return Math.min(logicalRisk, 1.0);
    }

    // Generate cognitive bias corrections
    generateBiasCorrections(fearSignal, controlComponents) {
        const corrections = [];
        
        // Loss aversion correction
        if (fearSignal.intensity > 0.8 && controlComponents.emotional < 0.5) {
            corrections.push({
                bias: 'LOSS_AVERSION',
                correction: 'Consider base rates and expected value',
                strength: 0.3,
                method: 'rational_analysis'
            });
        }
        
        // Confirmation bias correction
        if (controlComponents.conflict > 0.7) {
            corrections.push({
                bias: 'CONFIRMATION',
                correction: 'Actively seek contradictory evidence',
                strength: 0.4,
                method: 'devils_advocate'
            });
        }
        
        // Anchoring bias correction
        const anchoringBias = this.detectAnchoringBias(this.riskAssessmentHistory.slice(-10));
        if (anchoringBias > 0.5) {
            corrections.push({
                bias: 'ANCHORING',
                correction: 'Generate alternative initial estimates',
                strength: 0.3,
                method: 'multiple_anchors'
            });
        }
        
        return corrections;
    }

    // Select emotion regulation strategy
    selectRegulationStrategy(controlComponents) {
        if (controlComponents.emotional < 0.3) {
            return {
                strategy: 'COGNITIVE_REAPPRAISAL',
                description: 'Reframe situation to reduce emotional impact',
                effectiveness: 0.8
            };
        } else if (controlComponents.impulse < 0.4) {
            return {
                strategy: 'RESPONSE_INHIBITION',
                description: 'Suppress immediate impulse responses',
                effectiveness: 0.6
            };
        } else if (controlComponents.conflict > 0.7) {
            return {
                strategy: 'ATTENTIONAL_DEPLOYMENT',
                description: 'Focus attention on relevant information',
                effectiveness: 0.7
            };
        } else {
            return {
                strategy: 'SITUATION_MODIFICATION',
                description: 'Modify trading parameters to reduce stress',
                effectiveness: 0.9
            };
        }
    }

    // Retrieve contextual memory from hippocampus
    async retrieveContextualMemory(marketState) {
        // Process current context through hippocampal regions
        const contextFeatures = this.extractContextualFeatures(marketState);
        
        // CA3 pattern completion and associative recall
        const ca3Response = this.forwardPassNeuralNetwork(
            this.hippocampus.ca3.neurons,
            contextFeatures
        );
        
        // CA1 temporal sequence processing
        const ca1Input = [...contextFeatures, ...ca3Response.output.slice(0, 8)];
        const ca1Response = this.forwardPassNeuralNetwork(
            this.hippocampus.ca1.neurons,
            ca1Input
        );
        
        // Retrieve similar historical contexts
        const similarContexts = this.findSimilarContexts(contextFeatures);
        
        // Retrieve episodic memories of similar market conditions
        const episodicMemories = this.retrieveEpisodicMemories(contextFeatures);
        
        return {
            currentContext: contextFeatures,
            similarContexts,
            episodicMemories,
            hippocampalActivation: {
                ca1: ca1Response.activation,
                ca3: ca3Response.activation
            },
            contextualPrediction: this.generateContextualPrediction(ca1Response.output)
        };
    }

    // Extract contextual features for hippocampal processing
    extractContextualFeatures(marketState) {
        return [
            marketState.volatility || 0.02,
            marketState.volume / (marketState.avgVolume || marketState.volume),
            marketState.priceChangePercent || 0,
            marketState.timeOfDay || 0.5,
            marketState.dayOfWeek || 0.5,
            marketState.marketSentiment || 0.5,
            marketState.vix || 25,
            marketState.correlation || 0
        ];
    }

    // Find similar historical contexts
    findSimilarContexts(currentContext) {
        const similarContexts = [];
        
        // Search through emotional memory for similar patterns
        for (const [context, memory] of this.emotionalMemory) {
            const similarity = this.calculatePatternSimilarity(currentContext, context);
            
            if (similarity > 0.7) {
                similarContexts.push({
                    context,
                    memory,
                    similarity,
                    outcome: memory.outcome
                });
            }
        }
        
        // Sort by similarity
        similarContexts.sort((a, b) => b.similarity - a.similarity);
        
        return similarContexts.slice(0, 5); // Top 5 similar contexts
    }

    // Retrieve episodic memories
    retrieveEpisodicMemories(contextFeatures) {
        const episodicMemories = [];
        
        // Search long-term episodic memory
        for (const [episode, details] of this.memoryConsolidation.longTermMemory.episodic) {
            const contextSimilarity = this.calculatePatternSimilarity(
                contextFeatures, 
                details.context || []
            );
            
            if (contextSimilarity > 0.6) {
                episodicMemories.push({
                    episode,
                    details,
                    contextSimilarity,
                    emotionalIntensity: details.emotionalTag || 0.5
                });
            }
        }
        
        // Sort by emotional intensity and similarity
        episodicMemories.sort((a, b) => 
            (b.emotionalIntensity + b.contextSimilarity) - 
            (a.emotionalIntensity + a.contextSimilarity)
        );
        
        return episodicMemories.slice(0, 3); // Top 3 relevant memories
    }

    // Generate contextual prediction
    generateContextualPrediction(hippocampalOutput) {
        const predictionVector = hippocampalOutput.slice(0, 4);
        
        return {
            riskDirection: predictionVector[0] > 0.5 ? 'increasing' : 'decreasing',
            volatilityPrediction: predictionVector[1],
            durationEstimate: predictionVector[2] * 3600, // Seconds
            confidenceLevel: predictionVector[3]
        };
    }

    // Update neurotransmitter levels based on current state
    updateNeurotransmitters(fearSignal, cognitiveAssessment) {
        // Update each neurotransmitter based on current conditions
        Object.keys(this.neurotransmitters).forEach(nt => {
            const current = this.neurotransmitters[nt];
            let levelChange = 0;
            
            switch (nt) {
                case 'dopamine':
                    // Decreases with fear, increases with control
                    levelChange = -fearSignal.intensity * 0.1 + cognitiveAssessment.controlStrength * 0.05;
                    break;
                    
                case 'serotonin':
                    // Decreases with stress, increases with successful regulation
                    levelChange = -fearSignal.autonomicResponse.cortisol * 0.05 + 
                                 cognitiveAssessment.components.emotional * 0.03;
                    break;
                    
                case 'norepinephrine':
                    // Increases with arousal and attention demands
                    levelChange = fearSignal.intensity * 0.08 + cognitiveAssessment.workingMemoryLoad * 0.04;
                    break;
                    
                case 'gaba':
                    // Increases with cognitive control, decreases with conflict
                    levelChange = cognitiveAssessment.controlStrength * 0.06 - 
                                 cognitiveAssessment.conflictLevel * 0.04;
                    break;
                    
                case 'glutamate':
                    // Increases with learning and processing demands
                    levelChange = cognitiveAssessment.workingMemoryLoad * 0.03 + 
                                 fearSignal.intensity * 0.02;
                    break;
                    
                case 'acetylcholine':
                    // Increases with attention and learning
                    levelChange = cognitiveAssessment.attentionalControl * 0.04;
                    break;
            }
            
            // Apply reuptake and synthesis
            current.level += levelChange - current.reuptakeRate + current.synthesisRate;
            current.level = Math.max(0.1, Math.min(2.0, current.level)); // Physiological bounds
        });
    }

    // Integrate consciousness and metacognitive awareness
    async integrateConsciousness(fearSignal, cognitiveAssessment, contextualMemory) {
        // Update global workspace with current information
        this.consciousnessState.globalWorkspace.activeCoalitions = [
            { type: 'fear', strength: fearSignal.intensity, source: 'amygdala' },
            { type: 'control', strength: cognitiveAssessment.controlStrength, source: 'pfc' },
            { type: 'memory', strength: contextualMemory.episodicMemories.length * 0.1, source: 'hippocampus' }
        ];
        
        // Determine dominant narrative
        const coalitions = this.consciousnessState.globalWorkspace.activeCoalitions;
        const dominantCoalition = coalitions.reduce((prev, current) => 
            prev.strength > current.strength ? prev : current
        );
        
        this.consciousnessState.globalWorkspace.dominantTheme = dominantCoalition.type;
        
        // Calculate metacognitive awareness
        const metacognition = this.calculateMetacognition(fearSignal, cognitiveAssessment);
        
        // Update consciousness level based on arousal and attention
        const arousalLevel = fearSignal.intensity + cognitiveAssessment.workingMemoryLoad;
        const optimalArousal = 0.6;
        const arousalOptimality = 1 - Math.abs(arousalLevel - optimalArousal);
        
        this.consciousnessState.awarenessLevel = arousalOptimality * 
            cognitiveAssessment.attentionalControl * metacognition.selfAwareness;
        
        // Calculate binding coherence
        const bindingCoherence = this.calculateBindingCoherence(
            fearSignal, cognitiveAssessment, contextualMemory
        );
        
        return {
            awarenessLevel: this.consciousnessState.awarenessLevel,
            dominantTheme: this.consciousnessState.globalWorkspace.dominantTheme,
            metacognition,
            bindingCoherence,
            coalitionStrengths: coalitions.map(c => ({ type: c.type, strength: c.strength })),
            consciousnessQuality: this.assessConsciousnessQuality(arousalOptimality, metacognition)
        };
    }

    // Calculate metacognitive awareness (thinking about thinking)
    calculateMetacognition(fearSignal, cognitiveAssessment) {
        // Assess confidence in own assessment
        const assessmentConfidence = Math.max(0, 1 - cognitiveAssessment.conflictLevel);
        
        // Assess awareness of biases
        const biasAwareness = cognitiveAssessment.biasCorrections.length * 0.2;
        
        // Assess understanding of emotional state
        const emotionalAwareness = Math.min(1, fearSignal.intensity + 
            cognitiveAssessment.components.emotional);
        
        // Self-monitoring capability
        const selfMonitoring = cognitiveAssessment.components.conflict;
        
        return {
            assessmentConfidence,
            biasAwareness: Math.min(biasAwareness, 1.0),
            emotionalAwareness,
            selfMonitoring,
            selfAwareness: (assessmentConfidence + biasAwareness + emotionalAwareness + selfMonitoring) / 4
        };
    }

    // Calculate binding coherence across different processing systems
    calculateBindingCoherence(fearSignal, cognitiveAssessment, contextualMemory) {
        // Temporal binding - how well events are bound across time
        const temporalBinding = contextualMemory.contextualPrediction.confidenceLevel;
        
        // Conceptual binding - how well concepts are integrated
        const conceptualBinding = Math.min(1, cognitiveAssessment.controlStrength + 
            (1 - cognitiveAssessment.conflictLevel));
        
        // Emotional-cognitive binding
        const emotionalCognitiveBinding = 1 - Math.abs(fearSignal.intensity - 
            cognitiveAssessment.components.emotional);
        
        this.consciousnessState.bindingProblem.temporalBinding = temporalBinding;
        this.consciousnessState.bindingProblem.conceptualBinding = conceptualBinding;
        
        return {
            temporal: temporalBinding,
            conceptual: conceptualBinding,
            emotionalCognitive: emotionalCognitiveBinding,
            overall: (temporalBinding + conceptualBinding + emotionalCognitiveBinding) / 3
        };
    }

    // Assess overall consciousness quality
    assessConsciousnessQuality(arousalOptimality, metacognition) {
        const quality = arousalOptimality * metacognition.selfAwareness * 
            this.consciousnessState.attentionalFocus;
        
        if (quality > 0.8) return 'HIGH_CLARITY';
        if (quality > 0.6) return 'MODERATE_CLARITY';
        if (quality > 0.4) return 'LOW_CLARITY';
        return 'IMPAIRED';
    }

    // Generate final risk recommendation
    generateRiskRecommendation(consciousAssessment) {
        const fearLevel = consciousAssessment.coalitionStrengths.find(c => c.type === 'fear')?.strength || 0;
        const controlLevel = consciousAssessment.coalitionStrengths.find(c => c.type === 'control')?.strength || 0;
        const awarenessLevel = consciousAssessment.awarenessLevel;
        
        // Risk level calculation
        const riskLevel = fearLevel * (2 - controlLevel) * (2 - awarenessLevel);
        
        // Determine action based on risk level and consciousness quality
        let action = 'HOLD';
        let reason = 'Neutral assessment';
        let urgency = 'LOW';
        
        if (riskLevel > this.panicThresholds.fear.panic) {
            action = 'EMERGENCY_EXIT';
            reason = 'Extreme fear with potential consciousness impairment';
            urgency = 'CRITICAL';
        } else if (riskLevel > this.panicThresholds.fear.severe) {
            action = 'REDUCE_POSITION';
            reason = 'High fear level detected, reduce exposure';
            urgency = 'HIGH';
        } else if (riskLevel > this.panicThresholds.fear.moderate) {
            action = 'CAUTIOUS_HOLD';
            reason = 'Moderate fear, maintain vigilance';
            urgency = 'MEDIUM';
        } else if (controlLevel > 0.8 && awarenessLevel > 0.7) {
            action = 'CONSIDER_OPPORTUNITY';
            reason = 'High cognitive control and awareness';
            urgency = 'LOW';
        }
        
        // Additional consciousness-based modifiers
        if (consciousAssessment.consciousnessQuality === 'IMPAIRED') {
            action = 'DEFER_DECISION';
            reason = 'Consciousness impaired, defer complex decisions';
            urgency = 'HIGH';
        }
        
        return {
            action,
            reason,
            urgency,
            riskLevel,
            fearComponent: fearLevel,
            controlComponent: controlLevel,
            awarenessComponent: awarenessLevel,
            confidence: Math.min(awarenessLevel + controlLevel, 1.0),
            biologicalBasis: this.identifyBiologicalBasis(fearLevel, controlLevel),
            timeframe: this.recommendTimeframe(riskLevel, urgency)
        };
    }

    // Identify biological basis for recommendation
    identifyBiologicalBasis(fearLevel, controlLevel) {
        if (fearLevel > 0.8 && controlLevel < 0.3) {
            return 'Amygdala hyperactivation with prefrontal hypoactivation (fear hijack)';
        } else if (controlLevel > 0.8 && fearLevel < 0.3) {
            return 'Strong prefrontal control with minimal fear response (optimal state)';
        } else if (fearLevel > 0.6 && controlLevel > 0.6) {
            return 'Balanced fear-control processing (adaptive caution)';
        } else {
            return 'Moderate neural activation across fear and control systems';
        }
    }

    // Recommend decision timeframe
    recommendTimeframe(riskLevel, urgency) {
        if (urgency === 'CRITICAL') {
            return 'IMMEDIATE'; // Execute within seconds
        } else if (urgency === 'HIGH') {
            return 'SHORT_TERM'; // Execute within minutes
        } else if (riskLevel > 0.5) {
            return 'MEDIUM_TERM'; // Execute within hours
        } else {
            return 'LONG_TERM'; // No immediate pressure
        }
    }

    // Update memory consolidation and learning
    async updateMemoryConsolidation(marketState, riskRecommendation) {
        // Create memory of current episode
        const episode = {
            context: this.extractContextualFeatures(marketState),
            fearLevel: riskRecommendation.fearComponent,
            controlLevel: riskRecommendation.controlComponent,
            action: riskRecommendation.action,
            timestamp: Date.now(),
            emotionalTag: riskRecommendation.fearComponent * 2, // Emotional memories are stronger
            outcome: null // Will be updated later when outcome is known
        };
        
        // Store in episodic memory
        const episodeId = `episode_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.memoryConsolidation.longTermMemory.episodic.set(episodeId, episode);
        
        // Store emotional memory association
        this.emotionalMemory.set(episode.context, {
            fearLevel: episode.fearLevel,
            action: episode.action,
            timestamp: episode.timestamp,
            outcome: episode.outcome
        });
        
        // Update short-term memory
        this.memoryConsolidation.shortTermMemory.contents.push({
            type: 'risk_assessment',
            content: riskRecommendation,
            timestamp: Date.now()
        });
        
        // Maintain short-term memory capacity
        while (this.memoryConsolidation.shortTermMemory.contents.length > 
               this.memoryConsolidation.shortTermMemory.capacity) {
            this.memoryConsolidation.shortTermMemory.contents.shift();
        }
        
        // Sleep-like consolidation (background memory strengthening)
        if (Math.random() < 0.1) { // 10% chance per assessment
            this.performMemoryConsolidation();
        }
    }

    // Perform memory consolidation (simulated sleep process)
    performMemoryConsolidation() {
        // Strengthen important memories and weaken less important ones
        for (const [episodeId, episode] of this.memoryConsolidation.longTermMemory.episodic) {
            // Strengthen emotionally tagged memories
            if (episode.emotionalTag > 0.7) {
                episode.strength = (episode.strength || 1.0) * 
                    this.memoryConsolidation.consolidationProcess.emotionalTagging;
            }
            
            // Decay memories based on age and importance
            const age = (Date.now() - episode.timestamp) / (24 * 60 * 60 * 1000); // Days
            const decayFactor = Math.exp(-age * this.memoryConsolidation.consolidationProcess.interferenceDecay);
            
            episode.strength = (episode.strength || 1.0) * decayFactor;
            
            // Remove very weak memories
            if (episode.strength < 0.1) {
                this.memoryConsolidation.longTermMemory.episodic.delete(episodeId);
            }
        }
    }

    // Update fear conditioning based on outcomes
    updateFearConditioning(threatFeatures, fearIntensity) {
        const patternKey = threatFeatures.map(f => Math.round(f * 10) / 10).join(',');
        
        if (this.fearConditioning.has(patternKey)) {
            const conditioning = this.fearConditioning.get(patternKey);
            conditioning.strength = conditioning.strength * 0.9 + fearIntensity * 0.1;
            conditioning.reliability = Math.min(conditioning.reliability * 1.1, 1.0);
            conditioning.occurrences++;
        } else {
            this.fearConditioning.set(patternKey, {
                pattern: threatFeatures,
                strength: fearIntensity,
                reliability: 0.5,
                occurrences: 1,
                timestamp: Date.now()
            });
        }
    }

    // Forward pass through neural network
    forwardPassNeuralNetwork(network, input) {
        let activation = input;
        const layerActivations = [input];
        
        for (let i = 1; i < network.layers.length; i++) {
            const layer = network.layers[i];
            const output = Array(layer.size).fill(0);
            
            // Matrix multiplication with weights and bias
            for (let j = 0; j < layer.size; j++) {
                let sum = layer.bias[j] || 0;
                
                for (let k = 0; k < activation.length; k++) {
                    sum += activation[k] * (layer.weights[k]?.[j] || 0);
                }
                
                // Apply activation function
                switch (layer.activation) {
                    case 'sigmoid':
                        output[j] = 1 / (1 + Math.exp(-sum));
                        break;
                    case 'tanh':
                        output[j] = Math.tanh(sum);
                        break;
                    case 'relu':
                        output[j] = Math.max(0, sum);
                        break;
                    default:
                        output[j] = sum;
                }
            }
            
            activation = output;
            layerActivations.push(activation);
        }
        
        return {
            output: activation,
            layers: layerActivations,
            activation: activation.reduce((sum, val) => sum + val, 0) / activation.length
        };
    }

    // Predict outcome based on current signals
    predictOutcome(fearSignal) {
        // Simple outcome prediction based on fear level
        return Math.max(0, 1 - fearSignal.intensity); // Higher fear = lower predicted outcome
    }

    // Get current neurotransmitter state
    getCurrentNeurotransmitterState() {
        const state = {};
        Object.keys(this.neurotransmitters).forEach(nt => {
            state[nt] = this.neurotransmitters[nt].level;
        });
        return state;
    }

    // Generate biological explanation
    generateBiologicalExplanation(consciousAssessment) {
        const explanations = [];
        
        const fearLevel = consciousAssessment.coalitionStrengths.find(c => c.type === 'fear')?.strength || 0;
        const controlLevel = consciousAssessment.coalitionStrengths.find(c => c.type === 'control')?.strength || 0;
        
        if (fearLevel > 0.7) {
            explanations.push("High amygdala activation detected - threat response system engaged");
        }
        
        if (controlLevel > 0.7) {
            explanations.push("Strong prefrontal cortex activation - cognitive control systems operational");
        }
        
        if (consciousAssessment.awarenessLevel < 0.4) {
            explanations.push("Reduced consciousness level - stress may be impairing higher-order processing");
        }
        
        if (consciousAssessment.bindingCoherence.overall < 0.5) {
            explanations.push("Poor neural binding coherence - integration across brain systems compromised");
        }
        
        return explanations.length > 0 ? explanations.join('; ') : 
            "Balanced neural activation across fear and control systems";
    }

    // Update performance metrics
    updateMetrics(fearSignal, riskRecommendation) {
        this.metrics.fearSignalsProcessed++;
        
        // Update average fear level
        this.metrics.avgFearLevel = (this.metrics.avgFearLevel * (this.metrics.fearSignalsProcessed - 1) + 
            fearSignal.intensity) / this.metrics.fearSignalsProcessed;
        
        // Count panic events
        if (fearSignal.intensity > this.panicThresholds.fear.panic) {
            this.metrics.panicEventsDetected++;
        }
        
        // Count bias corrections
        if (riskRecommendation.fearComponent !== riskRecommendation.controlComponent) {
            this.metrics.cognitiveBiasCorrections++;
        }
        
        // Update consciousness level
        this.metrics.consciousnessLevel = this.consciousnessState.awarenessLevel;
        
        // Store assessment in history
        this.riskAssessmentHistory.push({
            fearLevel: fearSignal.intensity,
            controlLevel: riskRecommendation.controlComponent,
            action: riskRecommendation.action,
            riskLevel: riskRecommendation.riskLevel,
            timestamp: Date.now()
        });
        
        // Maintain history size
        if (this.riskAssessmentHistory.length > 1000) {
            this.riskAssessmentHistory = this.riskAssessmentHistory.slice(-1000);
        }
    }

    // Get consciousness neuron status
    getConsciousnessStatus() {
        return {
            name: this.name,
            version: this.version,
            metrics: this.metrics,
            consciousnessState: {
                awarenessLevel: this.consciousnessState.awarenessLevel,
                attentionalFocus: this.consciousnessState.attentionalFocus,
                metacognition: this.consciousnessState.metacognition,
                dominantTheme: this.consciousnessState.globalWorkspace.dominantTheme
            },
            neurotransmitters: this.getCurrentNeurotransmitterState(),
            memoryStats: {
                episodicMemories: this.memoryConsolidation.longTermMemory.episodic.size,
                emotionalMemories: this.emotionalMemory.size,
                fearConditionings: this.fearConditioning.size,
                shortTermLoad: this.memoryConsolidation.shortTermMemory.contents.length
            },
            panicThresholds: this.panicThresholds,
            status: 'CONSCIOUSNESS_ACTIVE'
        };
    }
}

module.exports = { ConsciousnessRiskNeuron };