/**
 * @fileoverview PatternMemoryBank - TRAI Pattern Learning & Memory System
 *
 * Persistent learning system that remembers successful and failed trading patterns.
 * Patterns progress through lifecycle: CANDIDATE → PROMOTED / QUARANTINED / DEAD
 *
 * @description
 * ARCHITECTURE ROLE:
 * PatternMemoryBank is the "long-term memory" of TRAI. It stores patterns seen
 * during trading, tracks their outcomes, and learns which patterns are profitable.
 * This enables the bot to improve over time by favoring patterns with good track records.
 *
 * PATTERN LIFECYCLE:
 * ```
 * New Pattern → CANDIDATE (needs 30 samples)
 *                    ↓
 *            ┌───────┴───────┐
 *            ↓               ↓
 *    PROMOTED (>55% win)  QUARANTINED (<45% win)
 *            ↓               ↓
 *         (active)        DEAD (pruned)
 * ```
 *
 * MODE PARTITIONING:
 * Memory files are separated by mode to prevent cross-contamination:
 * - Live:     pattern_memory.live.json
 * - Paper:    pattern_memory.paper.json
 * - Backtest: pattern_memory.backtest.json
 *
 * SCORING FORMULA:
 * score = winRate × avgR × confidence × recency − penalty
 *
 * @module core/PatternMemoryBank
 * @requires fs
 * @requires crypto (for pattern hashing)
 * @author TRAI Core Team
 * @version 2.0.0
 *
 * @example
 * const PatternMemoryBank = require('./core/PatternMemoryBank');
 * const memory = new PatternMemoryBank({ featureFlags });
 *
 * // Record a pattern outcome
 * memory.recordOutcome(patternHash, { won: true, pnlPercent: 1.5, holdMs: 60000 });
 *
 * // Check pattern status before trading
 * const pattern = memory.getPattern(hash);
 * if (pattern?.status === 'QUARANTINED') {
 *   console.log('Skipping quarantined pattern');
 * }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Ensure logs directory exists (fire-and-forget at module load)
const LOGS_DIR = path.join(__dirname, '..', 'logs');
try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (_) {}
const TRADE_OUTCOMES_LOG = path.join(LOGS_DIR, 'trade-outcomes.log');

// Status constants
const STATUS = {
  CANDIDATE: 'CANDIDATE',
  PROMOTED: 'PROMOTED',
  QUARANTINED: 'QUARANTINED',
  DEAD: 'DEAD'
};

// Thresholds
const MIN_SAMPLES_PROMOTE = 30;
const MIN_SAMPLES_QUAR = 15;
const MIN_WINRATE_PROMOTE = 0.55;
const MIN_AVG_R_PROMOTE = 0.15;
const MAX_WINRATE_QUAR = 0.45;
const MAX_PATTERNS = 10000;

class PatternMemoryBank {
    constructor(config = {}) {
        // Mode-aware pattern memory persistence to prevent contamination
        let mode = 'paper';  // Default to paper
        if (process.env.BACKTEST_MODE === 'true') {
            mode = 'backtest';
        } else if (process.env.TRADING_MODE === 'live' || process.env.ENABLE_LIVE_TRADING === 'true') {
            mode = 'live';
        } else if (process.env.TRADING_MODE === 'paper' || process.env.PAPER_TRADING === 'true') {
            mode = 'paper';
        }
        const featureFlags = config.featureFlags || {};
        const partitionSettings = featureFlags.PATTERN_MEMORY_PARTITION?.settings || {};

        // Determine file based on mode
        let memoryFile = 'learned_patterns.json';
        if (partitionSettings[mode]) {
            memoryFile = partitionSettings[mode];
        } else if (mode === 'live') {
            memoryFile = 'pattern_memory.live.json';
        } else if (mode === 'paper') {
            memoryFile = 'pattern_memory.paper.json';
        } else if (mode === 'backtest') {
            memoryFile = 'pattern_memory.backtest.json';
        }

        // If dbPath is provided in config, modify it based on mode
        if (config.dbPath) {
            const basePath = config.dbPath.replace('.json', '');
            this.dbPath = `${basePath}.${mode}.json`;
            this.backupPath = `${basePath}.${mode}.backup.json`;
        } else {
            const dataDir = process.env.DATA_DIR || path.join(__dirname, '..');
            this.dbPath = path.join(dataDir, memoryFile);
            this.backupPath = path.join(dataDir, memoryFile.replace('.json', '.backup.json'));
        }

        // Disable persistence for backtest mode if configured
        this.persistenceEnabled = mode !== 'backtest' || partitionSettings.backtestPersist !== false;

        console.log(`🧠 [TRAI Memory] Mode: ${mode}, File: ${memoryFile}, Persist: ${this.persistenceEnabled}`);

        // Statistical thresholds
        this.minTradesSample = config.minTradesSample || 10;  // Need 10+ occurrences
        this.successThreshold = config.successThreshold || 0.65;  // 65%+ win rate = success
        this.failureThreshold = config.failureThreshold || 0.35;  // <35% win rate = avoid
        this.maxPatternAge = config.maxPatternAge || 90 * 24 * 60 * 60 * 1000;  // 90 days in ms

        // Load existing memory or create new
        this.memory = this.loadMemory();

        // Count by status
        const counts = { CANDIDATE: 0, PROMOTED: 0, QUARANTINED: 0, DEAD: 0 };
        for (const record of Object.values(this.memory.patterns)) {
            counts[record.status] = (counts[record.status] || 0) + 1;
        }
        console.log(`🧠 [TRAI Memory] Initialized: ${counts.PROMOTED} promoted, ${counts.QUARANTINED} quarantined, ${counts.CANDIDATE} candidates`);
    }

    /**
     * Load memory from disk or initialize new memory structure
     */
    loadMemory() {
        try {
            if (fs.existsSync(this.dbPath)) {
                const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
                console.log('💾 [TRAI Memory] Loaded from disk:', this.dbPath);
                return this.validateMemoryStructure(data);
            }
        } catch (error) {
            console.warn('⚠️ [TRAI Memory] Failed to load, creating new:', error.message);
        }

        return this.createEmptyMemory();
    }

    /**
     * Create empty memory structure
     */
    createEmptyMemory() {
        return {
            patterns: {},
            metadata: {
                version: '2.0.0',
                created: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                totalTrades: 0,
                totalWins: 0,
                totalLosses: 0
            }
        };
    }

    /**
     * Validate and migrate memory structure if needed
     */
    validateMemoryStructure(data) {
        const empty = this.createEmptyMemory();

        // Migrate from v1 (successfulPatterns/failedPatterns) to v2 (patterns)
        let patterns = data.patterns || {};
        if (data.successfulPatterns || data.failedPatterns) {
            // Migrate old structure
            for (const [hash, record] of Object.entries(data.successfulPatterns || {})) {
                patterns[hash] = this.migratePatternRecord(record, STATUS.PROMOTED);
            }
            for (const [hash, record] of Object.entries(data.failedPatterns || {})) {
                patterns[hash] = this.migratePatternRecord(record, STATUS.QUARANTINED);
            }
        }

        return {
            patterns,
            metadata: {
                ...empty.metadata,
                ...data.metadata,
                version: '2.0.0',
                lastUpdated: new Date().toISOString()
            }
        };
    }

    /**
     * Migrate v1 pattern record to v2 format
     */
    migratePatternRecord(old, status) {
        const sampleCount = (old.wins || 0) + (old.losses || 0);
        const avgPnLPercent = sampleCount > 0 ? (old.totalPnL || 0) / sampleCount : 0;
        return {
            name: old.name || 'unknown',
            data: old.pattern || old.data || {},
            status: status,
            sampleCount: sampleCount,
            winCount: old.wins || 0,
            lossCount: old.losses || 0,
            totalPnL: old.totalPnL || 0,
            avgPnLPercent: avgPnLPercent,
            sumPnLSquared: avgPnLPercent * avgPnLPercent * sampleCount, // Approximate
            avgHoldMs: 0,
            totalHoldMs: 0,
            firstSeenTs: old.firstSeen ? new Date(old.firstSeen).getTime() : Date.now(),
            lastSeenTs: old.lastSeen ? new Date(old.lastSeen).getTime() : Date.now(),
            lastOutcomeTs: old.lastSeen ? new Date(old.lastSeen).getTime() : Date.now(),
            score: 0
        };
    }

    /**
     * Record the outcome of a closed trade
     * This is called after every trade closes to build TRAI's memory
     *
     * @param {Object} trade - Trade data including entry, exit, P&L, and optional decisionId
     */
    recordTradeOutcome(trade) {
        try {
            const pattern = this.extractPattern(trade);

            if (!pattern || !pattern.hash) {
                console.warn('⚠️ [TRAI Memory] Invalid pattern extracted, skipping');
                return;
            }

            const now = Date.now();
            const pnlPercent = trade.profitLossPercent || 0;
            const holdMs = trade.holdDuration || 0;
            const isWin = trade.profitLoss > 0;

            // Initialize pattern record if it doesn't exist
            if (!this.memory.patterns[pattern.hash]) {
                this.memory.patterns[pattern.hash] = {
                    name: pattern.name,
                    data: pattern.data,
                    status: STATUS.CANDIDATE,
                    sampleCount: 0,
                    winCount: 0,
                    lossCount: 0,
                    totalPnL: 0,
                    avgPnLPercent: 0,
                    sumPnLSquared: 0,
                    avgHoldMs: 0,
                    totalHoldMs: 0,
                    firstSeenTs: now,
                    lastSeenTs: now,
                    lastOutcomeTs: now,
                    score: 0
                };
            }

            const record = this.memory.patterns[pattern.hash];

            // Update counts
            record.sampleCount++;
            if (isWin) {
                record.winCount++;
                this.memory.metadata.totalWins++;
            } else {
                record.lossCount++;
                this.memory.metadata.totalLosses++;
            }

            // Update PnL stats
            record.totalPnL += pnlPercent;
            record.sumPnLSquared += pnlPercent * pnlPercent;
            record.avgPnLPercent = record.totalPnL / record.sampleCount;

            // Update hold time
            record.totalHoldMs += holdMs;
            record.avgHoldMs = record.totalHoldMs / record.sampleCount;

            // Update timestamps
            record.lastSeenTs = now;
            record.lastOutcomeTs = now;

            // Update metadata
            this.memory.metadata.totalTrades++;
            this.memory.metadata.lastUpdated = new Date().toISOString();

            // Compute score and update status
            record.score = this.computeScore(record);
            this.updateStatus(record);

            // Log status changes
            const winRate = record.winCount / record.sampleCount;
            if (record.status === STATUS.PROMOTED) {
                console.log(`📚 [TRAI Memory] PROMOTED: "${pattern.name}" - ` +
                           `${(winRate * 100).toFixed(1)}% win, ${record.sampleCount} samples, ` +
                           `avgR=${record.avgPnLPercent.toFixed(2)}%, score=${record.score.toFixed(3)}`);
            } else if (record.status === STATUS.QUARANTINED) {
                console.log(`🚫 [TRAI Memory] QUARANTINED: "${pattern.name}" - ` +
                           `${(winRate * 100).toFixed(1)}% win, ${record.sampleCount} samples`);
            }

            // ═══════════════════════════════════════════════════════════════
            // TRADE OUTCOME TELEMETRY - JSONL append (fire-and-forget)
            // Ground truth for PatternMemoryBank learning evaluation
            // ═══════════════════════════════════════════════════════════════
            const tradingMode = process.env.BACKTEST_MODE === 'true' ? 'backtest' :
                               (process.env.TRADING_MODE === 'live' || process.env.ENABLE_LIVE_TRADING === 'true') ? 'live' : 'paper';

            const outcomeLabel = pnlPercent > 0.1 ? 'win' : (pnlPercent < -0.1 ? 'loss' : 'breakeven');

            const outcomeTelemetry = {
                tsMs: now,
                type: 'trade_outcome',
                tradeId: trade.tradeId || trade.id || `trade_${now}`,
                decisionId: trade.decisionId || null,  // Join key to trai-decisions.log
                symbol: trade.symbol || 'BTC-USD',
                side: trade.entry?.side || trade.side || (pnlPercent > 0 ? 'long' : 'short'),
                entry: {
                    price: trade.entry?.price || trade.entryPrice || 0,
                    ts: trade.entry?.timestamp || trade.entryTimestamp || null
                },
                exit: {
                    price: trade.exit?.price || trade.exitPrice || 0,
                    ts: trade.exit?.timestamp || trade.exitTimestamp || null,
                    reason: trade.exit?.reason || trade.exitReason || 'unknown'
                },
                pnlAbs: trade.profitLoss || 0,
                pnlPct: pnlPercent,
                fees: trade.fees || 0,
                holdMs: holdMs,
                outcomeLabel: outcomeLabel,
                patternHash: pattern.hash,
                patternName: pattern.name,
                meta: {
                    broker: 'kraken',
                    mode: tradingMode,
                    patternStatus: record.status,
                    patternScore: record.score
                }
            };

            // Async fire-and-forget (silent failure)
            fs.appendFile(TRADE_OUTCOMES_LOG, JSON.stringify(outcomeTelemetry) + '\n', () => {});

            // Save to disk
            this.saveMemory();

        } catch (error) {
            console.error('❌ [TRAI Memory] Error recording trade outcome:', error.message);
        }
    }

    /**
     * Compute pattern score
     * score = (winRate * avgR) * confidenceMultiplier * recencyMultiplier - penalty
     */
    computeScore(record) {
        if (record.sampleCount === 0) return 0;

        const winRate = record.winCount / record.sampleCount;
        const avgR = record.avgPnLPercent;

        // Confidence grows with sample count: min(1, log1p(n)/log1p(50))
        const confidenceMultiplier = Math.min(1, Math.log1p(record.sampleCount) / Math.log1p(50));

        // Recency: mild decay if not seen in 30 days
        const daysSinceLastSeen = (Date.now() - record.lastSeenTs) / (24 * 60 * 60 * 1000);
        const recencyMultiplier = daysSinceLastSeen > 30 ? Math.max(0.5, 1 - (daysSinceLastSeen - 30) / 60) : 1;

        // Variance penalty: stdDev proxy from sumPnLSquared
        const variance = record.sampleCount > 1
            ? (record.sumPnLSquared / record.sampleCount) - (avgR * avgR)
            : 0;
        const stdDev = Math.sqrt(Math.max(0, variance));
        const variancePenalty = stdDev > 2 ? (stdDev - 2) * 0.1 : 0;

        // Win rate penalty if below floor after enough samples
        const winRatePenalty = (record.sampleCount >= MIN_SAMPLES_QUAR && winRate < MAX_WINRATE_QUAR)
            ? (MAX_WINRATE_QUAR - winRate) * 2
            : 0;

        const score = (winRate * avgR) * confidenceMultiplier * recencyMultiplier - variancePenalty - winRatePenalty;
        return score;
    }

    /**
     * Update pattern status based on thresholds
     */
    updateStatus(record) {
        const winRate = record.sampleCount > 0 ? record.winCount / record.sampleCount : 0;
        const avgR = record.avgPnLPercent;

        // PROMOTED: meets all criteria
        if (record.sampleCount >= MIN_SAMPLES_PROMOTE &&
            winRate >= MIN_WINRATE_PROMOTE &&
            avgR >= MIN_AVG_R_PROMOTE) {
            record.status = STATUS.PROMOTED;
            return;
        }

        // QUARANTINED: enough samples but failing
        if (record.sampleCount >= MIN_SAMPLES_QUAR &&
            (winRate <= MAX_WINRATE_QUAR || avgR <= 0)) {
            record.status = STATUS.QUARANTINED;
            return;
        }

        // DEAD: quarantined + very old + negative score
        const daysSinceLastSeen = (Date.now() - record.lastSeenTs) / (24 * 60 * 60 * 1000);
        if (record.status === STATUS.QUARANTINED &&
            daysSinceLastSeen > 60 &&
            record.score < -0.5) {
            record.status = STATUS.DEAD;
            return;
        }

        // Otherwise stay CANDIDATE (or keep current status if already PROMOTED/QUARANTINED)
        if (record.status !== STATUS.PROMOTED && record.status !== STATUS.QUARANTINED) {
            record.status = STATUS.CANDIDATE;
        }
    }

    /**
     * Get confidence boost/penalty for a pattern based on learned history
     * Returns: { confidence, source, stats } or null if pattern unknown
     *
     * @param {Object} currentPattern - Current market pattern to check
     */
    getPatternConfidence(currentPattern) {
        try {
            const hash = this.hashPattern(currentPattern);
            const record = this.memory.patterns[hash];

            if (!record || record.sampleCount < this.minTradesSample) {
                return null;
            }

            const winRate = record.winCount / record.sampleCount;

            if (record.status === STATUS.PROMOTED) {
                console.log(`🧠 [TRAI Memory] PROMOTED MATCH: "${record.name}" - ` +
                           `${(winRate * 100).toFixed(1)}% win, ${record.sampleCount} samples, ` +
                           `score=${record.score.toFixed(3)}`);

                return {
                    confidence: winRate,
                    source: 'learned_success',
                    stats: {
                        sampleCount: record.sampleCount,
                        winCount: record.winCount,
                        lossCount: record.lossCount,
                        avgPnLPercent: record.avgPnLPercent,
                        score: record.score,
                        status: record.status
                    }
                };
            }

            if (record.status === STATUS.QUARANTINED || record.status === STATUS.DEAD) {
                console.log(`⚠️ [TRAI Memory] AVOID (${record.status}): "${record.name}" - ` +
                           `${(winRate * 100).toFixed(1)}% win, ${record.sampleCount} samples`);

                return {
                    confidence: 0.0,
                    source: 'learned_failure',
                    stats: {
                        sampleCount: record.sampleCount,
                        winCount: record.winCount,
                        lossCount: record.lossCount,
                        avgPnLPercent: record.avgPnLPercent,
                        score: record.score,
                        status: record.status,
                        reason: `Pattern ${record.status}`
                    }
                };
            }

            // CANDIDATE - not enough data to boost/penalize
            return null;

        } catch (error) {
            console.error('❌ [TRAI Memory] Error getting pattern confidence:', error.message);
            return null;
        }
    }

    /**
     * Extract pattern signature from trade data
     * Creates a consistent hash for pattern matching
     *
     * @param {Object} trade - Trade data or current market data
     */
    extractPattern(trade) {
        try {
            // Handle both closed trades and current market data
            const indicators = trade.entry?.indicators || trade.indicators;
            const trend = trade.entry?.trend || trade.trend;
            const timestamp = trade.entry?.timestamp || trade.timestamp || new Date().toISOString();

            if (!indicators || !trend) {
                return null;
            }

            // Bucket values to create pattern signatures
            // This allows similar (but not identical) market conditions to match
            const patternData = {
                // RSI in buckets of 10 (30-40, 40-50, etc) - null if missing
                rsi: indicators.rsi != null ? Math.round(indicators.rsi / 10) * 10 : null,

                // MACD direction
                macd: (indicators.macd || 0) > 0 ? 'positive' : 'negative',

                // MACD histogram strength
                macdHistogram: Math.abs(indicators.macdHistogram || 0) > 0.001 ? 'strong' : 'weak',

                // Trend
                trend: trend,

                // Primary pattern
                pattern: indicators.primaryPattern || 'none',

                // Volatility bucketed
                volatility: (trade.entry?.volatility || trade.volatility || 0) > 0.03 ? 'high' : 'low',

                // Time of day (could be relevant for crypto)
                hour: new Date(timestamp).getUTCHours()
            };

            // Create hash from pattern data
            const hash = this.hashPattern(patternData);

            // Create human-readable name
            const name = `${patternData.trend}_${patternData.pattern}_RSI${patternData.rsi}_${patternData.macd}MACD`;

            return {
                hash,
                name,
                data: patternData
            };

        } catch (error) {
            console.error('❌ [TRAI Memory] Error extracting pattern:', error.message);
            return null;
        }
    }

    /**
     * Create consistent hash from pattern data
     */
    hashPattern(patternData) {
        const str = JSON.stringify(patternData, Object.keys(patternData).sort());
        return crypto.createHash('md5').update(str).digest('hex');
    }

    /**
     * Record news correlation (keyword → price movement)
     */
    recordNewsCorrelation(keyword, priceImpact, timestamp) {
        if (!this.memory.newsCorrelations[keyword]) {
            this.memory.newsCorrelations[keyword] = {
                occurrences: 0,
                totalImpact: 0,
                avgImpact: 0,
                positiveImpacts: 0,
                negativeImpacts: 0,
                lastSeen: null
            };
        }

        const record = this.memory.newsCorrelations[keyword];
        record.occurrences++;
        record.totalImpact += priceImpact;
        record.avgImpact = record.totalImpact / record.occurrences;
        record.lastSeen = timestamp;

        if (priceImpact > 0) {
            record.positiveImpacts++;
        } else {
            record.negativeImpacts++;
        }

        // Only log if statistically significant
        if (record.occurrences >= 5) {
            console.log(`📰 [TRAI Memory] News correlation: "${keyword}" → ` +
                       `${record.avgImpact > 0 ? '+' : ''}${(record.avgImpact * 100).toFixed(2)}% ` +
                       `(${record.occurrences} occurrences)`);
        }
    }

    /**
     * Get news correlation impact for a keyword
     */
    getNewsCorrelation(keyword) {
        const record = this.memory.newsCorrelations[keyword];

        if (record && record.occurrences >= 5) {
            return {
                avgImpact: record.avgImpact,
                confidence: Math.min(record.occurrences / 20, 1.0),  // Max confidence at 20 occurrences
                occurrences: record.occurrences
            };
        }

        return null;
    }

    /**
     * Prune old, dead, and excess patterns
     * - Removes DEAD patterns
     * - Removes patterns older than maxPatternAge
     * - If over MAX_PATTERNS cap, drops lowest score oldest first
     */
    pruneOldPatterns() {
        let pruned = 0;
        const now = Date.now();

        // First pass: Remove DEAD and old patterns
        for (const [hash, record] of Object.entries(this.memory.patterns)) {
            const age = now - record.lastSeenTs;

            if (record.status === STATUS.DEAD) {
                delete this.memory.patterns[hash];
                pruned++;
                console.log(`🗑️ [TRAI Memory] Pruned DEAD: "${record.name}"`);
            } else if (age > this.maxPatternAge) {
                delete this.memory.patterns[hash];
                pruned++;
                console.log(`🗑️ [TRAI Memory] Pruned old: "${record.name}" (${Math.floor(age / (24 * 60 * 60 * 1000))} days)`);
            }
        }

        // Second pass: If still over cap, drop lowest score oldest first
        const patternCount = Object.keys(this.memory.patterns).length;
        if (patternCount > MAX_PATTERNS) {
            const toRemove = patternCount - MAX_PATTERNS;
            const sorted = Object.entries(this.memory.patterns)
                .map(([hash, record]) => ({ hash, score: record.score, lastSeenTs: record.lastSeenTs }))
                .sort((a, b) => {
                    // Sort by score ascending, then by lastSeenTs ascending (oldest first)
                    if (a.score !== b.score) return a.score - b.score;
                    return a.lastSeenTs - b.lastSeenTs;
                });

            for (let i = 0; i < toRemove && i < sorted.length; i++) {
                const { hash } = sorted[i];
                const record = this.memory.patterns[hash];
                console.log(`🗑️ [TRAI Memory] Pruned (cap): "${record.name}" score=${record.score.toFixed(3)}`);
                delete this.memory.patterns[hash];
                pruned++;
            }
        }

        if (pruned > 0) {
            console.log(`🗑️ [TRAI Memory] Pruned ${pruned} patterns total`);
            this.saveMemory();
        }

        return pruned;
    }

    /**
     * Get top patterns by score
     * @param {number} limit - Max patterns to return
     * @param {string} status - Filter by status (default: PROMOTED)
     */
    getTopPatterns(limit = 50, status = STATUS.PROMOTED) {
        return Object.entries(this.memory.patterns)
            .filter(([_, record]) => record.status === status)
            .map(([hash, record]) => ({
                hash,
                name: record.name,
                status: record.status,
                sampleCount: record.sampleCount,
                winRate: record.sampleCount > 0 ? record.winCount / record.sampleCount : 0,
                avgPnLPercent: record.avgPnLPercent,
                avgHoldMs: record.avgHoldMs,
                score: record.score,
                lastSeenTs: record.lastSeenTs
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /**
     * Get worst patterns (QUARANTINED + DEAD, lowest scores)
     * @param {number} limit - Max patterns to return
     */
    getWorstPatterns(limit = 50) {
        return Object.entries(this.memory.patterns)
            .filter(([_, record]) => record.status === STATUS.QUARANTINED || record.status === STATUS.DEAD)
            .map(([hash, record]) => ({
                hash,
                name: record.name,
                status: record.status,
                sampleCount: record.sampleCount,
                winRate: record.sampleCount > 0 ? record.winCount / record.sampleCount : 0,
                avgPnLPercent: record.avgPnLPercent,
                score: record.score,
                lastSeenTs: record.lastSeenTs
            }))
            .sort((a, b) => a.score - b.score)
            .slice(0, limit);
    }

    /**
     * Save memory to disk with backup
     */
    saveMemory() {
        // Skip saving if persistence is disabled (e.g., backtest mode)
        if (!this.persistenceEnabled) {
            console.log(`⏭️ [TRAI Memory] Skipping save (persistence disabled for mode)`);
            return;
        }

        try {
            // Create backup of existing file
            if (fs.existsSync(this.dbPath)) {
                fs.copyFileSync(this.dbPath, this.backupPath);
            }

            // Write new memory
            fs.writeFileSync(this.dbPath, JSON.stringify(this.memory, null, 2));

            const total = Object.keys(this.memory.patterns).length;
            console.log(`💾 [TRAI Memory] Saved ${total} patterns`);

        } catch (error) {
            console.error('❌ [TRAI Memory] Failed to save:', error.message);
        }
    }

    /**
     * Export memory for analysis or backup
     */
    exportMemory() {
        return JSON.parse(JSON.stringify(this.memory));
    }

    /**
     * Import memory from backup or migration
     */
    importMemory(data) {
        this.memory = this.validateMemoryStructure(data);
        this.saveMemory();
        console.log('📥 [TRAI Memory] Imported memory with',
                   Object.keys(this.memory.patterns).length, 'patterns');
    }

    /**
     * Get statistics about TRAI's learning
     */
    getStats() {
        const patterns = Object.values(this.memory.patterns);
        const counts = { CANDIDATE: 0, PROMOTED: 0, QUARANTINED: 0, DEAD: 0 };
        let totalScore = 0;
        let promotedWinRateSum = 0;
        let promotedAvgRSum = 0;

        for (const record of patterns) {
            counts[record.status] = (counts[record.status] || 0) + 1;
            totalScore += record.score;

            if (record.status === STATUS.PROMOTED && record.sampleCount > 0) {
                promotedWinRateSum += record.winCount / record.sampleCount;
                promotedAvgRSum += record.avgPnLPercent;
            }
        }

        const promotedCount = counts.PROMOTED || 0;

        return {
            totalPatterns: patterns.length,
            promoted: promotedCount,
            quarantined: counts.QUARANTINED || 0,
            candidates: counts.CANDIDATE || 0,
            dead: counts.DEAD || 0,
            totalTrades: this.memory.metadata.totalTrades,
            totalWins: this.memory.metadata.totalWins,
            totalLosses: this.memory.metadata.totalLosses,
            overallWinRate: this.memory.metadata.totalTrades > 0
                ? this.memory.metadata.totalWins / this.memory.metadata.totalTrades
                : 0,
            avgPromotedWinRate: promotedCount > 0 ? promotedWinRateSum / promotedCount : 0,
            avgPromotedR: promotedCount > 0 ? promotedAvgRSum / promotedCount : 0,
            avgScore: patterns.length > 0 ? totalScore / patterns.length : 0,
            lastUpdated: this.memory.metadata.lastUpdated,
            created: this.memory.metadata.created
        };
    }

    /**
     * Reset all memory (use with caution!)
     */
    reset() {
        console.warn('⚠️ [TRAI Memory] RESETTING ALL LEARNED PATTERNS');
        this.memory = this.createEmptyMemory();
        this.saveMemory();
    }
}

module.exports = PatternMemoryBank;
module.exports.STATUS = STATUS;
