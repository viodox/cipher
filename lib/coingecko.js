'use strict';

const { createCache } = require('./http-util');

const cache = createCache(400);
const inflight = new Map();
const TTL_MS = 60 * 1000;

function ttlFor(path, params) {
  const query = params || {};
  if (path === 'coins/markets' && query.order === 'market_cap_desc' && String(query.per_page) === '100') {
    return 6 * 60 * 60 * 1000;
  }
  if (path === 'coins/markets' || path === 'search/trending') return 60 * 60 * 1000;
  if (path === 'simple/price') return 10 * 60 * 1000;
  if (/^coins\/[^/]+\/market_chart$/.test(path)) return 60 * 60 * 1000;
  if (path.indexOf('coins/') === 0) return 30 * 60 * 1000;
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

async function proxyCoinGecko(pathInput, params) {
  const path = cleanPath(pathInput);
  if (!path) {
    return { status: 400, ok: false, body: JSON.stringify({ error: 'invalid path' }), cache: false };
  }

  const url = new URL('https://api.coingecko.com/api/v3/' + path);
  const query = params || {};
  Object.keys(query).sort().forEach((key) => {
    if (key === 'path' || key === 'x_cg_demo_api_key' || key === 'x_cg_pro_api_key') return;
    const value = query[key];
    if (value == null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  const apiKey = process.env.COINGECKO_API_KEY;
  if (apiKey) url.searchParams.set('x_cg_demo_api_key', apiKey);

  const cacheKey = url.pathname + '?' + url.searchParams.toString().replace(apiKey || '__none__', 'key');
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const job = fetchUpstream(url, path, query, cacheKey);
  inflight.set(cacheKey, job);
  try { return await job; }
  finally { inflight.delete(cacheKey); }
}

async function fetchUpstream(url, path, query, cacheKey) {
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

  const ttlMs = ttlFor(path, query);
  const result = {
    status,
    ok: status >= 200 && status < 300,
    body,
    cacheControl: cacheControlForTtl(ttlMs),
  };
  if (result.ok) cache.set(cacheKey, result, ttlMs);
  return result;
}

async function proxyCoinGeckoJson(pathInput, params) {
  const result = await proxyCoinGecko(pathInput, params);
  let json = null;
  try { json = JSON.parse(result.body); } catch (err) { json = null; }
  return { status: result.status, ok: result.ok, body: result.body, json };
}

function clearProxyCache() {
  cache.clear();
  inflight.clear();
}

module.exports = { proxyCoinGecko, proxyCoinGeckoJson, TTL_MS, ttlFor, cacheControlForTtl, clearProxyCache };
