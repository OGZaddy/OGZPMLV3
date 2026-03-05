// OGZSentimentAnalyzer.js - Advanced NLP Sentiment Analysis for Trading
// Analyzes news, social media, and market sentiment using NLP

const fs = require('fs');
const path = require('path');

class OGZSentimentAnalyzer {
    constructor(options = {}) {
        this.sentimentThreshold = options.sentimentThreshold || 0.6;
        this.newsImportance = options.newsImportance || 0.3;
        this.socialWeight = options.socialWeight || 0.2;
        this.technicalWeight = options.technicalWeight || 0.5;
        
        // Sentiment lexicons
        this.positiveWords = new Set();
        this.negativeWords = new Set();
        this.stockSpecificTerms = new Map();
        
        // Market-specific sentiment patterns
        this.bullishPatterns = [];
        this.bearishPatterns = [];
        
        this.initializeLexicons();
        this.loadCustomTerms();
    }

    initializeLexicons() {
        // Financial positive sentiment words
        const bullishTerms = [
            'bullish', 'rally', 'surge', 'gain', 'profit', 'growth', 'strong', 'positive',
            'outperform', 'beat', 'exceed', 'upgrade', 'buy', 'target', 'momentum',
            'breakthrough', 'acquisition', 'merger', 'expansion', 'revenue', 'earnings',
            'dividend', 'buyback', 'innovation', 'partnership', 'contract', 'deal',
            'record', 'high', 'peak', 'soar', 'climb', 'rise', 'increase', 'boost'
        ];

        // Financial negative sentiment words
        const bearishTerms = [
            'bearish', 'crash', 'plunge', 'loss', 'decline', 'weak', 'negative', 'sell',
            'underperform', 'miss', 'downgrade', 'warning', 'concern', 'risk', 'volatility',
            'recession', 'inflation', 'debt', 'bankruptcy', 'lawsuit', 'investigation',
            'scandal', 'fraud', 'layoffs', 'closure', 'suspension', 'delay', 'cancel',
            'low', 'drop', 'fall', 'decrease', 'cut', 'reduce', 'struggle', 'challenge'
        ];

        bullishTerms.forEach(term => this.positiveWords.add(term.toLowerCase()));
        bearishTerms.forEach(term => this.negativeWords.add(term.toLowerCase()));

        // Market-specific patterns (regex patterns for more complex sentiment)
        this.bullishPatterns = [
            /price\s+target\s+(?:raised|increased|upgraded)/i,
            /earnings\s+(?:beat|exceed|surprise)/i,
            /revenue\s+(?:growth|increase|surge)/i,
            /strong\s+(?:buy|recommendation|outlook)/i,
            /analyst\s+upgrade/i,
            /institutional\s+buying/i,
            /insider\s+buying/i,
            /short\s+squeeze/i
        ];

        this.bearishPatterns = [
            /price\s+target\s+(?:lowered|decreased|downgraded)/i,
            /earnings\s+(?:miss|disappoint|warn)/i,
            /revenue\s+(?:decline|decrease|drop)/i,
            /analyst\s+downgrade/i,
            /institutional\s+selling/i,
            /insider\s+selling/i,
            /short\s+interest\s+(?:high|increasing)/i,
            /guidance\s+(?:lowered|reduced|cut)/i
        ];
    }

    // Analyze sentiment from text (news articles, social media posts, etc.)
    analyzeSentiment(text, symbol = null) {
        if (!text || typeof text !== 'string') {
            return { sentiment: 0, confidence: 0, signals: [] };
        }

        const cleanText = this.preprocessText(text);
        const words = cleanText.split(/\s+/);
        
        let positiveScore = 0;
        let negativeScore = 0;
        let totalWords = words.length;
        let signals = [];

        // Word-level sentiment analysis
        words.forEach(word => {
            const lowerWord = word.toLowerCase();
            
            if (this.positiveWords.has(lowerWord)) {
                positiveScore += 1;
                signals.push({ type: 'positive', word: lowerWord, weight: 1 });
            }
            
            if (this.negativeWords.has(lowerWord)) {
                negativeScore += 1;
                signals.push({ type: 'negative', word: lowerWord, weight: 1 });
            }

            // Symbol-specific terms
            if (symbol && this.stockSpecificTerms.has(symbol)) {
                const symbolTerms = this.stockSpecificTerms.get(symbol);
                if (symbolTerms.positive.has(lowerWord)) {
                    positiveScore += 1.5; // Higher weight for symbol-specific terms
                    signals.push({ type: 'positive', word: lowerWord, weight: 1.5, symbolSpecific: true });
                }
                if (symbolTerms.negative.has(lowerWord)) {
                    negativeScore += 1.5;
                    signals.push({ type: 'negative', word: lowerWord, weight: 1.5, symbolSpecific: true });
                }
            }
        });

        // Pattern-level sentiment analysis
        this.bullishPatterns.forEach((pattern, index) => {
            if (pattern.test(text)) {
                positiveScore += 3; // Patterns have higher weight
                signals.push({ type: 'positive', pattern: `bullish_pattern_${index}`, weight: 3 });
            }
        });

        this.bearishPatterns.forEach((pattern, index) => {
            if (pattern.test(text)) {
                negativeScore += 3;
                signals.push({ type: 'negative', pattern: `bearish_pattern_${index}`, weight: 3 });
            }
        });

        // Calculate final sentiment score (-1 to 1)
        const rawScore = (positiveScore - negativeScore) / Math.max(totalWords, 1);
        const sentiment = Math.max(-1, Math.min(1, rawScore));
        
        // Calculate confidence based on signal strength
        const totalSignals = positiveScore + negativeScore;
        const confidence = Math.min(1, totalSignals / Math.max(totalWords * 0.1, 1));

        return {
            sentiment: sentiment,
            confidence: confidence,
            signals: signals,
            positiveScore: positiveScore,
            negativeScore: negativeScore,
            wordCount: totalWords
        };
    }

    // Analyze multiple news articles and aggregate sentiment
    analyzeNewsCollection(articles, symbol = null) {
        if (!articles || articles.length === 0) {
            return { overallSentiment: 0, confidence: 0, articleCount: 0 };
        }

        let totalSentiment = 0;
        let totalConfidence = 0;
        let validArticles = 0;

        const articleAnalyses = articles.map(article => {
            const title = article.title || '';
            const content = article.content || article.description || '';
            const fullText = `${title} ${content}`;
            
            const analysis = this.analyzeSentiment(fullText, symbol);
            
            // Weight by confidence and recency
            const recencyWeight = this.calculateRecencyWeight(article.publishedAt);
            const weightedSentiment = analysis.sentiment * analysis.confidence * recencyWeight;
            
            if (analysis.confidence > 0.1) { // Only count articles with reasonable confidence
                totalSentiment += weightedSentiment;
                totalConfidence += analysis.confidence * recencyWeight;
                validArticles++;
            }

            return {
                ...analysis,
                recencyWeight,
                weightedSentiment,
                title: title.substring(0, 100)
            };
        });

        const overallSentiment = validArticles > 0 ? totalSentiment / totalConfidence : 0;
        const avgConfidence = validArticles > 0 ? totalConfidence / validArticles : 0;

        return {
            overallSentiment: Math.max(-1, Math.min(1, overallSentiment)),
            confidence: Math.min(1, avgConfidence),
            articleCount: validArticles,
            articles: articleAnalyses
        };
    }

    // Social media sentiment analysis (Twitter, Reddit, etc.)
    analyzeSocialSentiment(posts, symbol = null) {
        if (!posts || posts.length === 0) {
            return { sentiment: 0, confidence: 0, volume: 0 };
        }

        let sentimentSum = 0;
        let confidenceSum = 0;
        let validPosts = 0;

        posts.forEach(post => {
            const text = post.text || post.content || '';
            const analysis = this.analyzeSentiment(text, symbol);
            
            // Weight by engagement (likes, retweets, etc.)
            const engagementWeight = this.calculateEngagementWeight(post);
            
            if (analysis.confidence > 0.05) {
                sentimentSum += analysis.sentiment * analysis.confidence * engagementWeight;
                confidenceSum += analysis.confidence * engagementWeight;
                validPosts++;
            }
        });

        const avgSentiment = validPosts > 0 ? sentimentSum / confidenceSum : 0;
        const avgConfidence = validPosts > 0 ? confidenceSum / validPosts : 0;

        return {
            sentiment: Math.max(-1, Math.min(1, avgSentiment)),
            confidence: Math.min(1, avgConfidence),
            volume: validPosts,
            totalPosts: posts.length
        };
    }

    // Generate comprehensive market sentiment score
    generateMarketSentiment(newsData, socialData, technicalData, symbol) {
        const newsAnalysis = this.analyzeNewsCollection(newsData, symbol);
        const socialAnalysis = this.analyzeSocialSentiment(socialData, symbol);
        
        // Weighted sentiment combination
        const newsSentiment = newsAnalysis.overallSentiment * newsAnalysis.confidence * this.newsImportance;
        const socialSentiment = socialAnalysis.sentiment * socialAnalysis.confidence * this.socialWeight;
        const technicalSentiment = (technicalData?.sentiment || 0) * this.technicalWeight;

        const combinedSentiment = newsSentiment + socialSentiment + technicalSentiment;
        const maxPossibleWeight = this.newsImportance + this.socialWeight + this.technicalWeight;
        const normalizedSentiment = combinedSentiment / maxPossibleWeight;

        // Generate trading signals based on sentiment
        const signals = this.generateTradingSignals(normalizedSentiment, {
            news: newsAnalysis,
            social: socialAnalysis,
            technical: technicalData
        });

        return {
            overallSentiment: Math.max(-1, Math.min(1, normalizedSentiment)),
            confidence: Math.min(1, (newsAnalysis.confidence + socialAnalysis.confidence) / 2),
            components: {
                news: newsAnalysis,
                social: socialAnalysis,
                technical: technicalData
            },
            signals: signals,
            recommendation: this.generateRecommendation(normalizedSentiment, signals)
        };
    }

    generateTradingSignals(sentiment, components) {
        const signals = [];

        // Strong bullish sentiment
        if (sentiment > 0.7) {
            signals.push({
                type: 'BUY',
                strength: 'STRONG',
                reason: 'Very positive market sentiment',
                confidence: Math.min(1, sentiment)
            });
        }
        // Moderate bullish sentiment
        else if (sentiment > 0.3) {
            signals.push({
                type: 'BUY',
                strength: 'MODERATE',
                reason: 'Positive market sentiment',
                confidence: Math.min(1, sentiment * 0.8)
            });
        }
        // Strong bearish sentiment
        else if (sentiment < -0.7) {
            signals.push({
                type: 'SELL',
                strength: 'STRONG',
                reason: 'Very negative market sentiment',
                confidence: Math.min(1, Math.abs(sentiment))
            });
        }
        // Moderate bearish sentiment
        else if (sentiment < -0.3) {
            signals.push({
                type: 'SELL',
                strength: 'MODERATE',
                reason: 'Negative market sentiment',
                confidence: Math.min(1, Math.abs(sentiment) * 0.8)
            });
        }
        // Neutral/mixed signals
        else {
            signals.push({
                type: 'HOLD',
                strength: 'NEUTRAL',
                reason: 'Mixed or neutral market sentiment',
                confidence: 0.5
            });
        }

        // Add specific component signals
        if (components.news.confidence > 0.7) {
            signals.push({
                type: components.news.overallSentiment > 0 ? 'BUY' : 'SELL',
                strength: 'NEWS_DRIVEN',
                reason: `Strong news sentiment: ${components.news.overallSentiment.toFixed(2)}`,
                confidence: components.news.confidence
            });
        }

        if (components.social.volume > 50 && components.social.confidence > 0.6) {
            signals.push({
                type: components.social.sentiment > 0 ? 'BUY' : 'SELL',
                strength: 'SOCIAL_MOMENTUM',
                reason: `High social media activity with ${components.social.sentiment > 0 ? 'positive' : 'negative'} sentiment`,
                confidence: components.social.confidence
            });
        }

        return signals;
    }

    generateRecommendation(sentiment, signals) {
        const strongSignals = signals.filter(s => s.strength === 'STRONG');
        const buySignals = signals.filter(s => s.type === 'BUY').length;
        const sellSignals = signals.filter(s => s.type === 'SELL').length;

        if (strongSignals.length > 0) {
            return {
                action: strongSignals[0].type,
                confidence: strongSignals[0].confidence,
                reasoning: `Strong sentiment-based signal: ${strongSignals[0].reason}`
            };
        }

        if (buySignals > sellSignals && sentiment > 0.2) {
            return {
                action: 'BUY',
                confidence: Math.min(0.8, sentiment + 0.3),
                reasoning: 'Positive sentiment consensus across multiple sources'
            };
        }

        if (sellSignals > buySignals && sentiment < -0.2) {
            return {
                action: 'SELL',
                confidence: Math.min(0.8, Math.abs(sentiment) + 0.3),
                reasoning: 'Negative sentiment consensus across multiple sources'
            };
        }

        return {
            action: 'HOLD',
            confidence: 0.5,
            reasoning: 'Mixed or insufficient sentiment signals'
        };
    }

    // Utility functions
    preprocessText(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ') // Remove punctuation
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }

    calculateRecencyWeight(publishedAt) {
        if (!publishedAt) return 0.5;
        
        const now = new Date();
        const published = new Date(publishedAt);
        const hoursAgo = (now - published) / (1000 * 60 * 60);
        
        // More recent articles have higher weight
        if (hoursAgo < 1) return 1.0;
        if (hoursAgo < 6) return 0.9;
        if (hoursAgo < 24) return 0.7;
        if (hoursAgo < 72) return 0.5;
        return 0.3;
    }

    calculateEngagementWeight(post) {
        const likes = post.likes || post.favorites || 0;
        const shares = post.retweets || post.shares || 0;
        const comments = post.replies || post.comments || 0;
        
        const engagement = likes + (shares * 2) + (comments * 3); // Comments weighted higher
        
        // Normalize to 0.5-2.0 range
        return Math.min(2.0, 0.5 + (engagement / 100));
    }

    loadCustomTerms() {
        // Load symbol-specific sentiment terms
        // This could be loaded from a file or database
        this.stockSpecificTerms.set('AAPL', {
            positive: new Set(['iphone', 'macbook', 'innovation', 'ecosystem', 'premium']),
            negative: new Set(['competition', 'lawsuit', 'regulation', 'supply chain'])
        });

        this.stockSpecificTerms.set('TSLA', {
            positive: new Set(['autopilot', 'supercharger', 'gigafactory', 'ev', 'sustainable']),
            negative: new Set(['recall', 'investigation', 'delay', 'production issues'])
        });
    }

    // Save sentiment analysis results for learning
    saveSentimentData(analysis, symbol, outcome = null) {
        const timestamp = new Date().toISOString();
        const data = {
            timestamp,
            symbol,
            analysis,
            outcome
        };

        const savePath = path.join(__dirname, 'sentiment_history.jsonl');
        fs.appendFileSync(savePath, JSON.stringify(data) + '\n');
    }

    // Get sentiment analysis statistics
    getStats() {
        return {
            positiveWordsCount: this.positiveWords.size,
            negativeWordsCount: this.negativeWords.size,
            bullishPatternsCount: this.bullishPatterns.length,
            bearishPatternsCount: this.bearishPatterns.length,
            symbolSpecificTerms: this.stockSpecificTerms.size
        };
    }
}

module.exports = OGZSentimentAnalyzer;