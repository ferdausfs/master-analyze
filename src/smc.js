/**
 * smc.js
 * Smart Money Concepts (SMC) Analysis Engine
 * Market Structure, BOS, CHoCH, Order Block, FVG, Liquidity Sweep
 */

// ─────────────────────────────────────────
// Market Structure: HH / HL / LH / LL
// ─────────────────────────────────────────
function marketStructure(candles) {
  if (candles.length < 10) return { bias: "NEUTRAL", pattern: "", swings: [] };

  // Swing High / Low detect (pivot: 2 candle each side)
  const swings = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const isSwingHigh =
      h > candles[i-1].high && h > candles[i-2].high &&
      h > candles[i+1].high && h > candles[i+2].high;
    const isSwingLow =
      l < candles[i-1].low && l < candles[i-2].low &&
      l < candles[i+1].low && l < candles[i+2].low;
    if (isSwingHigh) swings.push({ i, type: "H", price: h });
    if (isSwingLow)  swings.push({ i, type: "L", price: l });
  }

  if (swings.length < 4) return { bias: "NEUTRAL", pattern: "INSUFFICIENT", swings };

  const recent = swings.slice(-6);
  const hs = recent.filter(s => s.type === "H");
  const ls = recent.filter(s => s.type === "L");
  if (hs.length < 2 || ls.length < 2) return { bias: "NEUTRAL", pattern: "", swings };

  const lastH = hs[hs.length - 1].price;
  const prevH = hs[hs.length - 2].price;
  const lastL = ls[ls.length - 1].price;
  const prevL = ls[ls.length - 2].price;

  let bias = "NEUTRAL", pattern = "";
  if (lastH > prevH && lastL > prevL)      { bias = "BULLISH"; pattern = "HH+HL"; }
  else if (lastH < prevH && lastL < prevL) { bias = "BEARISH"; pattern = "LH+LL"; }
  else                                      { pattern = "RANGING"; }

  return { bias, pattern, swings, lastH, prevH, lastL, prevL };
}

// ─────────────────────────────────────────
// BOS (Break of Structure) + CHoCH (Change of Character)
// ─────────────────────────────────────────
function bosChoch(candles, ms) {
  if (!ms.swings || ms.swings.length < 4) return { bos: null, choch: null };

  const hs = ms.swings.filter(s => s.type === "H");
  const ls = ms.swings.filter(s => s.type === "L");
  if (!hs.length || !ls.length) return { bos: null, choch: null };

  const lastClose = candles[candles.length - 1].close;
  const lastSwingH = hs[hs.length - 1].price;
  const lastSwingL = ls[ls.length - 1].price;

  let bos = null, choch = null;

  if (ms.bias === "BULLISH") {
    if (lastClose > lastSwingH) bos   = { direction: "BUY",  level: lastSwingH };
    if (lastClose < lastSwingL) choch = { direction: "SELL", level: lastSwingL };
  } else if (ms.bias === "BEARISH") {
    if (lastClose < lastSwingL) bos   = { direction: "SELL", level: lastSwingL };
    if (lastClose > lastSwingH) choch = { direction: "BUY",  level: lastSwingH };
  } else {
    if (lastClose > lastSwingH) choch = { direction: "BUY",  level: lastSwingH };
    if (lastClose < lastSwingL) choch = { direction: "SELL", level: lastSwingL };
  }

  return { bos, choch };
}

// ─────────────────────────────────────────
// Order Blocks
// ─────────────────────────────────────────
function orderBlocks(candles) {
  if (candles.length < 10) return { bullishOB: null, bearishOB: null, nearestBullOB: null, nearestBearOB: null };

  const obs = [];
  for (let i = 3; i < candles.length - 1; i++) {
    const cur = candles[i], nxt = candles[i + 1];
    const body  = Math.abs(cur.close - cur.open);
    const nBody = Math.abs(nxt.close - nxt.open);

    // Bullish OB: bearish candle → strong bullish candle
    if (cur.close < cur.open && nxt.close > nxt.open && nBody > body * 1.3)
      obs.push({ type: "BULLISH", high: cur.high, low: cur.low, mid: (cur.high + cur.low) / 2, index: i });

    // Bearish OB: bullish candle → strong bearish candle
    if (cur.close > cur.open && nxt.close < nxt.open && nBody > body * 1.3)
      obs.push({ type: "BEARISH", high: cur.high, low: cur.low, mid: (cur.high + cur.low) / 2, index: i });
  }

  const lc     = candles[candles.length - 1].close;
  const recent = obs.slice(-20);

  // Price এখন কোনো OB zone এ আছে?
  const bullishOB    = recent.filter(o => o.type === "BULLISH" && lc >= o.low && lc <= o.high).pop() || null;
  const bearishOB    = recent.filter(o => o.type === "BEARISH" && lc >= o.low && lc <= o.high).pop() || null;

  // Nearest OB (price এর নিচে/উপরে সবচেয়ে কাছেরটা)
  const nearestBullOB = recent.filter(o => o.type === "BULLISH" && o.high < lc).sort((a, b) => b.high - a.high)[0] || null;
  const nearestBearOB = recent.filter(o => o.type === "BEARISH" && o.low  > lc).sort((a, b) => a.low  - b.low )[0] || null;

  return { bullishOB, bearishOB, nearestBullOB, nearestBearOB };
}

// ─────────────────────────────────────────
// Fair Value Gap (FVG / Imbalance)
// ─────────────────────────────────────────
function fairValueGaps(candles) {
  if (candles.length < 5) return { bullishFVG: null, bearishFVG: null };

  const fvgs = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const next = candles[i + 1];

    // Bullish FVG: prev high < next low → gap up (imbalance)
    if (prev.high < next.low)
      fvgs.push({ type: "BULLISH", top: next.low, bottom: prev.high, mid: (next.low + prev.high) / 2, index: i });

    // Bearish FVG: prev low > next high → gap down
    if (prev.low > next.high)
      fvgs.push({ type: "BEARISH", top: prev.low, bottom: next.high, mid: (prev.low + next.high) / 2, index: i });
  }

  const lc     = candles[candles.length - 1].close;
  const recent = fvgs.slice(-30);

  // Price এখন কোনো FVG zone fill করছে?
  const bullishFVG = recent.filter(f => f.type === "BULLISH" && lc >= f.bottom && lc <= f.top).pop() || null;
  const bearishFVG = recent.filter(f => f.type === "BEARISH" && lc >= f.bottom && lc <= f.top).pop() || null;

  return { bullishFVG, bearishFVG };
}

// ─────────────────────────────────────────
// Liquidity Sweep
// ─────────────────────────────────────────
function liquiditySweep(candles) {
  if (candles.length < 20) return { swept: null };

  const lb   = candles.slice(-50);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  // Recent high/low = liquidity pools
  const topLiq = Math.max(...lb.slice(0, -3).map(c => c.high));
  const botLiq = Math.min(...lb.slice(0, -3).map(c => c.low));

  // ATR for threshold
  let atrSum = 0;
  for (let i = 1; i < Math.min(lb.length, 15); i++) {
    atrSum += Math.max(lb[i].high - lb[i].low,
      Math.abs(lb[i].high - lb[i-1].close),
      Math.abs(lb[i].low  - lb[i-1].close));
  }
  const atrVal = atrSum / 14 || 0.001;

  // Bullish sweep: wick নিচে গিয়ে reverse করেছে
  const bullSweep =
    prev.low  < botLiq + atrVal * 0.5 &&
    last.close > prev.low &&
    last.close > (last.open + last.low) / 2;

  // Bearish sweep: wick উপরে গিয়ে reverse করেছে
  const bearSweep =
    prev.high > topLiq - atrVal * 0.5 &&
    last.close < prev.high &&
    last.close < (last.open + last.high) / 2;

  return {
    swept: bullSweep ? "BULLISH" : bearSweep ? "BEARISH" : null,
    topLiq, botLiq,
  };
}

// ─────────────────────────────────────────
// Master SMC Analyzer — সব একসাথে
// ─────────────────────────────────────────
function analyzeSMC(candles) {
  const ms  = marketStructure(candles);
  const bc  = bosChoch(candles, ms);
  const ob  = orderBlocks(candles);
  const fvg = fairValueGaps(candles);
  const liq = liquiditySweep(candles);

  let buyScore = 0, sellScore = 0;
  const signals = [];

  // Market Structure (weight: 25)
  if (ms.bias === "BULLISH") { buyScore  += 25; signals.push(`Bullish structure (${ms.pattern})`); }
  if (ms.bias === "BEARISH") { sellScore += 25; signals.push(`Bearish structure (${ms.pattern})`); }

  // BOS (weight: 20)
  if (bc.bos?.direction === "BUY")  { buyScore  += 20; signals.push("BOS bullish break"); }
  if (bc.bos?.direction === "SELL") { sellScore += 20; signals.push("BOS bearish break"); }

  // CHoCH (weight: 20)
  if (bc.choch?.direction === "BUY")  { buyScore  += 20; signals.push("CHoCH bullish reversal"); }
  if (bc.choch?.direction === "SELL") { sellScore += 20; signals.push("CHoCH bearish reversal"); }

  // Order Block (weight: 20)
  if (ob.bullishOB) { buyScore  += 20; signals.push("In Bullish Order Block"); }
  if (ob.bearishOB) { sellScore += 20; signals.push("In Bearish Order Block"); }
  if (!ob.bullishOB && ob.nearestBullOB) buyScore  += 8;
  if (!ob.bearishOB && ob.nearestBearOB) sellScore += 8;

  // FVG (weight: 15)
  if (fvg.bullishFVG) { buyScore  += 15; signals.push("Filling Bullish FVG"); }
  if (fvg.bearishFVG) { sellScore += 15; signals.push("Filling Bearish FVG"); }

  // Liquidity Sweep (weight: 20)
  if (liq.swept === "BULLISH") { buyScore  += 20; signals.push("Bullish liquidity sweep"); }
  if (liq.swept === "BEARISH") { sellScore += 20; signals.push("Bearish liquidity sweep"); }

  // Normalize 0-100
  const max = 120;
  buyScore  = Math.min((buyScore  / max) * 100, 100);
  sellScore = Math.min((sellScore / max) * 100, 100);

  const diff = buyScore - sellScore;
  const bias = diff > 10 ? "BUY" : diff < -10 ? "SELL" : "NEUTRAL";

  return {
    bias,
    buyScore:  Math.round(buyScore),
    sellScore: Math.round(sellScore),
    signals,
    details: { ms, bos: bc.bos, choch: bc.choch, ob, fvg, liq },
  };
}

export { analyzeSMC, marketStructure, bosChoch, orderBlocks, fairValueGaps, liquiditySweep };
