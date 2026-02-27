/**
 * indicators.js
 * RSI, MACD, EMA, Bollinger Bands, ATR, Stochastic calculate করে
 * Input: candle array [{ open, high, low, close, volume }]
 */

// ─────────────────────────────────────────
// Helper: Close prices array বের করা
// ─────────────────────────────────────────
const closes = (candles) => candles.map((c) => c.close);
const highs = (candles) => candles.map((c) => c.high);
const lows = (candles) => candles.map((c) => c.low);

// ─────────────────────────────────────────
// EMA - Exponential Moving Average
// ─────────────────────────────────────────
function calcEMA(data, period) {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcEMAArray(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(ema);
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// ─────────────────────────────────────────
// SMA - Simple Moving Average
// ─────────────────────────────────────────
function calcSMA(data, period) {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// ─────────────────────────────────────────
// RSI - Relative Strength Index (14)
// ─────────────────────────────────────────
function calcRSI(candles, period = 14) {
  const c = closes(candles);
  if (c.length < period + 1) return null;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = c[i] - c[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < c.length; i++) {
    const diff = c[i] - c[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// RSI signal interpretation
function rsiSignal(rsi) {
  if (rsi === null) return { bias: "NEUTRAL", strength: 0 };
  if (rsi <= 25) return { bias: "BUY", strength: 90 };
  if (rsi <= 35) return { bias: "BUY", strength: 70 };
  if (rsi >= 75) return { bias: "SELL", strength: 90 };
  if (rsi >= 65) return { bias: "SELL", strength: 70 };
  if (rsi < 50) return { bias: "BUY", strength: 40 };
  if (rsi > 50) return { bias: "SELL", strength: 40 };
  return { bias: "NEUTRAL", strength: 0 };
}

// ─────────────────────────────────────────
// MACD - Moving Average Convergence Divergence
// ─────────────────────────────────────────
function calcMACD(candles, fast = 12, slow = 26, signal = 9) {
  const c = closes(candles);
  if (c.length < slow + signal) return null;

  const emaFastArr = calcEMAArray(c, fast);
  const emaSlowArr = calcEMAArray(c, slow);

  // Align arrays (slow শুরু হয় পরে)
  const diff = slow - fast;
  const macdLine = emaSlowArr.map((val, i) => emaFastArr[i + diff] - val);

  const signalLine = calcEMAArray(macdLine, signal);
  const histogram = signalLine.map((val, i) => macdLine[i + (signal - 1)] - val);

  const lastMACD = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  const lastHist = histogram[histogram.length - 1];
  const prevHist = histogram[histogram.length - 2];

  return {
    macd: lastMACD,
    signal: lastSignal,
    histogram: lastHist,
    crossover: prevHist < 0 && lastHist > 0,   // bullish cross
    crossunder: prevHist > 0 && lastHist < 0,  // bearish cross
  };
}

function macdSignal(macd) {
  if (!macd) return { bias: "NEUTRAL", strength: 0 };
  if (macd.crossover) return { bias: "BUY", strength: 85 };
  if (macd.crossunder) return { bias: "SELL", strength: 85 };
  if (macd.macd > macd.signal && macd.histogram > 0) return { bias: "BUY", strength: 60 };
  if (macd.macd < macd.signal && macd.histogram < 0) return { bias: "SELL", strength: 60 };
  return { bias: "NEUTRAL", strength: 20 };
}

// ─────────────────────────────────────────
// EMA Trend - 9 / 21 / 50
// ─────────────────────────────────────────
function calcEMATrend(candles) {
  const c = closes(candles);
  const ema9 = calcEMA(c, 9);
  const ema21 = calcEMA(c, 21);
  const ema50 = calcEMA(c, 50);
  const lastClose = c[c.length - 1];

  return { ema9, ema21, ema50, lastClose };
}

function emaTrendSignal(ema) {
  const { ema9, ema21, ema50, lastClose } = ema;
  if (!ema9 || !ema21) return { bias: "NEUTRAL", strength: 0 };

  // Strong bullish: price > ema9 > ema21 > ema50
  if (ema50 && lastClose > ema9 && ema9 > ema21 && ema21 > ema50)
    return { bias: "BUY", strength: 90 };

  // Strong bearish
  if (ema50 && lastClose < ema9 && ema9 < ema21 && ema21 < ema50)
    return { bias: "SELL", strength: 90 };

  // Moderate bullish
  if (lastClose > ema9 && ema9 > ema21) return { bias: "BUY", strength: 65 };

  // Moderate bearish
  if (lastClose < ema9 && ema9 < ema21) return { bias: "SELL", strength: 65 };

  // Weak
  if (lastClose > ema21) return { bias: "BUY", strength: 40 };
  if (lastClose < ema21) return { bias: "SELL", strength: 40 };

  return { bias: "NEUTRAL", strength: 0 };
}

// ─────────────────────────────────────────
// Bollinger Bands (20, 2)
// ─────────────────────────────────────────
function calcBollingerBands(candles, period = 20, stdDev = 2) {
  const c = closes(candles);
  if (c.length < period) return null;

  const slice = c.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
  const std = Math.sqrt(variance);

  const upper = sma + stdDev * std;
  const lower = sma - stdDev * std;
  const lastClose = c[c.length - 1];
  const width = (upper - lower) / sma; // bandwidth

  return { upper, middle: sma, lower, width, lastClose };
}

function bollingerSignal(bb) {
  if (!bb) return { bias: "NEUTRAL", strength: 0 };
  const { upper, lower, middle, lastClose } = bb;
  const range = upper - lower;
  const positionInBand = (lastClose - lower) / range; // 0 = lower, 1 = upper

  if (positionInBand <= 0.1) return { bias: "BUY", strength: 80 };   // lower band touch
  if (positionInBand >= 0.9) return { bias: "SELL", strength: 80 };  // upper band touch
  if (positionInBand < 0.4) return { bias: "BUY", strength: 45 };
  if (positionInBand > 0.6) return { bias: "SELL", strength: 45 };

  return { bias: "NEUTRAL", strength: 20 };
}

// ─────────────────────────────────────────
// ATR - Average True Range (14)
// ─────────────────────────────────────────
function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return null;

  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  // First ATR = SMA of first `period` TRs
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}

// ─────────────────────────────────────────
// Stochastic Oscillator (14, 3, 3)
// ─────────────────────────────────────────
function calcStochastic(candles, kPeriod = 14, dPeriod = 3, smooth = 3) {
  if (candles.length < kPeriod + dPeriod) return null;

  const rawK = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...slice.map((c) => c.high));
    const lowestLow = Math.min(...slice.map((c) => c.low));
    const close = candles[i].close;
    const k = ((close - lowestLow) / (highestHigh - lowestLow)) * 100;
    rawK.push(isNaN(k) ? 50 : k);
  }

  // Smooth K
  const smoothK = [];
  for (let i = smooth - 1; i < rawK.length; i++) {
    const avg = rawK.slice(i - smooth + 1, i + 1).reduce((a, b) => a + b, 0) / smooth;
    smoothK.push(avg);
  }

  // D = SMA of smoothK
  const d = smoothK.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
  const k = smoothK[smoothK.length - 1];

  return { k, d };
}

function stochasticSignal(stoch) {
  if (!stoch) return { bias: "NEUTRAL", strength: 0 };
  const { k, d } = stoch;

  if (k < 20 && d < 20 && k > d) return { bias: "BUY", strength: 85 };   // oversold + cross
  if (k > 80 && d > 80 && k < d) return { bias: "SELL", strength: 85 };  // overbought + cross
  if (k < 20) return { bias: "BUY", strength: 65 };
  if (k > 80) return { bias: "SELL", strength: 65 };
  if (k > d && k < 50) return { bias: "BUY", strength: 40 };
  if (k < d && k > 50) return { bias: "SELL", strength: 40 };

  return { bias: "NEUTRAL", strength: 20 };
}

// ─────────────────────────────────────────
// Volume Analysis
// ─────────────────────────────────────────
function calcVolumeStrength(candles) {
  const vols = candles.map((c) => c.volume).filter((v) => v > 0);
  if (vols.length < 10) return { aboveAverage: false, ratio: 1 };

  const avgVol = vols.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, vols.length);
  const lastVol = vols[vols.length - 1];
  const ratio = avgVol > 0 ? lastVol / avgVol : 1;

  return { aboveAverage: ratio > 1.2, ratio };
}

// ─────────────────────────────────────────
// Master: সব indicators একসাথে calculate
// ─────────────────────────────────────────
function calculateAllIndicators(candles) {
  const rsi = calcRSI(candles);
  const macd = calcMACD(candles);
  const emaTrend = calcEMATrend(candles);
  const bb = calcBollingerBands(candles);
  const atr = calcATR(candles);
  const stoch = calcStochastic(candles);
  const volume = calcVolumeStrength(candles);

  return {
    raw: { rsi, macd, emaTrend, bb, atr, stoch, volume },
    signals: {
      rsi: rsiSignal(rsi),
      macd: macdSignal(macd),
      ema: emaTrendSignal(emaTrend),
      bollinger: bollingerSignal(bb),
      stochastic: stochasticSignal(stoch),
    },
  };
}

export {
  calculateAllIndicators,
  calcRSI, calcMACD, calcEMATrend, calcBollingerBands, calcATR, calcStochastic,
  calcVolumeStrength, calcEMA, calcSMA,
};
