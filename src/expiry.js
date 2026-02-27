/**
 * expiry.js
 * ATR + Bollinger Width + Market Session দিয়ে
 * Dynamic expiry (minutes) calculate করে
 */

import { calcATR, calcBollingerBands } from "./indicators.js";

// ─────────────────────────────────────────
// Market Sessions (UTC time)
// ─────────────────────────────────────────
const SESSIONS = {
  TOKYO:   { start: 0,  end: 9  },   // 00:00 - 09:00 UTC
  LONDON:  { start: 8,  end: 17 },   // 08:00 - 17:00 UTC
  NEW_YORK:{ start: 13, end: 22 },   // 13:00 - 22:00 UTC
};

function getCurrentSession() {
  const utcHour = new Date().getUTCHours();
  const active = [];

  for (const [name, session] of Object.entries(SESSIONS)) {
    if (utcHour >= session.start && utcHour < session.end) {
      active.push(name);
    }
  }

  // Overlap sessions = highest volatility
  if (active.includes("LONDON") && active.includes("NEW_YORK")) {
    return { session: "LONDON_NY_OVERLAP", volatilityMultiplier: 1.3 };
  }
  if (active.includes("TOKYO") && active.includes("LONDON")) {
    return { session: "TOKYO_LONDON_OVERLAP", volatilityMultiplier: 1.2 };
  }
  if (active.includes("NEW_YORK")) return { session: "NEW_YORK", volatilityMultiplier: 1.1 };
  if (active.includes("LONDON"))   return { session: "LONDON",   volatilityMultiplier: 1.0 };
  if (active.includes("TOKYO"))    return { session: "TOKYO",    volatilityMultiplier: 0.8 };

  return { session: "OFF_HOURS", volatilityMultiplier: 0.6 };
}

// ─────────────────────────────────────────
// ATR Percentile (relative volatility)
// ─────────────────────────────────────────

/**
 * Current ATR কে average ATR এর সাথে তুলনা করে
 * Returns: "HIGH", "MEDIUM", "LOW"
 */
function getATRLevel(candles1min) {
  if (!candles1min || candles1min.length < 20) return "MEDIUM";

  const atr = calcATR(candles1min, 14);
  if (!atr) return "MEDIUM";

  // Last 50 candle এর average price range
  const recent = candles1min.slice(-50);
  const avgRange = recent.reduce((sum, c) => sum + (c.high - c.low), 0) / recent.length;

  // ATR কে avg range এর ratio হিসেবে দেখি
  const ratio = atr / (avgRange || 0.0001);

  if (ratio > 1.4) return "HIGH";
  if (ratio < 0.7) return "LOW";
  return "MEDIUM";
}

// ─────────────────────────────────────────
// Bollinger Width Level
// ─────────────────────────────────────────
function getBBWidthLevel(candles) {
  const bb = calcBollingerBands(candles, 20, 2);
  if (!bb) return "MEDIUM";

  // Width < 0.3% = squeeze (low vol), > 1% = expansion (high vol)
  const widthPct = bb.width * 100;
  if (widthPct > 1.0) return "HIGH";
  if (widthPct < 0.3) return "LOW";
  return "MEDIUM";
}

// ─────────────────────────────────────────
// Dynamic Expiry Calculator
// ─────────────────────────────────────────

/**
 * সব factors মিলিয়ে expiry minutes বের করে
 *
 * Logic:
 * - HIGH volatility → কম expiry (move quickly ends)
 * - LOW volatility  → বেশি expiry (move needs time)
 * - Overlap session → কম expiry
 * - Off hours       → বেশি expiry
 */
function calcDynamicExpiry(allCandleData) {
  const candles1min  = allCandleData["1min"]  || [];
  const candles15min = allCandleData["15min"] || [];

  const atrLevel    = getATRLevel(candles1min);
  const bbLevel     = getBBWidthLevel(candles15min);
  const sessionInfo = getCurrentSession();

  // Base expiry minutes by ATR
  const atrBaseExpiry = {
    HIGH:   2,
    MEDIUM: 4,
    LOW:    6,
  };

  // BB width adjustment
  const bbAdjustment = {
    HIGH:   -1,
    MEDIUM:  0,
    LOW:    +1,
  };

  // Session adjustment
  const sessionAdjustment = {
    LONDON_NY_OVERLAP:    -1,
    TOKYO_LONDON_OVERLAP: -1,
    NEW_YORK:              0,
    LONDON:                0,
    TOKYO:                +1,
    OFF_HOURS:            +2,
  };

  let expiry = atrBaseExpiry[atrLevel];
  expiry += bbAdjustment[bbLevel];
  expiry += sessionAdjustment[sessionInfo.session] || 0;

  // Clamp: minimum 1 minute, maximum 10 minutes
  expiry = Math.max(1, Math.min(10, expiry));

  return {
    expiry_minutes: expiry,
    session: sessionInfo.session,
    atr_level: atrLevel,
    bb_width_level: bbLevel,
    volatility_multiplier: sessionInfo.volatilityMultiplier,
  };
}

export { calcDynamicExpiry, getCurrentSession, getATRLevel };
