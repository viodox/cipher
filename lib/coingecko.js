'use strict';

const { createCache } = require('./http-util');

const cache = createCache(200);
const TTL_MS = 60 * 1000;

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

  let status = 502;
  let body = '{"error":"upstream unavailable"}';
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'CipherSignal/1.0 (+https://www.ciphersignal.xyz)',
      },
    });
    status = res.status;
    body = await res.text();
  } catch (err) {
    status = 502;
    body = JSON.stringify({ error: 'CoinGecko request failed' });
  }

  const result = { status, ok: status >= 200 && status < 300, body };
  if (result.ok) cache.set(cacheKey, result, TTL_MS);
  return result;
}

module.exports = { proxyCoinGecko, TTL_MS };
