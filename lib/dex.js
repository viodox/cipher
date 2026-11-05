'use strict';

const { fetchJson } = require('./http-util');
const { cacheGet, cacheSet } = require('./store');
const {
  normalizeGtPayload,
  normalizeDexList,
  applyDexPair,
  finalizeDexList,
  summarize,
  canonicalAddress,
} = require('../universe');

const GT_BASE = 'https://api.geckoterminal.com/api/v2';
const CACHE_KEY = 'cipher:dex:v1';
const FRESH_MS = 12 * 60 * 1000;
const BACKOFF_MS = 10 * 60 * 1000;
const REDIS_TTL_SEC = 6 * 60 * 60;

const GT_NETWORKS = ['solana', 'base', 'bsc', 'eth'];
const memory = { exp: 0, value: null, inflight: null, backoffUntil: 0 };

function resetDexMemory() {
  memory.exp = 0;
  memory.value = null;
  memory.inflight = null;
  memory.backoffUntil = 0;
}

function emptyDex(now, extra) {
  return Object.assign({
    ok: true,
    at: now || Date.now(),
    updatedAt: new Date(now || Date.now()).toISOString(),
    source: 'geckoterminal+dexscreener',
    rows: [],
    counts: summarize([]),
    partial: false,
    rateLimited: false,
  }, extra || {});
}

function peekDex() {
  return memory.value;
}

async function defaultFetch(url) {
  const hit = await fetchJson(url, 2500);
  return { ok: !!hit.ok, status: hit.status || 0, json: hit.json };
}

async function loadDexCachedOnly() {
  const now = Date.now();
  if (memory.value && memory.exp > now) return memory.value;
  const saved = await cacheGet(CACHE_KEY);
  if (saved && Array.isArray(saved.rows)) {
    if (now - Number(saved.at || 0) < FRESH_MS) {
      memory.exp = now + FRESH_MS;
      memory.value = saved;
    }
    return saved;
  }
  return memory.value || emptyDex(now);
}

function gtJobs() {
  const jobs = [];
  GT_NETWORKS.forEach((network) => {
    jobs.push({
      kind: 'gt',
      feed: 'new_pools',
      url: GT_BASE + '/networks/' + network + '/new_pools?include=base_token&page=1',
    });
    jobs.push({
      kind: 'gt',
      feed: 'trending_pools',
      url: GT_BASE + '/networks/' + network + '/trending_pools?include=base_token&page=1',
    });
  });
  return jobs;
}

function dexJobs() {
  return [
    { kind: 'dex', feed: 'boosts_latest', url: 'https://api.dexscreener.com/token-boosts/latest/v1' },
    { kind: 'dex', feed: 'boosts_top', url: 'https://api.dexscreener.com/token-boosts/top/v1' },
    { kind: 'dex', feed: 'profiles_latest', url: 'https://api.dexscreener.com/token-profiles/latest/v1' },
  ];
}

async function runJobs(jobs, fetchImpl, deadline) {
  const results = [];
  let index = 0;
  let rateLimited = false;
  async function worker() {
    while (!rateLimited && Date.now() < deadline) {
      const current = index;
      index += 1;
      if (current >= jobs.length) return;
      let res = null;
      try { res = await fetchImpl(jobs[current].url); }
      catch (err) { res = { ok: false, status: 0, json: null }; }
      if (res && res.status === 429) {
        rateLimited = true;
        memory.backoffUntil = Date.now() + BACKOFF_MS;
      }
      results.push({ job: jobs[current], res: res });
    }
  }
  const width = Math.min(3, jobs.length || 1);
  await Promise.all(Array.from({ length: width }, () => worker()));
  return { results, rateLimited };
}

function rowsFromResults(results) {
  const rows = [];
  results.forEach((item) => {
    const body = item.res && item.res.json;
    if (!item.res || !item.res.ok || !body) return;
    if (item.job.kind === 'gt') rows.push.apply(rows, normalizeGtPayload(body, item.job.feed));
    if (item.job.kind === 'dex') rows.push.apply(rows, normalizeDexList(body, item.job.feed));
  });
  return rows;
}

function enrichTargets(rows) {
  const byChain = new Map();
  rows.forEach((row) => {
    if (row.source !== 'dexscreener') return;
    if (row.current_price && row.symbol) return;
    if (!byChain.has(row.chain)) byChain.set(row.chain, []);
    const list = byChain.get(row.chain);
    if (list.length < 30) list.push(row.address);
  });
  const slug = { eth: 'ethereum', bsc: 'bsc', base: 'base', sol: 'solana', arb: 'arbitrum' };
  const jobs = [];
  byChain.forEach((addresses, chain) => {
    const name = slug[chain];
    if (!name || !addresses.length) return;
    jobs.push({
      kind: 'pairs',
      chain: chain,
      url: 'https://api.dexscreener.com/tokens/v1/' + name + '/' + addresses.join(','),
    });
  });
  return jobs;
}

function applyPairs(rows, results) {
  const best = new Map();
  results.forEach((item) => {
    if (!item.res || !item.res.ok || item.job.kind !== 'pairs') return;
    const pairs = Array.isArray(item.res.json) ? item.res.json : [];
    pairs.forEach((pair) => {
      const base = pair && pair.baseToken;
      if (!base || !base.address) return;
      const key = item.job.chain + ':' + canonicalAddress(item.job.chain, base.address).toLowerCase();
      const liquidity = Number(pair.liquidity && pair.liquidity.usd) || 0;
      const prev = best.get(key);
      if (!prev || liquidity > prev.liquidity) best.set(key, { liquidity, pair });
    });
  });
  rows.forEach((row) => {
    const key = row.chain + ':' + canonicalAddress(row.chain, row.address).toLowerCase();
    const hit = best.get(key);
    if (hit) applyDexPair(row, hit.pair);
  });
  return rows;
}

function combineDex(previous, fresh, now) {
  if (!fresh) return previous || emptyDex(now);
  const prior = previous && Array.isArray(previous.rows) ? previous.rows : [];
  if ((!fresh.rateLimited && !fresh.partial) || !prior.length) return fresh;
  const rows = finalizeDexList(prior.concat(fresh.rows || []));
  return emptyDex(now || Date.now(), {
    ok: rows.length > 0,
    rows: rows,
    counts: summarize(rows),
    partial: true,
    rateLimited: !!fresh.rateLimited,
  });
}

async function fetchDex(options, now) {
  const fetchImpl = options.fetchImpl || defaultFetch;
  const deadline = Date.now() + (options.budgetMs || 7000);
  const listed = dexJobs().concat(gtJobs());
  const first = await runJobs(listed, fetchImpl, deadline);
  let rows = rowsFromResults(first.results);
  let rateLimited = first.rateLimited || now < memory.backoffUntil;
  if (!rateLimited && Date.now() < deadline) {
    const extra = await runJobs(enrichTargets(rows), fetchImpl, deadline);
    applyPairs(rows, extra.results);
    rateLimited = rateLimited || extra.rateLimited;
  }
  rows = finalizeDexList(rows);
  const finished = first.results.length + 0;
  return emptyDex(now, {
    ok: rows.length > 0,
    rows: rows,
    counts: summarize(rows),
    partial: rateLimited || finished < listed.length,
    rateLimited: !!rateLimited,
  });
}

async function loadDexUniverse(opts) {
  const options = opts || {};
  const now = options.now || Date.now();
  const isolated = !!options.fetchImpl;
  if (!options.force && !isolated && memory.value && memory.exp > now) return memory.value;
  if (!options.force && !isolated) {
    const saved = await cacheGet(CACHE_KEY);
    if (saved && Array.isArray(saved.rows) && saved.rows.length && now - Number(saved.at || 0) < FRESH_MS) {
      memory.exp = now + FRESH_MS;
      memory.value = saved;
      return saved;
    }
  }
  if (!options.force && now < memory.backoffUntil) {
    if (memory.value) return memory.value;
    if (!isolated) {
      const saved = await cacheGet(CACHE_KEY);
      if (saved && Array.isArray(saved.rows)) return saved;
    }
    return emptyDex(now, { rateLimited: true, partial: true });
  }
  if (!isolated && memory.inflight) return memory.inflight;

  const job = (async () => {
    try {
      const fresh = await fetchDex(options, now);
      let previous = null;
      if (!isolated && memory.value && Array.isArray(memory.value.rows) && memory.value.rows.length) previous = memory.value;
      else if (!isolated) {
        const saved = await cacheGet(CACHE_KEY);
        if (saved && Array.isArray(saved.rows) && saved.rows.length) previous = saved;
      }
      const payload = combineDex(previous, fresh, now);
      if (payload.rows.length && !isolated) {
        const hold = payload.rateLimited || payload.partial ? Math.min(FRESH_MS, BACKOFF_MS) : FRESH_MS;
        memory.exp = now + hold;
        memory.value = payload;
        await cacheSet(CACHE_KEY, payload, REDIS_TTL_SEC);
      }
      if (payload.rows.length) return payload;
      if (previous) return previous;
      return fresh;
    } catch (err) {
      if (memory.value) return memory.value;
      return emptyDex(now, { partial: true });
    }
  })();

  if (!isolated) {
    memory.inflight = job;
    try { return await job; }
    finally { memory.inflight = null; }
  }
  return job;
}

module.exports = {
  CACHE_KEY,
  FRESH_MS,
  resetDexMemory,
  peekDex,
  loadDexCachedOnly,
  loadDexUniverse,
  combineDex,
  gtJobs,
  dexJobs,
};
