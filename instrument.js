/**
 * @fileoverview Sentry Error Monitoring - MUST BE LOADED FIRST
 *
 * Initializes Sentry error tracking before any other code runs.
 * Catches all unhandled errors and sends them to Sentry dashboard.
 *
 * @description
 * CRITICAL: This file MUST be required at the very top of run-empire-v2.js
 * BEFORE any other imports. Sentry needs to instrument Node.js before
 * other modules are loaded to properly capture stack traces.
 *
 * WHAT GETS CAPTURED:
 * - Uncaught exceptions
 * - Unhandled promise rejections
 * - Manual Sentry.captureException() calls
 * - Performance traces (10% sampling)
 *
 * ENVIRONMENT TAGGING:
 * Errors are tagged with environment (paper/production) so you can
 * filter in the Sentry dashboard.
 *
 * DASHBOARD:
 * View errors at: https://sentry.io/organizations/ogzprime/
 *
 * @module instrument
 * @requires @sentry/node
 *
 * @example
 * // In run-empire-v2.js (MUST be first line):
 * require('./instrument.js');
 *
 * // Later, to manually capture an error:
 * const Sentry = require('./instrument.js');
 * Sentry.captureException(error);
 */

const Sentry = require("@sentry/node");

// SENTRY_DSN from .env (loaded by ConfigLoader before this file)
// Set SENTRY_ENABLED=false to disable error reporting
const sentryDsn = process.env.SENTRY_DSN || "https://c9c25aed186f9ab079bf338bb4cb9df5@o4509868139085824.ingest.us.sentry.io/4509868141772800";
const sentryEnabled = process.env.SENTRY_ENABLED !== 'false';

if (!sentryEnabled) {
  console.log('🛡️ Sentry disabled via SENTRY_ENABLED=false');
  module.exports = { captureException: () => {}, captureMessage: () => {} };
  return;
}

Sentry.init({
  dsn: sentryDsn,

  // Send default PII (IP addresses, etc) - useful for debugging
  sendDefaultPii: true,

  // Environment tag - helps filter errors by mode
  environment: process.env.NODE_ENV || (process.env.PAPER_TRADING === 'true' ? 'paper' : 'production'),

  // Release version - helps track when bugs were introduced
  release: "ogzprime@2.0.0",

  // Sample rate for performance monitoring (1.0 = 100%)
  tracesSampleRate: 0.1,  // 10% of transactions for performance
});

console.log('🛡️ Sentry error monitoring initialized');

module.exports = Sentry;
