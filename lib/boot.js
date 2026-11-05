'use strict';

const fs = require('fs');
const path = require('path');
const { proxyCoinGeckoJson } = require('./coingecko');
const { peekBoard, boardRowsHtml } = require('./board');
const { cacheGet, cacheSet } = require('./store');
const { sellHtml, clientPayload } = require('./sponsor');
const { loadDexUniverse, loadDexCachedOnly } = require('./dex');

const HOME = path.join(__dirname, '..', 'templates', 'home.html');
const CACHE_KEY = 'cipher:boot:v1';
const memory = { exp: 0, value: null };

function resetBootMemory() {
  memory.exp = 0;
  memory.value = null;
}

function slimCoin(coin) {
  if (!coin || !coin.id) return null;
  const volume = Number(coin.total_volume);
  if (!Number.isFinite(volume) || volume <= 500) return null;
  return {
    id: String(coin.id),
    symbol: coin.symbol || '',
    name: coin.name || '',
    image: coin.image || '',
    current_price: Number.isFinite(Number(coin.current_price)) ? Number(coin.current_price) : null,
    market_cap: Number.isFinite(Number(coin.market_cap)) ? Number(coin.market_cap) : 0,
    total_volume: volume,
    price_change_percentage_24h: Number.isFinite(Number(coin.price_change_percentage_24h)) ? Number(coin.price_change_percentage_24h) : null,
    price_change_percentage_7d_in_currency: Number.isFinite(Number(coin.price_change_percentage_7d_in_currency)) ? Number(coin.price_change_percentage_7d_in_currency) : null,
    market_cap_rank: coin.market_cap_rank || null,
  };
}

function readHome() {
  return fs.readFileSync(HOME, 'utf8');
}

function renderHomeHtml(boot, opts) {
  let html = readHome();
  const sponsorPayload = clientPayload(opts && opts.now, opts);
  const sponsorJson = JSON.stringify(sponsorPayload).replace(/</g, '\\u003c');
  html = html.replace('</head>', '<script>window.__CIPHER_SPONSOR__=' + sponsorJson + ';</script></head>');
  html = html.replace('<!-- SPONSOR_SELL -->', sellHtml(opts && opts.now));
  const coins = boot && Array.isArray(boot.coins) ? boot.coins : [];
  const dex = boot && Array.isArray(boot.dex) ? boot.dex : [];
  if (!coins.length && !dex.length) return html;
  const board = Array.isArray(boot.board) ? boot.board : [];
  const payload = {
    ok: true,
    updatedAt: boot.updatedAt || new Date().toISOString(),
    source: boot.source || 'coingecko',
    coins,
    dex,
    dexUpdatedAt: boot.dexUpdatedAt || null,
    dexCounts: boot.dexCounts || null,
    board,
  };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  html = html.replace('</head>', '<script>window.__CIPHER_BOOT__=' + json + ';</script></head>');
  const when = String(payload.updatedAt).replace('T', ' ').slice(0, 19);
  html = html.replace(
    'market data: waiting for CoinGecko…',
    'market data: cached snapshot ' + when + ' UTC · refreshing'
  );
  if (board.length) html = html.replace('<!-- graded-board -->', boardRowsHtml(board));
  return html;
}

async function fetchBoot() {
  const hit = await proxyCoinGeckoJson('coins/markets', {
    vs_currency: 'usd',
    category: 'meme-token',
    order: 'volume_desc',
    per_page: '250',
    page: '1',
    sparkline: 'false',
    price_change_percentage: '24h,7d',
  });
  if (!hit.ok || !Array.isArray(hit.json)) return null;
  const coins = hit.json.map(slimCoin).filter(Boolean);
  if (!coins.length) return null;
  const board = peekBoard();
  return {
    ok: true,
    at: Date.now(),
    updatedAt: new Date().toISOString(),
    source: 'coingecko',
    coins,
    board: board && Array.isArray(board.rows) ? board.rows : [],
  };
}

async function withDex(boot, opts) {
  const base = boot && typeof boot === 'object' ? boot : { ok: false, coins: [], board: [], updatedAt: null };
  let dex = null;
  try {
    dex = opts && opts.refreshDex ? await loadDexUniverse() : await loadDexCachedOnly();
  } catch (err) {
    dex = null;
  }
  const rows = dex && Array.isArray(dex.rows) ? dex.rows : [];
  return Object.assign({}, base, {
    dex: rows,
    dexUpdatedAt: dex && dex.updatedAt || null,
    dexCounts: dex && dex.counts || null,
  });
}

async function loadBoot(opts) {
  const now = Date.now();
  let boot = null;
  if (memory.value && memory.exp > now) boot = memory.value;
  else {
    const saved = await cacheGet(CACHE_KEY);
    if (saved && Array.isArray(saved.coins) && saved.coins.length && now - Number(saved.at || 0) < 10 * 60 * 1000) {
      memory.exp = now + 60 * 1000;
      memory.value = saved;
      boot = saved;
    } else {
      try {
        const fresh = await fetchBoot();
        if (fresh) {
          if (!fresh.board.length && saved && Array.isArray(saved.board)) fresh.board = saved.board;
          memory.exp = now + 10 * 60 * 1000;
          memory.value = fresh;
          await cacheSet(CACHE_KEY, fresh, 6 * 60 * 60);
          boot = fresh;
        }
      } catch (err) { /* fall through to stale */ }
      if (!boot && saved && Array.isArray(saved.coins) && saved.coins.length) boot = saved;
    }
  }
  if (!boot) boot = { ok: false, coins: [], board: [], updatedAt: null };
  return withDex(boot, opts);
}

function loadBootBounded() {
  return Promise.race([
    loadBoot(),
    new Promise((resolve) => setTimeout(() => resolve(null), 1800)),
  ]);
}

module.exports = {
  HOME,
  slimCoin,
  readHome,
  renderHomeHtml,
  loadBoot,
  loadBootBounded,
  resetBootMemory,
  fetchBoot,
};
