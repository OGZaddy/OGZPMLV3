/**
 * MarketCalendar.js - US Equity Market Session Management
 * ========================================================
 *
 * Handles market hours, holidays, and session awareness for US equities.
 * Critical for the ETF/stocks pivot - prevents trading on closed days
 * and enables extended hours support.
 *
 * SESSIONS:
 * - premarket:  4:00 AM - 9:30 AM ET
 * - regular:    9:30 AM - 4:00 PM ET
 * - afterhours: 4:00 PM - 8:00 PM ET
 * - closed:     Outside all sessions or holiday/weekend
 *
 * HOLIDAYS (NYSE/NASDAQ):
 * - New Year's Day
 * - MLK Day (3rd Monday of January)
 * - Presidents Day (3rd Monday of February)
 * - Good Friday
 * - Memorial Day (last Monday of May)
 * - Juneteenth (June 19)
 * - Independence Day (July 4)
 * - Labor Day (1st Monday of September)
 * - Thanksgiving (4th Thursday of November)
 * - Christmas Day (December 25)
 *
 * HALF DAYS (1:00 PM ET close):
 * - Day before Independence Day (if weekday)
 * - Black Friday (day after Thanksgiving)
 * - Christmas Eve (if weekday)
 *
 * @module foundation/MarketCalendar
 * @author Claude (Opus) for Trey / OGZPrime
 * @date 2026-03-17
 */

'use strict';

class MarketCalendar {
  constructor(options = {}) {
    // Default to US Eastern Time
    this.timezone = options.timezone || 'America/New_York';

    // Session times in ET (minutes from midnight)
    this.sessions = {
      premarket: { start: 4 * 60, end: 9 * 60 + 30 },      // 4:00 AM - 9:30 AM
      regular: { start: 9 * 60 + 30, end: 16 * 60 },       // 9:30 AM - 4:00 PM
      afterhours: { start: 16 * 60, end: 20 * 60 },        // 4:00 PM - 8:00 PM
    };

    // Half day close time (1:00 PM ET)
    this.halfDayClose = 13 * 60;

    // Cache for holiday lookups
    this._holidayCache = new Map();
  }

  /**
   * Get current time in ET
   * @returns {Date} Current time adjusted to ET
   */
  _getETTime(date = new Date()) {
    // Convert to ET using Intl API
    const etString = date.toLocaleString('en-US', { timeZone: this.timezone });
    return new Date(etString);
  }

  /**
   * Get minutes from midnight for a date
   * @param {Date} date
   * @returns {number} Minutes from midnight
   */
  _getMinutesFromMidnight(date) {
    const et = this._getETTime(date);
    return et.getHours() * 60 + et.getMinutes();
  }

  /**
   * Check if a date is a weekend
   * @param {Date} date
   * @returns {boolean}
   */
  isWeekend(date = new Date()) {
    const et = this._getETTime(date);
    const day = et.getDay();
    return day === 0 || day === 6; // Sunday or Saturday
  }

  /**
   * Get all US market holidays for a given year
   * @param {number} year
   * @returns {Array<{date: string, name: string, halfDay: boolean}>}
   */
  getHolidays(year) {
    if (this._holidayCache.has(year)) {
      return this._holidayCache.get(year);
    }

    const holidays = [];

    // New Year's Day (Jan 1, observed on Monday if Sunday, Friday if Saturday)
    holidays.push(this._observedHoliday(year, 0, 1, "New Year's Day"));

    // MLK Day (3rd Monday of January)
    holidays.push({
      date: this._nthWeekdayOfMonth(year, 0, 1, 3),
      name: 'Martin Luther King Jr. Day',
      halfDay: false
    });

    // Presidents Day (3rd Monday of February)
    holidays.push({
      date: this._nthWeekdayOfMonth(year, 1, 1, 3),
      name: "Presidents' Day",
      halfDay: false
    });

    // Good Friday (Friday before Easter)
    const easter = this._getEasterDate(year);
    const goodFriday = new Date(easter);
    goodFriday.setDate(goodFriday.getDate() - 2);
    holidays.push({
      date: this._formatDate(goodFriday),
      name: 'Good Friday',
      halfDay: false
    });

    // Memorial Day (last Monday of May)
    holidays.push({
      date: this._lastWeekdayOfMonth(year, 4, 1),
      name: 'Memorial Day',
      halfDay: false
    });

    // Juneteenth (June 19, observed)
    holidays.push(this._observedHoliday(year, 5, 19, 'Juneteenth'));

    // Independence Day (July 4, observed)
    holidays.push(this._observedHoliday(year, 6, 4, 'Independence Day'));

    // Day before Independence Day (half day if weekday)
    const july4 = new Date(year, 6, 4);
    const dayBefore = new Date(july4);
    dayBefore.setDate(dayBefore.getDate() - 1);
    if (dayBefore.getDay() !== 0 && dayBefore.getDay() !== 6) {
      holidays.push({
        date: this._formatDate(dayBefore),
        name: 'Day Before Independence Day',
        halfDay: true
      });
    }

    // Labor Day (1st Monday of September)
    holidays.push({
      date: this._nthWeekdayOfMonth(year, 8, 1, 1),
      name: 'Labor Day',
      halfDay: false
    });

    // Thanksgiving (4th Thursday of November)
    const thanksgiving = this._nthWeekdayOfMonth(year, 10, 4, 4);
    holidays.push({
      date: thanksgiving,
      name: 'Thanksgiving Day',
      halfDay: false
    });

    // Black Friday (day after Thanksgiving - half day)
    const thanksgivingDate = new Date(thanksgiving);
    const blackFriday = new Date(thanksgivingDate);
    blackFriday.setDate(blackFriday.getDate() + 1);
    holidays.push({
      date: this._formatDate(blackFriday),
      name: 'Black Friday',
      halfDay: true
    });

    // Christmas Day (Dec 25, observed)
    holidays.push(this._observedHoliday(year, 11, 25, 'Christmas Day'));

    // Christmas Eve (half day if weekday)
    const christmas = new Date(year, 11, 25);
    const christmasEve = new Date(christmas);
    christmasEve.setDate(christmasEve.getDate() - 1);
    if (christmasEve.getDay() !== 0 && christmasEve.getDay() !== 6) {
      holidays.push({
        date: this._formatDate(christmasEve),
        name: 'Christmas Eve',
        halfDay: true
      });
    }

    this._holidayCache.set(year, holidays);
    return holidays;
  }

  /**
   * Check if a date is a market holiday
   * @param {Date} date
   * @returns {{isHoliday: boolean, name: string|null, halfDay: boolean}}
   */
  checkHoliday(date = new Date()) {
    const et = this._getETTime(date);
    const year = et.getFullYear();
    const dateStr = this._formatDate(et);

    const holidays = this.getHolidays(year);
    const holiday = holidays.find(h => h.date === dateStr);

    if (holiday) {
      return {
        isHoliday: !holiday.halfDay, // Half days are not full holidays
        name: holiday.name,
        halfDay: holiday.halfDay
      };
    }

    return { isHoliday: false, name: null, halfDay: false };
  }

  /**
   * Get the current market session
   * @param {Date} date
   * @returns {'premarket' | 'regular' | 'afterhours' | 'closed'}
   */
  getSession(date = new Date()) {
    // Check weekend first
    if (this.isWeekend(date)) {
      return 'closed';
    }

    // Check holidays
    const holiday = this.checkHoliday(date);
    if (holiday.isHoliday) {
      return 'closed';
    }

    const minutes = this._getMinutesFromMidnight(date);

    // Half day - market closes at 1:00 PM ET
    if (holiday.halfDay) {
      if (minutes >= this.sessions.premarket.start && minutes < this.sessions.regular.start) {
        return 'premarket';
      }
      if (minutes >= this.sessions.regular.start && minutes < this.halfDayClose) {
        return 'regular';
      }
      return 'closed'; // No after-hours on half days
    }

    // Normal day
    if (minutes >= this.sessions.premarket.start && minutes < this.sessions.regular.start) {
      return 'premarket';
    }
    if (minutes >= this.sessions.regular.start && minutes < this.sessions.afterhours.start) {
      return 'regular';
    }
    if (minutes >= this.sessions.afterhours.start && minutes < this.sessions.afterhours.end) {
      return 'afterhours';
    }

    return 'closed';
  }

  /**
   * Check if the market is open (any session)
   * @param {Date} date
   * @param {string} session - Optional: 'premarket', 'regular', 'afterhours', 'extended' (pre+after), 'any'
   * @returns {boolean}
   */
  isOpen(date = new Date(), session = 'any') {
    const currentSession = this.getSession(date);

    if (currentSession === 'closed') {
      return false;
    }

    if (session === 'any') {
      return true;
    }

    if (session === 'extended') {
      return currentSession === 'premarket' || currentSession === 'afterhours';
    }

    return currentSession === session;
  }

  /**
   * Check if regular trading session is open
   * @param {Date} date
   * @returns {boolean}
   */
  isRegularSessionOpen(date = new Date()) {
    return this.isOpen(date, 'regular');
  }

  /**
   * Get time until next market open
   * @param {Date} date
   * @param {string} session - 'premarket', 'regular', or 'any'
   * @returns {{milliseconds: number, nextOpen: Date, session: string}}
   */
  getTimeUntilOpen(date = new Date(), session = 'regular') {
    let current = new Date(date);
    const maxDays = 10; // Don't loop forever

    for (let i = 0; i < maxDays; i++) {
      // Skip to start of target session on this day
      const et = this._getETTime(current);
      const targetStart = session === 'premarket' || session === 'any'
        ? this.sessions.premarket.start
        : this.sessions.regular.start;

      // Set time to session start
      const checkDate = new Date(et);
      checkDate.setHours(Math.floor(targetStart / 60), targetStart % 60, 0, 0);

      // Check if this time works
      if (checkDate > date && this.isOpen(checkDate, session === 'any' ? 'any' : session)) {
        return {
          milliseconds: checkDate.getTime() - date.getTime(),
          nextOpen: checkDate,
          session: this.getSession(checkDate)
        };
      }

      // Move to next day
      current.setDate(current.getDate() + 1);
      current.setHours(0, 0, 0, 0);
    }

    return { milliseconds: -1, nextOpen: null, session: 'unknown' };
  }

  /**
   * Get session info for display
   * @param {Date} date
   * @returns {Object} Session details
   */
  getSessionInfo(date = new Date()) {
    const session = this.getSession(date);
    const holiday = this.checkHoliday(date);
    const et = this._getETTime(date);

    let closeTime = null;
    let openTime = null;

    if (session !== 'closed') {
      if (holiday.halfDay) {
        closeTime = '1:00 PM ET';
      } else if (session === 'regular') {
        closeTime = '4:00 PM ET';
      } else if (session === 'premarket') {
        openTime = '9:30 AM ET';
        closeTime = '9:30 AM ET (regular opens)';
      } else if (session === 'afterhours') {
        closeTime = '8:00 PM ET';
      }
    }

    return {
      session,
      isOpen: session !== 'closed',
      holiday: holiday.name,
      halfDay: holiday.halfDay,
      currentTimeET: et.toLocaleTimeString('en-US', { timeZone: this.timezone }),
      closeTime,
      nextOpen: session === 'closed' ? this.getTimeUntilOpen(date) : null
    };
  }

  // =========================================================================
  // HELPER METHODS
  // =========================================================================

  _formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  _observedHoliday(year, month, day, name) {
    const date = new Date(year, month, day);
    const dayOfWeek = date.getDay();

    // If Sunday, observe Monday
    if (dayOfWeek === 0) {
      date.setDate(date.getDate() + 1);
    }
    // If Saturday, observe Friday
    else if (dayOfWeek === 6) {
      date.setDate(date.getDate() - 1);
    }

    return {
      date: this._formatDate(date),
      name,
      halfDay: false
    };
  }

  _nthWeekdayOfMonth(year, month, weekday, n) {
    const firstDay = new Date(year, month, 1);
    const firstWeekday = firstDay.getDay();

    let day = 1 + (weekday - firstWeekday + 7) % 7;
    day += (n - 1) * 7;

    return this._formatDate(new Date(year, month, day));
  }

  _lastWeekdayOfMonth(year, month, weekday) {
    const lastDay = new Date(year, month + 1, 0);
    const lastWeekday = lastDay.getDay();

    let diff = lastWeekday - weekday;
    if (diff < 0) diff += 7;

    const day = lastDay.getDate() - diff;
    return this._formatDate(new Date(year, month, day));
  }

  _getEasterDate(year) {
    // Anonymous Gregorian algorithm
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    return new Date(year, month, day);
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new MarketCalendar();
  }
  return instance;
}

module.exports = {
  MarketCalendar,
  getInstance
};
