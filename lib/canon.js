'use strict';

const { proxyCoinGeckoJson } = require('./coingecko');
const { canonFromMarkets } = require('../quality');

let cache = { exp: 0, value: null };

async function loadCanon() {
  const now = Date.now();
  if (cache.value && cache.exp > now) return cache.value;
  const result = await proxyCoinGeckoJson('coins/markets', {
    vs_currency: 'usd',
    order: 'market_cap_desc',
    per_page: '100',
    page: '1',
    sparkline: 'false',
  });
  const rows = result.ok && Array.isArray(result.json) ? result.json : [];
  const value = canonFromMarkets(rows);
  cache = { exp: now + (rows.length ? 6 * 60 * 60 * 1000 : 5 * 60 * 1000), value };
  return value;
}

module.exports = { loadCanon };
