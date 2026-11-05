'use strict';

const { createCache, fetchJson } = require('./http-util');
const { chainFromDex, canonicalAddress, validAddress } = require('./chains');
const { loadDexCachedOnly } = require('./dex');

const cache = createCache(4);
const TTL_MS = 120 * 1000;
const CACHE_KEY = 'radar';

function pickRows(payload) {
  const rows = Array.isArray(payload) ? payload : (payload && (payload.pairs || payload.data)) || [];
  const out = [];
  const seen = new Set();
  rows.forEach((row) => {
    if (!row) return;
    const chain = chainFromDex(row.chainId || row.chain);
    const raw = row.tokenAddress || row.address || (row.baseToken && row.baseToken.address);
    if (!chain || !raw) return;
    const address = canonicalAddress(chain, raw);
    if (!validAddress(chain, address)) return;
    const id = chain.slug + ':' + address;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      chain,
      address,
      description: typeof row.description === 'string' ? row.description.slice(0, 140) : '',
      dexUrl: typeof row.url === 'string' ? row.url : '',
    });
  });
  return out;
}

function goplusFlags(chain, token) {
  const reasons = [];
  let stamp = 'CLEAN';
  if (!token) return { stamp: 'UNKNOWN', reasons: ['GoPlus returned no row'] };
  if (chain.kind === 'evm') {
    const on = (v) => v === '1' || v === 1;
    if (on(token.is_honeypot) || on(token.cannot_sell_all)) {
      stamp = 'HONEYPOT';
      reasons.push(on(token.is_honeypot) ? 'GoPlus honeypot flag' : 'Cannot sell full balance');
    }
    const sell = parseFloat(token.sell_tax);
    if (Number.isFinite(sell) && sell > 0) {
      const pct = sell <= 1 ? sell * 100 : sell;
      if (pct >= 49) { stamp = 'HONEYPOT'; reasons.push('Sell tax ' + pct.toFixed(0) + '%'); }
      else if (pct > 10) { if (stamp === 'CLEAN') stamp = 'CAUTION'; reasons.push('Sell tax ' + pct.toFixed(1) + '%'); }
    }
    if (on(token.is_mintable)) { if (stamp === 'CLEAN') stamp = 'CAUTION'; reasons.push('Mintable'); }
    if (on(token.owner_change_balance)) { if (stamp === 'CLEAN') stamp = 'CAUTION'; reasons.push('Owner can change balances'); }
    if (on(token.hidden_owner) || on(token.can_take_back_ownership)) { if (stamp === 'CLEAN') stamp = 'CAUTION'; reasons.push('Owner privilege'); }
    if (on(token.is_proxy)) { if (stamp === 'CLEAN') stamp = 'CAUTION'; reasons.push('Proxy contract'); }
    const owner = token.owner_address || '';
    const renounced = /^0x0{40}$/i.test(owner);
    if (on(token.is_blacklisted) && !renounced) { if (stamp === 'CLEAN') stamp = 'CAUTION'; reasons.push('Blacklist function, owner active'); }
    const holders = Array.isArray(token.holders) ? token.holders : [];
    if (holders[0]) {
      const pct = parseFloat(holders[0].percent);
      if (Number.isFinite(pct) && pct >= 0.3) { if (stamp === 'CLEAN') stamp = 'CAUTION'; reasons.push('Top holder ' + (pct * 100).toFixed(0) + '%'); }
    }
    return {
      stamp,
      reasons,
      symbol: token.token_symbol || null,
      name: token.token_name || null,
    };
  }
  const status = (obj) => obj && (obj.status === '1' || obj.status === 1);
  if (status(token.mintable)) { stamp = 'CAUTION'; reasons.push('Mint authority active'); }
  if (status(token.freezable)) { stamp = 'CAUTION'; reasons.push('Freeze authority active'); }
  if (token.non_transferable === '1' || token.non_transferable === 1) { stamp = 'HONEYPOT'; reasons.push('Non-transferable'); }
  const holders = Array.isArray(token.holders) ? token.holders : [];
  if (holders[0]) {
    const pct = parseFloat(holders[0].percent);
    if (Number.isFinite(pct) && pct >= 0.3) { if (stamp === 'CLEAN') stamp = 'CAUTION'; reasons.push('Top holder ' + (pct * 100).toFixed(0) + '%'); }
  }
  const meta = token.metadata || {};
  return { stamp, reasons, symbol: meta.symbol || null, name: meta.name || null };
}

async function loadLists() {
  const [boosts, latest] = await Promise.all([
    fetchJson('https://api.dexscreener.com/token-boosts/top/v1', 7000),
    fetchJson('https://api.dexscreener.com/token-profiles/latest/v1', 7000),
  ]);
  const rows = [...pickRows(boosts.json), ...pickRows(latest.json)];
  const seen = new Set();
  return rows.filter((row) => {
    const id = row.chain.slug + ':' + row.address;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 12);
}

function rowFrom(chain, row, token) {
  const flags = goplusFlags(chain, token);
  return {
    chain: chain.slug,
    chainName: chain.name,
    address: row.address,
    symbol: flags.symbol || row.address.slice(0, 4) + '…' + row.address.slice(-4),
    name: flags.name || row.description || 'Unknown token',
    description: row.description || '',
    dexUrl: row.dexUrl,
    stamp: flags.stamp,
    reasons: flags.reasons.length ? flags.reasons : ['No GoPlus danger flags on this pass'],
    scanPath: '/scan/' + chain.slug + '/' + row.address,
    checkPath: '/check/' + chain.slug + '/' + row.address,
  };
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      out[idx] = await fn(items[idx]);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function checkGroup(chain, rows) {
  // Solana's token_security endpoint returns only the first address in a
  // comma-separated batch, so those are fetched one at a time.
  if (chain.kind !== 'evm') {
    return mapPool(rows, 4, async (row) => {
      const url = 'https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=' + encodeURIComponent(row.address);
      const res = await fetchJson(url, 7000);
      const map = (res.json && res.json.result) || {};
      const token = map[row.address] || Object.values(map)[0] || null;
      return rowFrom(chain, row, token);
    });
  }
  const joined = rows.map((r) => r.address).join(',');
  const url = 'https://api.gopluslabs.io/api/v1/token_security/' + chain.goplus + '?contract_addresses=' + joined;
  const res = await fetchJson(url, 8000);
  const map = (res.json && res.json.result) || {};
  const byKey = {};
  Object.keys(map).forEach((k) => { byKey[k.toLowerCase()] = map[k]; });
  return rows.map((row) => rowFrom(chain, row, map[row.address] || byKey[row.address.toLowerCase()] || null));
}

function freshFromDex(dex, items) {
  const seen = new Set((items || []).map((item) => item.chain + ':' + String(item.address || '').toLowerCase()));
  const rows = dex && Array.isArray(dex.rows) ? dex.rows : [];
  return rows.filter((row) => row && row.symbol && row.checkPath && !seen.has(row.chain + ':' + String(row.address).toLowerCase())).slice(0, 8).map((row) => ({
    chain: row.chain,
    chainName: row.chainName,
    address: row.address,
    symbol: row.symbol,
    name: row.name,
    source: row.source,
    priceUsd: row.current_price,
    change24h: row.price_change_percentage_24h,
    volume: row.total_volume,
    checkPath: row.checkPath,
  }));
}

async function attachFresh(payload) {
  try {
    const dex = await loadDexCachedOnly();
    payload.fresh = freshFromDex(dex, payload.items);
  } catch (err) {
    payload.fresh = [];
  }
  return payload;
}

async function getRadar() {
  const hit = cache.get(CACHE_KEY);
  if (hit) return hit;
  const rows = await loadLists();
  if (!rows.length) {
    return attachFresh({
      ok: false,
      updatedAt: new Date().toISOString(),
      source: 'DexScreener token boosts and latest profiles, checked with GoPlus',
      items: [],
      error: 'DexScreener returned no supported tokens',
    });
  }
  const groups = new Map();
  rows.forEach((row) => {
    const key = row.chain.slug;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  const batches = await Promise.all([...groups.values()].map((group) => checkGroup(group[0].chain, group)));
  const items = batches.flat();
  const order = { HONEYPOT: 0, CAUTION: 1, UNKNOWN: 2, CLEAN: 3 };
  items.sort((a, b) => (order[a.stamp] ?? 9) - (order[b.stamp] ?? 9));
  const payload = await attachFresh({
    ok: true,
    updatedAt: new Date().toISOString(),
    source: 'DexScreener token boosts + latest profiles, GoPlus token security. Fresh pools below are not a GoPlus pass. Open a row for honeypot.is / RugCheck.',
    items,
  });
  cache.set(CACHE_KEY, payload, TTL_MS);
  return payload;
}

module.exports = { getRadar, TTL_MS };
