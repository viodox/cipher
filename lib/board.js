'use strict';

const { esc } = require('./http-util');
const { copyAddressHtml } = require('./copy-address');
const { proxyCoinGeckoJson } = require('./coingecko');
const { checkToken } = require('./ape');
const { loadMovers } = require('./movers');
const { cacheGet, cacheSet } = require('./store');

const CACHE_KEY = 'cipher:board:v1';
const FRESH_MS = 10 * 60 * 1000;
const memory = { at: 0, value: null };

const CHAIN_SLUG = {
  ethereum: 'eth',
  eth: 'eth',
  bsc: 'bsc',
  base: 'base',
  solana: 'sol',
  sol: 'sol',
};

const PLATFORM = {
  ethereum: 'eth',
  'binance-smart-chain': 'bsc',
  base: 'base',
  solana: 'sol',
};

function resetBoardMemory() {
  memory.at = 0;
  memory.value = null;
}

function gradeClass(letter) {
  const head = String(letter || '').charAt(0).toLowerCase();
  if (head === 'a' || head === 'b' || head === 'c' || head === 'd') return 'grade-' + head;
  return letter ? 'grade-f' : '';
}

async function fetchJson(url, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'CipherSignal/1.0 (+https://www.ciphersignal.xyz)' },
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (err) { json = null; }
    return { ok: res.ok, json };
  } catch (err) {
    return { ok: false, json: null };
  } finally {
    clearTimeout(timer);
  }
}

function rowsFromBoosts(items) {
  const out = [];
  const seen = new Set();
  (items || []).forEach((item) => {
    const chain = CHAIN_SLUG[String(item && item.chainId || '').toLowerCase()];
    const address = String(item && item.tokenAddress || '').trim();
    if (!chain || !address) return;
    const id = chain + ':' + address.toLowerCase();
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      chain,
      address: chain === 'sol' ? address : address.toLowerCase(),
      symbol: '',
      name: '',
      source: 'dexscreener',
      change24h: null,
      priceUsd: null,
    });
  });
  return out;
}

async function fillDexMeta(rows, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const byChain = new Map();
  rows.forEach((row) => {
    if (row.symbol) return;
    if (!byChain.has(row.chain)) byChain.set(row.chain, []);
    byChain.get(row.chain).push(row.address);
  });
  const dex = { eth: 'ethereum', bsc: 'bsc', base: 'base', sol: 'solana' };
  await Promise.all([...byChain.entries()].map(async ([chain, addresses]) => {
    const slug = dex[chain];
    if (!slug) return;
    const hit = await fetchJson('https://api.dexscreener.com/tokens/v1/' + slug + '/' + addresses.slice(0, 30).join(','), fetchFn);
    const pairs = Array.isArray(hit.json) ? hit.json : [];
    const best = new Map();
    pairs.forEach((pair) => {
      const base = pair && pair.baseToken;
      if (!base || !base.address) return;
      const key = String(base.address).toLowerCase();
      const liq = Number(pair.liquidity && pair.liquidity.usd) || 0;
      const prev = best.get(key);
      if (!prev || liq > prev.liq) {
        best.set(key, {
          liq,
          symbol: base.symbol,
          name: base.name,
          price: Number(pair.priceUsd),
          change: pair.priceChange && Number(pair.priceChange.h24),
        });
      }
    });
    rows.forEach((row) => {
      if (row.chain !== chain) return;
      const meta = best.get(String(row.address).toLowerCase());
      if (!meta) return;
      row.symbol = String(meta.symbol || '').slice(0, 16).toUpperCase();
      row.name = String(meta.name || '').slice(0, 64);
      if (Number.isFinite(meta.price)) row.priceUsd = meta.price;
      if (Number.isFinite(meta.change)) row.change24h = meta.change;
    });
  }));
  return rows;
}

async function rowsFromMovers(fetchImpl) {
  const movers = await loadMovers();
  if (!movers.ok) return [];
  const picks = (movers.gainers || []).slice(0, 5);
  const out = [];
  for (const coin of picks) {
    let detail = null;
    if (fetchImpl) {
      const hit = await fetchJson('https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(coin.id) + '?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false', fetchImpl);
      detail = hit.json;
    } else {
      const hit = await proxyCoinGeckoJson('coins/' + coin.id, {
        localization: 'false',
        tickers: 'false',
        market_data: 'false',
        community_data: 'false',
        developer_data: 'false',
      });
      detail = hit.json;
    }
    const platforms = detail && detail.platforms;
    if (!platforms || typeof platforms !== 'object') continue;
    const found = Object.keys(PLATFORM).map((key) => {
      const address = platforms[key];
      if (!address) return null;
      return { chain: PLATFORM[key], address: String(address) };
    }).find(Boolean);
    if (!found) continue;
    out.push({
      chain: found.chain,
      address: found.chain === 'sol' ? found.address : found.address.toLowerCase(),
      symbol: coin.symbol,
      name: coin.name,
      source: 'coingecko',
      change24h: coin.change24h,
      priceUsd: coin.price,
      coinId: coin.id,
    });
  }
  return out;
}

async function attachGrades(rows, grade, limit) {
  const fn = grade || checkToken;
  const todo = [];
  const seen = new Set();
  rows.forEach((row) => {
    const id = row.chain + ':' + row.address;
    if (row.letter || seen.has(id)) return;
    seen.add(id);
    todo.push(row);
  });
  const batch = todo.slice(0, limit);
  await Promise.all(batch.map(async (row) => {
    let report = null;
    try {
      report = await Promise.race([
        fn(row.chain, row.address),
        new Promise((resolve) => setTimeout(() => resolve(null), 4500)),
      ]);
    } catch (err) {
      report = null;
    }
    if (!report || !report.ok || !report.letter) {
      row.ungraded = true;
      return;
    }
    const id = row.chain + ':' + row.address;
    rows.forEach((other) => {
      if (other.chain + ':' + other.address !== id) return;
      other.letter = report.letter;
      other.score = report.score;
      other.ungraded = false;
      if (!other.symbol && report.symbol) other.symbol = report.symbol;
    });
  }));
  return rows.filter((row) => row.letter && !row.ungraded);
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row || !row.chain || !row.address) return false;
    const id = row.chain + ':' + String(row.address).toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function loadGradedBoard(opts) {
  const options = opts || {};
  const now = options.now || Date.now();
  if (!options.force && memory.value && now - memory.at < FRESH_MS) return memory.value;
  if (!options.force && !options.fetchImpl) {
    const saved = await cacheGet(CACHE_KEY);
    if (saved && Array.isArray(saved.rows) && now - Date.parse(saved.updatedAt || 0) < FRESH_MS) {
      memory.at = now;
      memory.value = saved;
      return saved;
    }
    if (options.refresh === false) return saved || { ok: true, rows: [], updatedAt: null };
  }
  const fetchImpl = options.fetchImpl || fetch;
  let boosts = [];
  if (options.boosts) {
    boosts = rowsFromBoosts(options.boosts);
  } else {
    const latest = await fetchJson('https://api.dexscreener.com/token-boosts/latest/v1', fetchImpl);
    const top = await fetchJson('https://api.dexscreener.com/token-boosts/top/v1', fetchImpl);
    boosts = rowsFromBoosts([].concat(latest.json || [], top.json || []));
  }
  await fillDexMeta(boosts, options.fetchImpl || null);
  let moverRows = [];
  if (options.skipMovers) moverRows = [];
  else {
    try { moverRows = await rowsFromMovers(options.fetchImpl); }
    catch (err) { moverRows = []; }
  }
  let rows = dedupe(moverRows.concat(boosts)).slice(0, 10);
  rows = rows.filter((row) => row.symbol || row.address);
  const graded = await attachGrades(rows, options.grade, options.fill == null ? 4 : options.fill);
  const payload = {
    ok: true,
    updatedAt: new Date(now).toISOString(),
    rows: graded.slice(0, 8).map((row) => ({
      chain: row.chain,
      address: row.address,
      symbol: row.symbol || '???',
      name: row.name || '',
      source: row.source || 'dexscreener',
      change24h: row.change24h,
      priceUsd: row.priceUsd,
      letter: row.letter,
      score: row.score,
      coinId: row.coinId || '',
      href: '/check/' + row.chain + '/' + row.address,
    })),
  };
  memory.at = now;
  memory.value = payload;
  if (!options.fetchImpl) await cacheSet(CACHE_KEY, payload, 6 * 60 * 60);
  return payload;
}

function peekBoard() {
  return memory.value;
}

function boardRowsHtml(rows) {
  if (!rows || !rows.length) {
    return '<p class="hint">No graded row in this snapshot. Tokens the public scanners cannot grade are left off.</p>';
  }
  return rows.map((row) => {
    const change = row.change24h == null ? '' : (row.change24h >= 0 ? '+' : '') + Number(row.change24h).toFixed(1) + '%';
    const changeClass = row.change24h == null ? '' : (row.change24h >= 0 ? 'pos' : 'neg');
    return '<div class="graded-line"><a class="graded-row" href="' + esc(row.href) + '">' +
      '<span class="graded-letter ' + gradeClass(row.letter) + '">' + esc(row.letter || '–') + '</span>' +
      '<span><b>$' + esc(row.symbol) + '</b><span class="graded-sub">' + esc(row.name || row.chain) + ' · ' + esc(row.chain) + '</span></span>' +
      '<span class="' + changeClass + '">' + esc(change) + '</span>' +
      '</a>' + copyAddressHtml(row.address, { label: 'Copy contract address' }) + '</div>';
  }).join('');
}

module.exports = {
  rowsFromBoosts,
  loadGradedBoard,
  peekBoard,
  boardRowsHtml,
  resetBoardMemory,
  gradeClass,
};
