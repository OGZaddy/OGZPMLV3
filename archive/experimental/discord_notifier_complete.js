// utils/discordNotifier.js - Discord Integration for OGZ Prime
// ===================================================================
// 📢 DISCORD NOTIFICATION SYSTEM - YOUR REMOTE COMMAND CENTER
// ===================================================================
//
// This system sends real-time trading alerts, win notifications, and
// system updates to your Discord channel so you can monitor your
// Houston fund progress from anywhere!
//
// Built for: Remote monitoring and celebration of wins! 💕
// Author: Trey (OGZPrime Technologies)
// Version: 10.2 SS-Tier Complete

const https = require('https');
const { URL } = require('url');

/**
 * ===================================================================
 * DISCORD NOTIFIER CLASS - YOUR REMOTE TRADING ASSISTANT
 * ===================================================================
 * 
 * Sends formatted Discord messages with trading updates, alerts,
 * and celebration messages when you make profitable trades.
 */
class DiscordNotifier {
  /**
   * Initialize Discord notifier
   * 
   * @param {Object} config - Configuration
   * @param {string} config.webhookUrl - Discord webhook URL
   * @param {string} config.botName - Bot display name (default: "OGZ Prime")
   * @param {string} config.avatarUrl - Bot avatar URL (optional)
   * @param {boolean} config.enableRichEmbeds - Use rich embeds (default: true)
   * @param {boolean} config.enableEmojis - Use emojis in messages (default: true)
   */
  constructor(config = {}) {
    this.config = {
      webhookUrl: config.webhookUrl || process.env.DISCORD_WEBHOOK_URL,
      botName: config.botName || 'OGZ Prime 🚀',
      avatarUrl: config.avatarUrl || null,
      enableRichEmbeds: config.enableRichEmbeds !== false,
      enableEmojis: config.enableEmojis !== false,
      enableProfitCelebrations: config.enableProfitCelebrations !== false,
      enableLossAlerts: config.enableLossAlerts !== false,
      enableSystemAlerts: config.enableSystemAlerts !== false,
      rateLimitMs: config.rateLimitMs || 1000, // Min time between messages
      
      // Message formatting
      maxMessageLength: 2000,
      embedColor: {
        profit: 0x00ff00,    // Green for profits
        loss: 0xff0000,      // Red for losses  
        info: 0x0099ff,      // Blue for info
        warning: 0xffaa00,   // Orange for warnings
        error: 0xff0000,     // Red for errors
        system: 0x800080     // Purple for system
      }
    };
    
    // Rate limiting
    this.lastMessageTime = 0;
    this.messageQueue = [];
    this.isProcessingQueue = false;
    
    // Statistics
    this.stats = {
      messagesSent: 0,
      errorsCount: 0,
      lastError: null,
      startTime: Date.now()
    };
    
    console.log('📢 Discord notifier initialized');
    
    if (!this.config.webhookUrl) {
      console.warn('⚠️