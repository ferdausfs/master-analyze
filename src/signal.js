/**
 * signal.js
 * Final signal builder — SMC + Indicator combined output
 */

import { calcMTFConfluence, buildReasons } from "./mtf.js";
import { calcDynamicExpiry } from "./expiry.js";
import { calcATR } from "./indicators.js";

const SIGNAL_LABELS = { 1: "BUY", 2: "SELL", 3: "HOLD", 4: "WAIT" };

function calcConfidence(confluenceResult, expiryResult) {
  let confidence = confluenceResult.score;
  if (confluenceResult.tfAgreement === 4)      confidence = Math.min(confidence + 10, 98);
  else if (confluenceResult.tfAgreement === 3) confidence = Math.min(confidence + 5,  95);
  else if (confluenceResult.tfAgreement <= 1)  confidence = Math.max(confidence - 10, 20);
  if (expiryResult.session === "OFF_HOURS")    confidence = Math.max(confidence - 8,  20);
  if (expiryResult.atr_level === "HIGH")       confidence = Math.max(confidence - 5,  20);
  if (confluenceResult.signalCode >= 3)        confidence = Math.min(confidence, 60);
  return Math.round(confidence);
}

function getEntryPrice(candles1min) {
  if (!candles1min || !candles1min.length) return null;
  return candles1min[candles1min.length - 1].close;
}

function calcSLTP(candles1min, signal, entryPrice) {
  const atr = calcATR(candles1min, 14);
  if (!atr || !entryPrice) return { sl: null, tp: null };
  const dir = signal === 1 ? 1 : -1;
  return {
    sl: parseFloat((entryPrice - dir * atr * 1.5).toFixed(5)),
    tp: parseFloat((entryPrice + dir * atr * 2.5).toFixed(5)),
  };
}

function buildSignal(symbol, allCandleData) {
  const confluence = calcMTFConfluence(allCandleData);
  const expiryInfo = calcDynamicExpiry(allCandleData);
  const confidence = calcConfidence(confluence, expiryInfo);
  const entryPrice = getEntryPrice(allCandleData["1min"]);
  const { sl, tp } = confluence.signalCode <= 2
    ? calcSLTP(allCandleData["1min"], confluence.signalCode, entryPrice)
    : { sl: null, tp: null };
  const reasons = buildReasons(allCandleData, confluence);

  return {
    signal:         confluence.signalCode,
    label:          SIGNAL_LABELS[confluence.signalCode],
    confidence,
    symbol,
    entry_price:    entryPrice ? parseFloat(entryPrice.toFixed(5)) : null,
    expiry_minutes: expiryInfo.expiry_minutes,
    sl, tp,
    session:        expiryInfo.session,
    atr_level:      expiryInfo.atr_level,
    h1_structure:   confluence.h1Structure,
    tf_agreement:   `${confluence.tfAgreement}/4`,
    buy_score:      confluence.buyScore,
    sell_score:     confluence.sellScore,
    reasons,
    timestamp:      new Date().toISOString(),
    tf_breakdown:   Object.fromEntries(
      Object.entries(confluence.tfResults).map(([tf, r]) => [tf, {
        bias:         r.bias,
        buy:          r.buyScore,
        sell:         r.sellScore,
        smc_bias:     r.smcBias  || "NEUTRAL",
        ind_bias:     r.indBias  || "NEUTRAL",
        adx_filtered: r.adxFiltered || false,
        adx_value:    r.adxValue || null,
      }])
    ),
  };
}

export { buildSignal };
