'use strict';

const { proxyCoinGeckoJson } = require('./coingecko');
const { cacheGet, cacheSet } = require('./store');
const { judgeListedPage, slimListedCoin, listedVolumeOk } = require('../universe');

const TAIL_KEY = 'cipher:cg:tail:v1';
const HOLD_MS = 10 * 60 * 60 * 1000;
const STEP_MS = 30 * 60 * 1000;
const COLD_PAGES = 4;
const MAX_PAGE = 16;
const REDIS_TTL_SEC = 12 * 60 * 60;

const memory = { value: null };

function resetListedMemory() {
  memory.value = null;
}

function emptyTail(now) {
  return {
    at: now || 0,
    advancedAt: 0,
    updatedAt: null,
    nextPage: 2,
    stopped: false,
    rebuilding: false,
    pendingRestart: false,
    holdUntil: 0,
    minVolume: null,
    coins: [],
    previous: null,
  };
}

function planTail(saved, now, opts) {
  const options = opts || {};
  const holdMs = options.holdMs || HOLD_MS;
  const stepMs = options.stepMs || STEP_MS;
  const coldPages = options.coldPages || COLD_PAGES;
  const stamp = Number(now) || Date.now();
  if (!saved || !Array.isArray(saved.coins) || (!saved.coins.length && !saved.stopped && !saved.advancedAt)) {
    return { pages: coldPages, restart: false, reason: 'cold' };
  }
  if (saved.stopped && stamp < Number(saved.holdUntil || 0)) {
    return { pages: 0, restart: false, reason: 'hold' };
  }
  if (saved.stopped && stamp >= Number(saved.holdUntil || (Number(saved.advancedAt || 0) + holdMs))) {
    return { pages: 1, restart: true, reason: 'revalidate' };
  }
  if (stamp - Number(saved.advancedAt || saved.at || 0) < stepMs) {
    return { pages: 0, restart: false, reason: 'step' };
  }
  return { pages: 1, restart: false, reason: 'step-due' };
}

function dedupeCoins(rows) {
  const byId = new Map();
  (Array.isArray(rows) ? rows : []).forEach((coin) => {
    if (!coin || !coin.id) return;
    byId.set(String(coin.id), coin);
  });
  return [...byId.values()];
}

function applyListedPage(state, page, raw, now, opts) {
  const options = opts || {};
  const holdMs = options.holdMs || HOLD_MS;
  const maxPage = options.maxPage || MAX_PAGE;
  const stamp = Number(now) || Date.now();
  const next = Object.assign({}, state || emptyTail(stamp));
  if (next.pendingRestart) {
    next.previous = (next.coins || []).slice();
    next.coins = [];
    next.pendingRestart = false;
    next.rebuilding = true;
    next.stopped = false;
    next.holdUntil = 0;
  }
  const slim = (Array.isArray(raw) ? raw : []).map(slimListedCoin).filter(Boolean);
  const verdict = judgeListedPage(raw);
  const coins = (next.coins || []).filter((coin) => coin._page !== page);
  slim.forEach((coin) => coins.push(Object.assign({}, coin, { _page: page })));
  next.coins = dedupeCoins(coins);
  next.nextPage = page + 1;
  next.minVolume = verdict.minVolume;
  next.advancedAt = stamp;
  next.at = stamp;
  next.updatedAt = new Date(stamp).toISOString();
  if (verdict.stop || next.nextPage > maxPage) {
    next.stopped = true;
    next.holdUntil = stamp + holdMs;
    next.rebuilding = false;
    next.previous = null;
  }
  return next;
}

function tailCoins(state) {
  if (!state) return [];
  const fresh = Array.isArray(state.coins) ? state.coins : [];
  const rows = !state.rebuilding
    ? fresh
    : fresh.concat((state.previous || []).filter((coin) => {
      if (!coin || !coin.id) return false;
      if (Number(coin._page) < Number(state.nextPage || 2)) return false;
      return !fresh.some((row) => row.id === coin.id);
    }));
  return dedupeCoins(rows).map((coin) => {
    const copy = Object.assign({}, coin);
    delete copy._page;
    return copy;
  }).filter(listedVolumeOk);
}

async function defaultFetchPage(page) {
  const hit = await proxyCoinGeckoJson('coins/markets', {
    vs_currency: 'usd',
    category: 'meme-token',
    order: 'volume_desc',
    per_page: '250',
    page: String(page),
    sparkline: 'false',
    price_change_percentage: '24h,7d',
  });
  if (!hit.ok || !Array.isArray(hit.json)) return null;
  return hit.json;
}

async function stepListedTail(state, fetchPage, now, opts) {
  const stamp = Number(now) || Date.now();
  const plan = planTail(state, stamp, opts);
  const base = state && Array.isArray(state.coins) ? state : emptyTail(stamp);
  if (!plan.pages) return { state: base, changed: false, calls: 0, plan: plan };
  let current = Object.assign({}, base, {
    coins: (base.coins || []).slice(),
    pendingRestart: !!plan.restart,
  });
  if (plan.restart) {
    current.stopped = false;
    current.nextPage = 2;
  }
  const fetchImpl = fetchPage || defaultFetchPage;
  let calls = 0;
  let page = current.nextPage || 2;
  for (let n = 0; n < plan.pages; n += 1) {
    if (page > ((opts && opts.maxPage) || MAX_PAGE)) {
      current.stopped = true;
      current.holdUntil = stamp + ((opts && opts.holdMs) || HOLD_MS);
      current.rebuilding = false;
      current.previous = null;
      current.advancedAt = stamp;
      break;
    }
    let raw = null;
    try { raw = await fetchImpl(page); }
    catch (err) { raw = null; }
    calls += 1;
    if (!Array.isArray(raw)) {
      current.advancedAt = stamp;
      current.at = stamp;
      break;
    }
    current = applyListedPage(current, page, raw, stamp, opts);
    if (current.stopped) break;
    page = current.nextPage;
  }
  return { state: current, changed: calls > 0 && Array.isArray(current.coins), calls: calls, plan: plan };
}

async function readTail() {
  if (memory.value && Array.isArray(memory.value.coins)) return memory.value;
  const saved = await cacheGet(TAIL_KEY);
  if (saved && Array.isArray(saved.coins)) {
    memory.value = saved;
    return saved;
  }
  return null;
}

async function loadListedTail(opts) {
  const options = opts || {};
  const now = options.now || Date.now();
  if (!options.advance) {
    const cached = options.saved || await readTail();
    return cached || emptyTail(now);
  }
  const saved = options.saved || (options.isolated ? null : await readTail());
  const stepped = await stepListedTail(saved, options.fetchPage || defaultFetchPage, now, options);
  if (!options.isolated && stepped.changed) {
    memory.value = stepped.state;
    await cacheSet(TAIL_KEY, stepped.state, REDIS_TTL_SEC);
  }
  return stepped.state;
}

module.exports = {
  TAIL_KEY,
  HOLD_MS,
  STEP_MS,
  COLD_PAGES,
  MAX_PAGE,
  emptyTail,
  planTail,
  applyListedPage,
  tailCoins,
  stepListedTail,
  loadListedTail,
  resetListedMemory,
};
