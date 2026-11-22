'use strict';

const crypto = require('crypto');
const store = require('./store');
const { cacheOnly } = require('./traffic');
const { secondaryFallback } = require('./cg-fallback');

const memory = new Map();
const inflight = new Map();
const MAX_MEMORY = 400;
const TTL_MS = 60 * 60 * 1000;
const STALE_MS = 14 * 24 * 60 * 60 * 1000;
const STALE_SEC = 14 * 24 * 60 * 60;
const ERROR_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_KV_BODY = 800000;
const FAILED_HOLD_MS = 60 * 1000;
const MONTHLY_PAUSE_MS = 12 * 60 * 60 * 1000;
const BURST_WINDOW_MS = 30 * 1000;
const BURST_TRIPS = 8;
const BURST_PAUSE_MS = 2 * 60 * 1000;

let pauseUntil = 0;
let recent429 = [];

function ttlFor(path, params) {
  const query = params || {};
  if (path === 'coins/markets' && query.order === 'market_cap_desc' && String(query.per_page) === '100') {
    return 6 * 60 * 60 * 1000;
  }
  // Extra meme pages are walked slowly by the listed-tail cache. If a client
  // still asks for page 2+, hold the proxy response for 10 hours.
  if (path === 'coins/markets' && query.category === 'meme-token' && Number(query.page) > 1) {
    return 10 * 60 * 60 * 1000;
  }
  if (path === 'coins/markets' || path === 'search/trending') return 60 * 60 * 1000;
  // Price alerts can poll more often than once an hour. Keep this shorter
  // than the page caches so a daily (or 15-minute) check still sees a new price.
  if (path === 'simple/price') return 10 * 60 * 1000;
  if (/^coins\/[^/]+\/market_chart$/.test(path)) return 3 * 60 * 60 * 1000;
  if (/^coins\/[^/]+\/contract\//.test(path)) return 6 * 60 * 60 * 1000;
  if (path === 'search') return 6 * 60 * 60 * 1000;
  if (path.indexOf('coins/') === 0) return 6 * 60 * 60 * 1000;
  return TTL_MS;
}

function cacheControlForTtl(ttlMs) {
  const seconds = Math.max(1, Math.round(ttlMs / 1000));
  const browser = Math.min(seconds, 300);
  const swr = Math.min(600, seconds);
  return 'public, max-age=' + browser + ', s-maxage=' + seconds + ', stale-while-revalidate=' + swr;
}

function cleanPath(path) {
  const value = String(path || '').replace(/^\/+/, '');
  if (!value || value.length > 240) return null;
  if (!/^[a-zA-Z0-9_\-/]+$/.test(value)) return null;
  if (value.includes('..')) return null;
  return value;
}

function hashKey(cacheKey) {
  return 'cg:v1:' + crypto.createHash('sha256').update(cacheKey).digest('hex').slice(0, 40);
}

function buildUpstream(path, params, opts) {
  const url = new URL('https://api.coingecko.com/api/v3/' + path);
  const query = params || {};
  Object.keys(query).sort().forEach((key) => {
    if (key === 'path' || key === 'x_cg_demo_api_key' || key === 'x_cg_pro_api_key') return;
    const value = query[key];
    if (value == null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  // The cache identity ignores the demo key so a public fallback fills the same slot.
  const cacheKey = url.pathname + '?' + url.searchParams.toString();
  const apiKey = process.env.COINGECKO_API_KEY;
  const omitKey = (opts && opts.omitKey) || !useKey();
  if (!omitKey && apiKey) url.searchParams.set('x_cg_demo_api_key', apiKey);
  return { url, cacheKey, kvKey: hashKey(cacheKey) };
}

function okResult(body, ttlMs, stale) {
  return {
    status: 200,
    ok: true,
    body,
    cacheControl: cacheControlForTtl(ttlMs),
    stale: !!stale,
  };
}

function errorResult(status, message) {
  return {
    status,
    ok: false,
    body: JSON.stringify({ error: message }),
    cacheControl: 'no-store',
    stale: false,
  };
}

function remember(cacheKey, result, freshForMs, staleUntilAbs) {
  const now = Date.now();
  memory.delete(cacheKey);
  memory.set(cacheKey, {
    result,
    freshUntil: now + Math.max(0, freshForMs),
    staleUntil: staleUntilAbs,
  });
  while (memory.size > MAX_MEMORY) {
    const oldest = memory.keys().next().value;
    memory.delete(oldest);
  }
}

function readMemory(cacheKey) {
  const hit = memory.get(cacheKey);
  if (!hit) return null;
  const now = Date.now();
  if (now > hit.freshUntil && now > hit.staleUntil) {
    memory.delete(cacheKey);
    return null;
  }
  return hit;
}

function useKey() {
  const flag = String(process.env.COINGECKO_KEY_DISABLED || '').trim().toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on') return false;
  return Boolean(process.env.COINGECKO_API_KEY);
}

function quotaStatus(status) {
  return status === 401 || status === 403 || status === 429;
}

function monthlyCap(status, body) {
  if (status !== 401 && status !== 429 && status !== 403) return false;
  if (status === 401) return true;
  return /usage exceeded|credit limit|monthly|api key limit|exceeds the allowed|exceeded the allowed|expired/i.test(String(body || ''));
}

function noteUpstream(status, body) {
  const now = Date.now();
  if (monthlyCap(status, body)) {
    pauseUntil = Math.max(pauseUntil, now + MONTHLY_PAUSE_MS);
    return;
  }
  if (status !== 429) return;
  recent429.push(now);
  recent429 = recent429.filter((stamp) => now - stamp < BURST_WINDOW_MS);
  if (recent429.length >= BURST_TRIPS) {
    pauseUntil = Math.max(pauseUntil, now + BURST_PAUSE_MS);
  }
}

async function readKv(kvKey) {
  let saved = null;
  try { saved = await store.cacheGet(kvKey); }
  catch (err) { return null; }
  if (!saved || typeof saved.body !== 'string') return null;
  const at = Number(saved.at);
  if (!Number.isFinite(at)) return null;
  if (Date.now() - at > STALE_MS) return null;
  return { body: saved.body, at };
}

async function writeKv(kvKey, body) {
  if (!body || body.length > MAX_KV_BODY) return;
  try { await store.cacheSet(kvKey, { body, at: Date.now() }, STALE_SEC); }
  catch (err) { /* the caller still has the fresh body */ }
}

async function tryLock(kvKey) {
  const id = kvKey.startsWith('cg:v1:') ? kvKey.slice(6) : kvKey;
  let res = null;
  try { res = await store.redisCmd(['SET', 'cg:lock:' + id, '1', 'NX', 'EX', '20']); }
  catch (err) { return true; }
  if (!res || !res.ok) return true;
  return res.result === 'OK';
}

async function fetchUpstream(url, ttlMs) {
  let status = 502;
  let body = '{"error":"upstream unavailable"}';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'CipherSignal/1.0 (+https://www.ciphersignal.xyz)',
      },
    });
    status = res.status;
    body = await res.text();
  } catch (err) {
    status = err && err.name === 'AbortError' ? 504 : 502;
    body = JSON.stringify({ error: status === 504 ? 'CoinGecko timed out' : 'CoinGecko request failed' });
  } finally {
    clearTimeout(timer);
  }
  return {
    status,
    ok: status >= 200 && status < 300,
    body,
    cacheControl: cacheControlForTtl(ttlMs),
    stale: false,
  };
}

function staleFrom(saved, local, ttlMs) {
  if (saved) return { result: okResult(saved.body, ttlMs, true), staleUntil: saved.at + STALE_MS };
  if (local && local.result && local.result.ok && local.result.body) {
    return {
      result: Object.assign({}, local.result, { stale: true, status: 200, ok: true }),
      staleUntil: local.staleUntil,
    };
  }
  return null;
}

function storeFresh(cacheKey, kvKey, result, ttlMs) {
  remember(cacheKey, result, ttlMs, Date.now() + STALE_MS);
  return writeKv(kvKey, result.body).then(() => result);
}

async function fetchFallback(path, params, ttlMs) {
  const keyless = await fetchUpstream(buildUpstream(path, params, { omitKey: true }).url, ttlMs);
  if (keyless.ok) return Object.assign({}, keyless, { fallback: true });
  if (keyless.status === 404) return keyless;
  let shaped = null;
  try { shaped = await secondaryFallback(path, params); }
  catch (err) { shaped = null; }
  if (!shaped) return keyless;
  const result = okResult(JSON.stringify(shaped), ttlMs, false);
  result.fallback = true;
  return result;
}

async function loadShared(path, params) {
  const built = buildUpstream(path, params, { omitKey: true });
  const now = Date.now();
  const ttlMs = ttlFor(path, params);
  const local = readMemory(built.cacheKey);
  if (local && local.freshUntil > now) return local.result;

  const saved = await readKv(built.kvKey);
  if (saved && now - saved.at < ttlMs) {
    const result = okResult(saved.body, ttlMs, false);
    remember(built.cacheKey, result, ttlMs - (now - saved.at), saved.at + STALE_MS);
    return result;
  }

  const stale = staleFrom(saved, local, ttlMs);
  if (cacheOnly()) {
    if (stale) return stale.result;
    return errorResult(429, 'CoinGecko rate limit');
  }

  const skipKey = !useKey() || Date.now() < pauseUntil;
  if (!skipKey && stale && !(await tryLock(built.kvKey))) {
    remember(built.cacheKey, stale.result, ERROR_COOLDOWN_MS, stale.staleUntil);
    return stale.result;
  }

  let fresh = null;
  if (!skipKey) {
    fresh = await fetchUpstream(buildUpstream(path, params).url, ttlMs);
    noteUpstream(fresh.status, fresh.body);
    if (fresh.ok) return storeFresh(built.cacheKey, built.kvKey, fresh, ttlMs);
    if (fresh.status === 404) return fresh;
    if (quotaStatus(fresh.status) && stale) {
      remember(built.cacheKey, stale.result, ERROR_COOLDOWN_MS, stale.staleUntil);
      return stale.result;
    }
    if (!quotaStatus(fresh.status)) {
      if (stale) {
        remember(built.cacheKey, stale.result, ERROR_COOLDOWN_MS, stale.staleUntil);
        return stale.result;
      }
      return fresh;
    }
  }

  const fallback = await fetchFallback(path, params, ttlMs);
  if (fallback.ok) return storeFresh(built.cacheKey, built.kvKey, fallback, ttlMs);
  if (fallback.status === 404) return fallback;
  if (stale) {
    remember(built.cacheKey, stale.result, ERROR_COOLDOWN_MS, stale.staleUntil);
    return stale.result;
  }
  const failure = fresh && !fresh.ok ? fresh : fallback;
  remember(built.cacheKey, failure, FAILED_HOLD_MS, Date.now() + FAILED_HOLD_MS);
  return failure;
}

async function proxyCoinGecko(pathInput, params) {
  const path = cleanPath(pathInput);
  if (!path) {
    return { status: 400, ok: false, body: JSON.stringify({ error: 'invalid path' }), cache: false };
  }
  const built = buildUpstream(path, params);
  if (inflight.has(built.cacheKey)) return inflight.get(built.cacheKey);
  const job = loadShared(path, params);
  inflight.set(built.cacheKey, job);
  try { return await job; }
  finally { inflight.delete(built.cacheKey); }
}

async function proxyCoinGeckoJson(pathInput, params) {
  const result = await proxyCoinGecko(pathInput, params);
  let json = null;
  try { json = JSON.parse(result.body); } catch (err) { json = null; }
  return {
    status: result.status,
    ok: result.ok,
    body: result.body,
    json,
    stale: !!result.stale,
    fallback: !!result.fallback,
  };
}

function withJson(result) {
  let json = null;
  try { json = JSON.parse(result.body); } catch (err) { json = null; }
  return {
    status: result.status,
    ok: result.ok,
    body: result.body,
    json,
    stale: !!result.stale,
  };
}

async function peekCoinGeckoJson(pathInput, params) {
  const path = cleanPath(pathInput);
  if (!path) return null;
  const built = buildUpstream(path, params);
  const ttlMs = ttlFor(path, params);
  const local = readMemory(built.cacheKey);
  if (local && local.result && local.result.ok && local.result.body) {
    const stale = !(local.freshUntil > Date.now()) || !!local.result.stale;
    return withJson(Object.assign({}, local.result, { stale }));
  }
  const saved = await readKv(built.kvKey);
  if (!saved) return null;
  return withJson(okResult(saved.body, ttlMs, Date.now() - saved.at >= ttlMs));
}

function clearProxyCache() {
  memory.clear();
  inflight.clear();
  pauseUntil = 0;
  recent429 = [];
}

module.exports = {
  proxyCoinGecko,
  proxyCoinGeckoJson,
  peekCoinGeckoJson,
  TTL_MS,
  ttlFor,
  cacheControlForTtl,
  clearProxyCache,
};
