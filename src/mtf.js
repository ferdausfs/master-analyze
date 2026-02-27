/**
 * mtf.js
 * Multi-Timeframe Confluence Engine
 * SMC (50%) + Indicator (50%) combined scoring
 */

import { calculateAllIndicators } from "./indicators.js";
import { analyzeSMC } from "./smc.js";

const TF_WEIGHTS = { "1min": 0.20, "5min": 0.25, "15min": 0.30, "1h": 0.25 };
const INDICATOR_WEIGHTS = { rsi: 0.20, macd: 0.25, ema: 0.25, bollinger: 0.15, stochastic: 0.15 };
const SMC_WEIGHT = 0.50;
const IND_WEIGHT = 0.50;

// ── Indicator Score ───────────────────────────────────
function scoreIndicators(candles) {
  const { signals } = calculateAllIndicators(candles);
  let buyScore = 0, sellScore = 0, totalWeight = 0;
  for (const [indicator, weight] of Object.entries(INDICATOR_WEIGHTS)) {
    const sig = signals[indicator];
    if (!sig) continue;
    totalWeight += weight;
    if (sig.bias === "BUY")  buyScore  += weight * sig.strength;
    if (sig.bias === "SELL") sellScore += weight * sig.strength;
  }
  if (totalWeight > 0) { buyScore = buyScore / totalWeight; sellScore = sellScore / totalWeight; }
  return { buyScore: Math.min(buyScore, 100), sellScore: Math.min(sellScore, 100) };
}

// ── ADX Filter ────────────────────────────────────────
function calcADX(candles, p = 14) {
  if (candles.length < p * 2) return null;
  const trs = [], pdms = [], ndms = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low;
    const ph = candles[i-1].high, pl = candles[i-1].low, pc = candles[i-1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = h - ph, dn = pl - l;
    pdms.push(up > dn && up > 0 ? up : 0);
    ndms.push(dn > up && dn > 0 ? dn : 0);
  }
  const smooth = (arr) => {
    let s = arr.slice(0, p).reduce((a, b) => a + b);
    const out = [s];
    for (let i = p; i < arr.length; i++) { s = s - s / p + arr[i]; out.push(s); }
    return out;
  };
  const str = smooth(trs), spdm = smooth(pdms), sndm = smooth(ndms);
  const dxs = str.map((v, i) => {
    const pdi = v ? (spdm[i] / v) * 100 : 0;
    const ndi = v ? (sndm[i] / v) * 100 : 0;
    const s = pdi + ndi;
    return s ? (Math.abs(pdi - ndi) / s) * 100 : 0;
  });
  let adxVal = dxs.slice(0, p).reduce((a, b) => a + b) / p;
  for (let i = p; i < dxs.length; i++) adxVal = (adxVal * (p - 1) + dxs[i]) / p;
  return adxVal;
}

// ── Single TF Score ───────────────────────────────────
function scoreSingleTimeframe(candles) {
  if (!candles || candles.length < 50)
    return { buyScore: 0, sellScore: 0, bias: "NEUTRAL", smcBias: "NEUTRAL", indBias: "NEUTRAL", adxFiltered: false };

  const smc = analyzeSMC(candles);
  const ind = scoreIndicators(candles);
  const adxVal = calcADX(candles);
  const adxFiltered = adxVal !== null && adxVal < 18;

  const buyScore  = smc.buyScore  * SMC_WEIGHT + ind.buyScore  * IND_WEIGHT;
  const sellScore = smc.sellScore * SMC_WEIGHT + ind.sellScore * IND_WEIGHT;
  const diff = buyScore - sellScore;

  let bias = "NEUTRAL";
  if (!adxFiltered) {
    if (diff > 8)  bias = "BUY";
    if (diff < -8) bias = "SELL";
  }

  return {
    buyScore: Math.round(buyScore), sellScore: Math.round(sellScore),
    bias, smcBias: smc.bias,
    indBias: ind.buyScore > ind.sellScore ? "BUY" : ind.sellScore > ind.buyScore ? "SELL" : "NEUTRAL",
    smcSignals: smc.signals, smcDetails: smc.details,
    adxFiltered, adxValue: adxVal ? Math.round(adxVal) : null,
  };
}

// ── MTF Confluence ────────────────────────────────────
function calcMTFConfluence(allCandleData) {
  const tfResults = {};
  let totalBuy = 0, totalSell = 0;

  for (const [tf, weight] of Object.entries(TF_WEIGHTS)) {
    const result = scoreSingleTimeframe(allCandleData[tf]);
    tfResults[tf] = result;
    totalBuy  += result.buyScore  * weight;
    totalSell += result.sellScore * weight;
  }

  const diff = totalBuy - totalSell;
  const h1Structure = tfResults["1h"]?.smcDetails?.ms?.bias || "NEUTRAL";

  let signalCode = 3, confluenceScore = 0, confluenceBias = "NEUTRAL";

  if (diff >= 10) {
    if (h1Structure === "BEARISH") { signalCode = 4; confluenceBias = "WEAK_BUY";  confluenceScore = totalBuy  * 0.6; }
    else                           { signalCode = 1; confluenceBias = "BUY";       confluenceScore = totalBuy; }
  } else if (diff <= -10) {
    if (h1Structure === "BULLISH") { signalCode = 4; confluenceBias = "WEAK_SELL"; confluenceScore = totalSell * 0.6; }
    else                           { signalCode = 2; confluenceBias = "SELL";      confluenceScore = totalSell; }
  } else if (Math.abs(diff) >= 5) {
    signalCode = 4;
    confluenceBias = diff > 0 ? "WEAK_BUY" : "WEAK_SELL";
    confluenceScore = Math.max(totalBuy, totalSell) * 0.7;
  } else {
    signalCode = 3; confluenceBias = "NEUTRAL"; confluenceScore = 40;
  }

  const buyAgree  = Object.values(tfResults).filter(r => r.bias === "BUY").length;
  const sellAgree = Object.values(tfResults).filter(r => r.bias === "SELL").length;
  const maxAgree  = Math.max(buyAgree, sellAgree);

  if (maxAgree === 4)      confluenceScore = Math.min(confluenceScore * 1.15, 100);
  else if (maxAgree === 3) confluenceScore = Math.min(confluenceScore * 1.08, 100);
  else if (maxAgree <= 1)  confluenceScore = confluenceScore * 0.80;

  return {
    signalCode, bias: confluenceBias,
    score: Math.round(confluenceScore),
    buyScore: Math.round(totalBuy), sellScore: Math.round(totalSell),
    tfAgreement: maxAgree, h1Structure, tfResults,
  };
}

// ── Signal Reasons ────────────────────────────────────
function buildReasons(allCandleData, confluenceResult) {
  const reasons = [];
  const targetBias = confluenceResult.bias.includes("BUY") ? "BUY" : "SELL";

  // SMC reasons from 15min
  const tf15 = confluenceResult.tfResults["15min"];
  if (tf15?.smcSignals?.length) reasons.push(...tf15.smcSignals.slice(0, 3));

  // Indicator reasons from 15min
  const candles15 = allCandleData["15min"];
  if (candles15 && candles15.length >= 30) {
    const { raw, signals } = calculateAllIndicators(candles15);
    if (signals.rsi?.bias === targetBias && raw.rsi !== null) {
      const rv = Math.round(raw.rsi);
      if (rv <= 35)      reasons.push(`RSI oversold (${rv})`);
      else if (rv >= 65) reasons.push(`RSI overbought (${rv})`);
      else               reasons.push(`RSI ${rv} aligns ${targetBias}`);
    }
    if (signals.macd?.bias === targetBias && raw.macd) {
      if (raw.macd.crossover)       reasons.push("MACD bullish crossover");
      else if (raw.macd.crossunder) reasons.push("MACD bearish crossover");
      else reasons.push(`MACD ${targetBias === "BUY" ? "positive" : "negative"} momentum`);
    }
  }

  if (confluenceResult.tfAgreement >= 3) reasons.push(`${confluenceResult.tfAgreement}/4 timeframes aligned`);
  if (confluenceResult.h1Structure !== "NEUTRAL") reasons.push(`1H structure: ${confluenceResult.h1Structure}`);

  return reasons;
}

export { calcMTFConfluence, scoreSingleTimeframe, buildReasons };
