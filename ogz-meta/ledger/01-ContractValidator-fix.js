// ============================================================================
// CORRECTION 1: ContractValidator.js — validateIndicators()
// 
// CHANGE: Make trend and bb validation MANDATORY, not optional.
// The plan says IndicatorSnapshot always produces these fields.
// If they're missing, that IS the bug we want to catch.
//
// FIND this block in core/ContractValidator.js validateIndicators():
// ============================================================================

// --- REPLACE THIS (around lines 72-80) ---

    // === BOLLINGER BANDS ===
    if (indicators.bb) {
      valid = this.assertPositive('bb.upper', indicators.bb.upper) && valid;
      valid = this.assertPositive('bb.middle', indicators.bb.middle) && valid;
      valid = this.assertPositive('bb.lower', indicators.bb.lower) && valid;
      valid = this.assertRange('bb.percentB', indicators.bb.percentB, 0, 1) && valid;
      valid = this.assertRange('bb.bandwidth', indicators.bb.bandwidth, 0, 100) && valid;
    }

    // === DERIVED ===
    valid = this.assertRange('volatilityNormalized', indicators.volatilityNormalized, 0, 1) && valid;

    // === TREND ===
    if (indicators.trend !== undefined) {
      valid = this.assertEnum('trend', indicators.trend, ['uptrend', 'downtrend', 'neutral']) && valid;
    }

// --- WITH THIS ---

    // === BOLLINGER BANDS (REQUIRED — IndicatorSnapshot always produces these) ===
    valid = this.assertDefined('bb', indicators.bb) && valid;
    if (indicators.bb) {
      valid = this.assertPositive('bb.upper', indicators.bb.upper) && valid;
      valid = this.assertPositive('bb.middle', indicators.bb.middle) && valid;
      valid = this.assertPositive('bb.lower', indicators.bb.lower) && valid;
      valid = this.assertRange('bb.percentB', indicators.bb.percentB, 0, 1) && valid;
      valid = this.assertRange('bb.bandwidth', indicators.bb.bandwidth, 0, 100) && valid;
    }

    // === DERIVED ===
    valid = this.assertRange('volatilityNormalized', indicators.volatilityNormalized, 0, 1) && valid;

    // === TREND (REQUIRED — IndicatorSnapshot is THE single source of trend) ===
    valid = this.assertEnum('trend', indicators.trend, ['uptrend', 'downtrend', 'neutral']) && valid;
