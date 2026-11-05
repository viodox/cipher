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
  mergeArchive,
  meetsDexFloor,
} = require('../universe');

const GT_BASE = 'https://api.geckoterminal.com/api/v2';
const CACHE_KEY = 'cipher:dex:v1';
const FRESH_MS = 12 * 60 * 1000;
const BACKOFF_MS = 10 * 60 * 1000;
// Longer than the quiet window so an idle archive is not deleted before the
// 2–3 day expiry can run on the next refresh.
const REDIS_TTL_SEC = 3 * 24 * 60 * 60;

const GT_NETWORKS = ['solana', 'base', 'bsc', 'eth'];
const EXTRA_GT = [
  { network: 'solana', feed: 'new_pools', page: 2 },
  { network: 'solana', feed: 'trending_pools', page: 2 },
  { network: 'base', feed: 'new_pools', page: 2 },
  { network: 'base', feed: 'trending_pools', page: 2 },
  { network: 'bsc', feed: 'new_pools', page: 2 },
  { network: 'bsc', feed: 'trending_pools', page: 2 },
  { network: 'eth', feed: 'new_pools', page: 2 },
  { network: 'eth', feed: 'trending_pools', page: 2 },
  { network: 'arbitrum', feed: 'new_pools', page: 1 },
  { network: 'arbitrum', feed: 'trending_pools', page: 1 },
  { network: 'arbitrum', feed: 'new_pools', page: 2 },
  { network: 'arbitrum', feed: 'trending_pools', page: 2 },
];
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

function visibleDex(saved) {
  if (!saved || !Array.isArray(saved.rows)) return saved;
  const rows = saved.rows.filter(meetsDexFloor);
  if (rows.length === saved.rows.length) return saved;
  return Object.assign({}, saved, { rows: rows, counts: summarize(rows) });
}

async function loadDexCachedOnly() {
  const now = Date.now();
  if (memory.value && memory.exp > now) return visibleDex(memory.value);
  const saved = await cacheGet(CACHE_KEY);
  if (saved && Array.isArray(saved.rows)) {
    const clean = visibleDex(saved);
    if (now - Number(saved.at || 0) < FRESH_MS) {
      memory.exp = now + FRESH_MS;
      memory.value = clean;
    }
    return clean;
  }
  return visibleDex(memory.value) || emptyDex(now);
}

function gtUrl(network, feed, page) {
  return GT_BASE + '/networks/' + network + '/' + feed + '?include=base_token&page=' + page;
}

function gtJob(network, feed, page) {
  return { kind: 'gt', feed: feed, network: network, page: page, url: gtUrl(network, feed, page) };
}

function gtJobs() {
  const jobs = [];
  GT_NETWORKS.forEach((network) => {
    jobs.push(gtJob(network, 'new_pools', 1));
    jobs.push(gtJob(network, 'trending_pools', 1));
  });
  return jobs;
}

function jobsForRotation(rotation) {
  const coreCursor = Number(rotation && rotation.coreCursor) || 0;
  const extraCursor = Number(rotation && rotation.extraCursor) || 0;
  const core = gtJobs();
  const selected = [];
  for (let i = 0; i < 4; i += 1) selected.push(core[(coreCursor + i) % core.length]);
  const extra = EXTRA_GT[extraCursor % EXTRA_GT.length];
  selected.push(gtJob(extra.network, extra.feed, extra.page));
  return {
    jobs: dexJobs().concat(selected),
    next: { coreCursor: coreCursor + 4, extraCursor: extraCursor + 1 },
  };
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

function priorArchive(snapshot) {
  if (!snapshot) return [];
  const visible = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const held = Array.isArray(snapshot.held) ? snapshot.held : [];
  if (Array.isArray(snapshot.archive) && snapshot.archive.length) return snapshot.archive;
  return visible.concat(held);
}

function combineDex(previous, fresh, now) {
  if (!fresh) return previous || emptyDex(now);
  const stamp = now || Date.now();
  const merged = mergeArchive(priorArchive(previous), fresh.rows || [], stamp);
  const rotation = (fresh && fresh.rotation) || (previous && previous.rotation) || { coreCursor: 0, extraCursor: 0 };
  return emptyDex(stamp, {
    ok: merged.visible.length > 0,
    rows: merged.visible,
    held: merged.held,
    counts: summarize(merged.visible),
    partial: !!(fresh.partial || fresh.rateLimited),
    rateLimited: !!fresh.rateLimited,
    rotation: rotation,
  });
}

async function fetchDex(options, now) {
  const fetchImpl = options.fetchImpl || defaultFetch;
  const deadline = Date.now() + (options.budgetMs || 7000);
  const planned = jobsForRotation(options.rotation);
  const first = await runJobs(planned.jobs, fetchImpl, deadline);
  let rows = rowsFromResults(first.results);
  let rateLimited = first.rateLimited || now < memory.backoffUntil;
  if (!rateLimited && Date.now() < deadline) {
    const extra = await runJobs(enrichTargets(rows), fetchImpl, deadline);
    applyPairs(rows, extra.results);
    rateLimited = rateLimited || extra.rateLimited;
  }
  rows = finalizeDexList(rows).filter(meetsDexFloor);
  const finished = first.results.length;
  return emptyDex(now, {
    ok: rows.length > 0,
    rows: rows,
    counts: summarize(rows),
    partial: rateLimited || finished < planned.jobs.length,
    rateLimited: !!rateLimited,
    rotation: rateLimited ? (options.rotation || { coreCursor: 0, extraCursor: 0 }) : planned.next,
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
      const clean = visibleDex(saved);
      memory.exp = now + FRESH_MS;
      memory.value = clean;
      return clean;
    }
  }
  if (!options.force && now < memory.backoffUntil) {
    if (memory.value) return visibleDex(memory.value);
    if (!isolated) {
      const saved = await cacheGet(CACHE_KEY);
      if (saved && Array.isArray(saved.rows)) return visibleDex(saved);
    }
    return emptyDex(now, { rateLimited: true, partial: true });
  }
  if (!isolated && memory.inflight) return memory.inflight;

  const job = (async () => {
    try {
      let previous = options.previous || null;
      if (!previous && !isolated && memory.value && (Array.isArray(memory.value.rows) || Array.isArray(memory.value.held))) previous = memory.value;
      else if (!previous && !isolated) {
        const saved = await cacheGet(CACHE_KEY);
        if (saved && (Array.isArray(saved.rows) || Array.isArray(saved.held))) previous = saved;
      }
      const fresh = await fetchDex(Object.assign({}, options, { rotation: previous && previous.rotation }), now);
      const payload = combineDex(previous, fresh, now);
      const hadPrior = !!(previous && priorArchive(previous).length);
      if (!isolated && (payload.rows.length || (payload.held && payload.held.length) || (hadPrior && !fresh.rateLimited))) {
        const hold = payload.rateLimited || payload.partial ? Math.min(FRESH_MS, BACKOFF_MS) : FRESH_MS;
        memory.exp = now + hold;
        memory.value = payload;
        await cacheSet(CACHE_KEY, payload, REDIS_TTL_SEC);
      }
      if (payload.rows.length || (payload.held && payload.held.length)) return payload;
      if (previous && fresh.rateLimited) return visibleDex(previous);
      if (hadPrior) return payload;
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
  jobsForRotation,
};
