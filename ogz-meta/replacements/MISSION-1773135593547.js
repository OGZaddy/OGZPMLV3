  /**
   * Feed a 15-minute candle directly.
   * FIX 2026-03-10: Removed internal 1m→15m aggregation. Production sends 15m candles.
   *
   * @param {Object} candle — { c, o, h, l, v, t } (V2 Kraken 15m)
   * @returns {Object} signal
   */
  feedCandle(candle) {
    if (!candle || c(candle) == null) return this._emptySignal();

    const ts = candle.t;  // milliseconds
    const date = new Date(ts);
    const dayStr = date.toISOString().split('T')[0];
    const utcHour = date.getUTCHours();
    const utcMinute = date.getUTCMinutes();

    // ── Day rollover: finalize yesterday's daily candle ──
    if (this._currentDay && this._currentDay !== dayStr) {
      this._finalizeDailyCandle();
      this._newSession(dayStr);
    }
    this._currentDay = dayStr;

    // ── Build running daily candle (works with any timeframe) ──
    this._updateDailyCandle(candle);

    // ── Detect session open (check if this 15m candle IS the session open) ──
    // For 15m candles, session open candle contains the open minute
    const isSessionOpenCandle = (utcHour === this.config.sessionOpenHour &&
                                  utcMinute <= this.config.sessionOpenMinute &&
                                  utcMinute + 15 > this.config.sessionOpenMinute);

    if (isSessionOpenCandle && this.state.phase === 'waiting_for_open') {
      // This 15m candle IS the opening candle - process immediately
      this.state.phase = 'building_box';
      this._openingCandleFed = false;
    }

    // ── Opening candle: process immediately (no aggregation needed) ──
    if (this.state.phase === 'building_box' && !this._openingCandleFed) {
      this._processOpeningCandle(candle);  // Direct 15m candle
      this._openingCandleFed = true;
      return this.getSignal();
    }

    // ── Box exit + pattern detection: each 15m candle directly ──
    // FIX 2026-03-10: No 5m aggregation - process each 15m candle directly
    if (this.state.phase === 'watching_for_exit' || this.state.phase === 'watching_for_pattern') {
      this._process5mCandle(candle);  // Method name kept for compatibility, now processes 15m directly
    }

    // DEEP DIAGNOSTIC: Trace LiquiditySweep internals
    if (process.env.BACKTEST_VERBOSE) {
      const candleTs = candle?.t ? new Date(candle.t).toISOString() : 'unknown';
      if ((this.stats?.totalSessionsAnalyzed || 0) % 10 === 0 || this.state.phase !== 'waiting_for_open') {
        console.log(`[LIQSWEEP-15M] candle=${candleTs} phase=${this.state.phase} dailyATR=${this.state.dailyATR?.toFixed(2)||'null'}`);
      }
    }

    return this.getSignal();
  }
