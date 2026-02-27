/**
 * fetcher.js
 * TwelveData API থেকে OHLCV candle data fetch করে
 * Multiple API key rotation support করে
 */

// ─────────────────────────────────────────
// Timeframe config
// ─────────────────────────────────────────
const TIMEFRAMES = ["1min", "5min", "15min", "1h"];
const CANDLE_LIMIT = 100; // প্রতিটা timeframe এ কতটা candle লাগবে

const TWELVEDATA_BASE = "https://api.twelvedata.com";

// ─────────────────────────────────────────
// API Key Rotation
// ─────────────────────────────────────────

/**
 * Cloudflare Secret থেকে সব key collect করে pool বানায়
 * env তে TWELVEDATA_KEY_1, KEY_2, KEY_3 ... রাখবে
 */
function getKeyPool(env) {
  const keys = [];
  let i = 1;
  while (env[`TWELVEDATA_KEY_${i}`]) {
    keys.push(env[`TWELVEDATA_KEY_${i}`]);
    i++;
  }
  if (keys.length === 0) throw new Error("No TwelveData API keys found in secrets!");
  return keys;
}

/**
 * Round-robin key selector
 * globalThis তে current index track করে
 */
function getNextKey(keyPool) {
  if (!globalThis._keyIndex) globalThis._keyIndex = 0;
  const key = keyPool[globalThis._keyIndex % keyPool.length];
  globalThis._keyIndex++;
  return key;
}

// ─────────────────────────────────────────
// Core Fetch Function
// ─────────────────────────────────────────

/**
 * একটা symbol এর একটা timeframe এর candle data fetch করে
 * Rate limit হলে next key দিয়ে retry করে
 */
async function fetchCandles(symbol, interval, env, retryCount = 0) {
  const keyPool = getKeyPool(env);

  if (retryCount >= keyPool.length) {
    throw new Error(`All API keys exhausted for ${symbol} ${interval}`);
  }

  const apiKey = getNextKey(keyPool);
  const url = `${TWELVEDATA_BASE}/time_series?symbol=${symbol}&interval=${interval}&outputsize=${CANDLE_LIMIT}&apikey=${apiKey}`;

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`Network error fetching ${symbol} ${interval}: ${err.message}`);
  }

  const data = await response.json();

  // Rate limit বা API error হলে next key দিয়ে retry
  if (data.code === 429 || data.status === "error") {
    console.warn(`Key rate limited or error for ${symbol} ${interval}, retrying with next key...`);
    return fetchCandles(symbol, interval, env, retryCount + 1);
  }

  if (!data.values || data.values.length === 0) {
    throw new Error(`No candle data returned for ${symbol} ${interval}`);
  }

  // TwelveData সবচেয়ে নতুন candle আগে দেয়, তাই reverse করি
  const candles = data.values.reverse().map((c) => ({
    time: c.datetime,
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseFloat(c.volume || 0),
  }));

  return candles;
}

// ─────────────────────────────────────────
// Multi-Timeframe Parallel Fetch
// ─────────────────────────────────────────

/**
 * সব timeframe এর data একসাথে (parallel) fetch করে
 * Returns: { "1min": [...], "5min": [...], "15min": [...], "1h": [...] }
 */
async function fetchAllTimeframes(symbol, env) {
  const fetchPromises = TIMEFRAMES.map((tf) =>
    fetchCandles(symbol, tf, env)
      .then((candles) => ({ tf, candles, error: null }))
      .catch((err) => ({ tf, candles: [], error: err.message }))
  );

  const results = await Promise.all(fetchPromises);

  const data = {};
  for (const result of results) {
    if (result.error) {
      console.error(`Failed to fetch ${result.tf}: ${result.error}`);
      data[result.tf] = [];
    } else {
      data[result.tf] = result.candles;
    }
  }

  // যদি 1min বা 15min না আসে তাহলে signal দেওয়া সম্ভব না
  if (data["1min"].length < 20 || data["15min"].length < 20) {
    throw new Error(`Insufficient candle data for ${symbol}. Check symbol or API keys.`);
  }

  return data;
}

// ─────────────────────────────────────────
// Symbol Validation
// ─────────────────────────────────────────

/**
 * Symbol টা valid কিনা TwelveData তে check করে
 */
async function validateSymbol(symbol, type, env) {
  const keyPool = getKeyPool(env);
  const apiKey = keyPool[0]; // validation এ শুধু first key ব্যবহার

  const url = `${TWELVEDATA_BASE}/symbol_search?symbol=${symbol}&apikey=${apiKey}`;
  const response = await fetch(url);
  const data = await response.json();

  if (!data.data || data.data.length === 0) return false;
  return true;
}

// ─────────────────────────────────────────
// Export
// ─────────────────────────────────────────

export { fetchAllTimeframes, fetchCandles, validateSymbol, TIMEFRAMES };
