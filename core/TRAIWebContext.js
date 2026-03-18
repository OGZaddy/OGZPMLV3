/**
 * TRAIWebContext - Web data fetching for TRAI market context
 *
 * Provides market data fetching from external APIs:
 * - CoinGecko (crypto prices, search)
 * - Yahoo Finance (stock prices, search)
 * - Alternative.me (Fear & Greed Index)
 * - CryptoCompare (news headlines)
 *
 * Extracted from run-empire-v2.js to reduce orchestrator size.
 */

const axios = require('axios');

/**
 * Detect asset from user query - SMART detection with fuzzy matching
 */
function detectAssetFromQuery(query) {
  const q = query.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const words = q.split(/\s+/);

  // Common crypto names → CoinGecko ID
  const cryptoPatterns = [
    { patterns: ['bitcoin', 'btc'], id: 'bitcoin', symbol: 'BTC' },
    { patterns: ['ethereum', 'eth', 'ether'], id: 'ethereum', symbol: 'ETH' },
    { patterns: ['solana', 'sol'], id: 'solana', symbol: 'SOL' },
    { patterns: ['cardano', 'ada'], id: 'cardano', symbol: 'ADA' },
    { patterns: ['xrp', 'ripple'], id: 'ripple', symbol: 'XRP' },
    { patterns: ['dogecoin', 'doge'], id: 'dogecoin', symbol: 'DOGE' },
    { patterns: ['polkadot', 'dot'], id: 'polkadot', symbol: 'DOT' },
    { patterns: ['avalanche', 'avax'], id: 'avalanche-2', symbol: 'AVAX' },
    { patterns: ['chainlink', 'link'], id: 'chainlink', symbol: 'LINK' },
    { patterns: ['polygon', 'matic'], id: 'matic-network', symbol: 'MATIC' },
    { patterns: ['litecoin', 'ltc'], id: 'litecoin', symbol: 'LTC' },
    { patterns: ['binance', 'bnb'], id: 'binancecoin', symbol: 'BNB' },
    { patterns: ['shiba', 'shib'], id: 'shiba-inu', symbol: 'SHIB' },
    { patterns: ['tron', 'trx'], id: 'tron', symbol: 'TRX' },
    { patterns: ['uniswap', 'uni'], id: 'uniswap', symbol: 'UNI' }
  ];

  // Common stock names → Yahoo symbol
  const stockPatterns = [
    { patterns: ['apple', 'aapl'], symbol: 'AAPL' },
    { patterns: ['tesla', 'tsla'], symbol: 'TSLA' },
    { patterns: ['microsoft', 'msft'], symbol: 'MSFT' },
    { patterns: ['google', 'googl', 'alphabet'], symbol: 'GOOGL' },
    { patterns: ['amazon', 'amzn'], symbol: 'AMZN' },
    { patterns: ['nvidia', 'nvda'], symbol: 'NVDA' },
    { patterns: ['meta', 'facebook', 'fb'], symbol: 'META' },
    { patterns: ['netflix', 'nflx'], symbol: 'NFLX' },
    { patterns: ['spy', 'sp500', 's&p', 'snp'], symbol: 'SPY' },
    { patterns: ['qqq', 'qq', 'nasdaq', 'nas', 'tech'], symbol: 'QQQ' },
    { patterns: ['amd'], symbol: 'AMD' },
    { patterns: ['intel', 'intc'], symbol: 'INTC' },
    { patterns: ['disney', 'dis'], symbol: 'DIS' },
    { patterns: ['boeing', 'ba'], symbol: 'BA' },
    { patterns: ['jpmorgan', 'jpm'], symbol: 'JPM' },
    { patterns: ['walmart', 'wmt'], symbol: 'WMT' },
    { patterns: ['costco', 'cost'], symbol: 'COST' }
  ];

  // Fuzzy match helper
  const fuzzyMatch = (pattern) => {
    for (const word of words) {
      if (word === pattern) return true;
      if (word.startsWith(pattern)) return true;
      if (pattern.startsWith(word) && word.length >= 2) return true;
      if (Math.abs(word.length - pattern.length) <= 1) {
        let diffs = 0;
        const longer = word.length >= pattern.length ? word : pattern;
        const shorter = word.length < pattern.length ? word : pattern;
        for (let i = 0; i < longer.length && diffs <= 1; i++) {
          if (longer[i] !== shorter[i]) diffs++;
        }
        if (diffs <= 1 && shorter.length >= 2) return true;
      }
    }
    return false;
  };

  // Check crypto first
  for (const crypto of cryptoPatterns) {
    for (const pattern of crypto.patterns) {
      if (fuzzyMatch(pattern)) {
        return { type: 'crypto', id: crypto.id, symbol: crypto.symbol };
      }
    }
  }

  // Check stocks
  for (const stock of stockPatterns) {
    for (const pattern of stock.patterns) {
      if (fuzzyMatch(pattern)) {
        return { type: 'stock', symbol: stock.symbol };
      }
    }
  }

  // Try ticker-like word
  const tickerMatch = query.match(/\b([A-Z]{2,5})\b/);
  if (tickerMatch) {
    return { type: 'stock', symbol: tickerMatch[1] };
  }

  // Extract likely asset name for API search
  const assetWords = words.filter(w =>
    w.length >= 2 &&
    !['how', 'what', 'is', 'the', 'are', 'doing', 'like', 'about', 'whats', 'hows'].includes(w)
  );

  if (assetWords.length > 0) {
    return { type: 'search', query: assetWords.join(' ') };
  }

  // Default to Bitcoin
  return { type: 'crypto', id: 'bitcoin', symbol: 'BTC' };
}

/**
 * Search CoinGecko for a crypto by name
 */
async function searchCrypto(searchQuery) {
  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(searchQuery)}`,
      { timeout: 3000 }
    );
    const coins = response.data.coins || [];
    if (coins.length > 0) {
      const top = coins[0];
      console.log(`🔍 [TRAI Search] Found crypto: ${top.name} (${top.symbol})`);
      return { type: 'crypto', id: top.id, symbol: top.symbol.toUpperCase() };
    }
  } catch (error) {
    console.warn('⚠️ Crypto search failed:', error.message);
  }
  return null;
}

/**
 * Search Yahoo Finance for a stock by name
 */
async function searchStock(searchQuery) {
  try {
    const response = await axios.get(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchQuery)}&quotesCount=1`,
      { timeout: 3000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const quotes = response.data.quotes || [];
    if (quotes.length > 0) {
      const top = quotes[0];
      console.log(`🔍 [TRAI Search] Found stock: ${top.shortname || top.symbol} (${top.symbol})`);
      return { type: 'stock', symbol: top.symbol };
    }
  } catch (error) {
    console.warn('⚠️ Stock search failed:', error.message);
  }
  return null;
}

/**
 * Fetch Fear & Greed Index from alternative.me
 */
async function fetchFearGreedIndex() {
  try {
    const response = await axios.get(
      'https://api.alternative.me/fng/?limit=1',
      { timeout: 5000 }
    );

    const data = response.data.data[0];
    return {
      value: parseInt(data.value),
      classification: data.value_classification,
      timestamp: parseInt(data.timestamp) * 1000,
      nextUpdate: data.time_until_update || 'unknown'
    };
  } catch (error) {
    console.warn(`⚠️ [TRAI] Fear & Greed fetch failed: ${error.message}`);
    return null;
  }
}

/**
 * Fetch crypto news headlines from CryptoCompare
 */
async function fetchCryptoNewsHeadlines() {
  try {
    const response = await axios.get(
      'https://min-api.cryptocompare.com/data/v2/news/?categories=BTC&excludeCategories=Sponsored',
      { timeout: 5000 }
    );

    const headlines = response.data.Data?.slice(0, 3).map(article => ({
      title: article.title,
      source: article.source_info?.name || article.source,
      time: new Date(article.published_on * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    })) || [];

    return headlines;
  } catch (error) {
    console.warn(`⚠️ [TRAI] News fetch failed: ${error.message}`);
    return [];
  }
}

/**
 * Fetch crypto market data from CoinGecko + Fear & Greed Index + News Headlines
 */
async function fetchCryptoContext(coinId, symbol) {
  const [coinResponse, fearGreed, newsHeadlines] = await Promise.all([
    axios.get(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`,
      { timeout: 5000 }
    ),
    fetchFearGreedIndex(),
    fetchCryptoNewsHeadlines()
  ]);

  const data = coinResponse.data;
  const market = data.market_data;

  return {
    source: 'coingecko',
    assetType: 'crypto',
    asset: symbol,
    assetName: data.name,
    timestamp: Date.now(),
    price: market.current_price?.usd || 0,
    change24h: market.price_change_percentage_24h?.toFixed(2) + '%',
    change7d: market.price_change_percentage_7d?.toFixed(2) + '%',
    change30d: market.price_change_percentage_30d?.toFixed(2) + '%',
    high24h: market.high_24h?.usd || 0,
    low24h: market.low_24h?.usd || 0,
    ath: market.ath?.usd || 0,
    athDate: market.ath_date?.usd?.split('T')[0] || 'unknown',
    athChangePercent: market.ath_change_percentage?.usd?.toFixed(2) + '%',
    marketCap: market.market_cap?.usd || 0,
    marketCapRank: data.market_cap_rank || 0,
    sentimentUp: data.sentiment_votes_up_percentage || 50,
    sentimentDown: data.sentiment_votes_down_percentage || 50,
    fearGreedIndex: fearGreed?.value || null,
    fearGreedLabel: fearGreed?.classification || null,
    newsHeadlines: newsHeadlines || []
  };
}

/**
 * Fetch stock market data from Yahoo Finance
 */
async function fetchStockContext(symbol) {
  const response = await axios.get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1mo`,
    { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } }
  );

  const result = response.data.chart.result[0];
  const meta = result.meta;
  const quotes = result.indicators.quote[0];
  const closes = quotes.close.filter(c => c !== null);

  const currentPrice = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose || meta.previousClose;
  const change24h = ((currentPrice - prevClose) / prevClose * 100).toFixed(2);

  const price7dAgo = closes[closes.length - 6] || closes[0];
  const price30dAgo = closes[0];
  const change7d = ((currentPrice - price7dAgo) / price7dAgo * 100).toFixed(2);
  const change30d = ((currentPrice - price30dAgo) / price30dAgo * 100).toFixed(2);

  return {
    source: 'yahoo_finance',
    assetType: 'stock',
    asset: symbol,
    assetName: meta.shortName || symbol,
    timestamp: Date.now(),
    price: currentPrice,
    change24h: change24h + '%',
    change7d: change7d + '%',
    change30d: change30d + '%',
    high24h: meta.regularMarketDayHigh || currentPrice,
    low24h: meta.regularMarketDayLow || currentPrice,
    ath: meta.fiftyTwoWeekHigh || currentPrice,
    athDate: 'within 52 weeks',
    athChangePercent: ((currentPrice - meta.fiftyTwoWeekHigh) / meta.fiftyTwoWeekHigh * 100).toFixed(2) + '%',
    marketCap: meta.marketCap || 0,
    marketCapRank: 0,
    sentimentUp: 50,
    sentimentDown: 50
  };
}

/**
 * Get market context for any asset (crypto or stock)
 * Main entry point for TRAI queries
 */
async function getMarketContext(query) {
  let asset = detectAssetFromQuery(query);

  // If search type, try API lookup
  if (asset.type === 'search') {
    const cryptoResult = await searchCrypto(asset.query);
    if (cryptoResult) {
      asset = cryptoResult;
    } else {
      const stockResult = await searchStock(asset.query);
      if (stockResult) {
        asset = stockResult;
      } else {
        // Default to Bitcoin if search fails
        asset = { type: 'crypto', id: 'bitcoin', symbol: 'BTC' };
      }
    }
  }

  // Fetch context based on asset type
  if (asset.type === 'crypto') {
    return await fetchCryptoContext(asset.id, asset.symbol);
  } else if (asset.type === 'stock') {
    return await fetchStockContext(asset.symbol);
  }

  // Fallback
  return await fetchCryptoContext('bitcoin', 'BTC');
}

module.exports = {
  detectAssetFromQuery,
  searchCrypto,
  searchStock,
  fetchFearGreedIndex,
  fetchCryptoNewsHeadlines,
  fetchCryptoContext,
  fetchStockContext,
  getMarketContext
};
