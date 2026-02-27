/**
 * index.js
 * Cloudflare Worker — Main Entry Point
 * Routes: /signal  /batch  /health  /symbols
 */

import { fetchAllTimeframes } from "./fetcher.js";
import { buildSignal } from "./signal.js";

// ── CORS & Response Helpers ───────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const ok  = (d)        => new Response(JSON.stringify(d, null, 2), { headers: CORS });
const err = (m, c=400) => new Response(JSON.stringify({ success: false, error: m }), { status: c, headers: CORS });

// ── Popular Symbols ───────────────────────────────────
const SYMBOLS = {
  forex:  ["EUR/USD","GBP/USD","USD/JPY","AUD/USD","USD/CAD","NZD/USD","EUR/GBP","GBP/JPY"],
  crypto: ["BTC/USD","ETH/USD","BNB/USD","SOL/USD","XRP/USD"],
  stocks: ["AAPL","MSFT","GOOGL","TSLA","NVDA","META"],
};

// ── /signal ───────────────────────────────────────────
async function handleSignal(request, env) {
  const url    = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase().replace("-", "/");
  if (!symbol) return err("Missing ?symbol= param. Example: /signal?symbol=EUR/USD");

  try {
    const data   = await fetchAllTimeframes(symbol, env);
    const signal = buildSignal(symbol, data);
    return ok({ success: true, data: signal });
  } catch (e) {
    return err(e.message, 500);
  }
}

// ── /batch ────────────────────────────────────────────
async function handleBatch(request, env) {
  const url  = new URL(request.url);
  const syms = (url.searchParams.get("symbols") || "")
    .split(",").slice(0, 5).map(s => s.trim().toUpperCase().replace("-", "/"));
  if (!syms.length) return err("Missing ?symbols= param. Example: /batch?symbols=EUR/USD,BTC/USD");

  const results = await Promise.allSettled(
    syms.map(async s => {
      const data = await fetchAllTimeframes(s, env);
      return { symbol: s, signal: buildSignal(s, data) };
    })
  );

  return ok({
    success: true,
    data: results.map((r, i) =>
      r.status === "fulfilled"
        ? { success: true, ...r.value }
        : { success: false, symbol: syms[i], error: r.reason?.message }
    ),
  });
}

// ── /health ───────────────────────────────────────────
async function handleHealth(env) {
  let keyCount = 0;
  while (env[`TWELVEDATA_API_KEY_${keyCount + 1}`]) keyCount++;
  return ok({
    success: true,
    status:  "healthy",
    version: "2.0-smc",
    keys:    keyCount,
    engine:  "SMC + Indicator",
    ts:      new Date().toISOString(),
  });
}

// ── /symbols ──────────────────────────────────────────
function handleSymbols() {
  return ok({
    success: true,
    symbols: SYMBOLS,
    usage:   "GET /signal?symbol=EUR/USD",
  });
}

// ── Main Worker ───────────────────────────────────────
export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET")     return err("Only GET allowed", 405);

    if (path === "/signal")  return handleSignal(request, env);
    if (path === "/batch")   return handleBatch(request, env);
    if (path === "/health")  return handleHealth(env);
    if (path === "/symbols") return handleSymbols();

    // Default info
    return ok({
      name:      "SMC + Indicator Signal Engine",
      version:   "2.0-smc",
      endpoints: {
        "/signal":  "GET /signal?symbol=EUR/USD",
        "/batch":   "GET /batch?symbols=EUR/USD,BTC/USD",
        "/symbols": "GET /symbols",
        "/health":  "GET /health",
      },
    });
  },
};
