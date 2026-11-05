'use strict';

// Shared by the server and the browser. Turns free GeckoTerminal and
// DexScreener payloads into scanner rows and merges them with CoinGecko.
// Unlisted rows use a dex-* id. That is not a CoinGecko id.

const CHAINS = {
  solana: { chain: 'sol', name: 'Solana' },
  sol: { chain: 'sol', name: 'Solana' },
  base: { chain: 'base', name: 'Base' },
  bsc: { chain: 'bsc', name: 'BSC' },
  eth: { chain: 'eth', name: 'Ethereum' },
  ethereum: { chain: 'eth', name: 'Ethereum' },
  arbitrum: { chain: 'arb', name: 'Arbitrum' },
  arb: { chain: 'arb', name: 'Arbitrum' },
};

const QUOTES = {
  SOL: 1, WSOL: 1, ETH: 1, WETH: 1, USDC: 1, USDT: 1, USD1: 1,
  BNB: 1, WBNB: 1, DAI: 1, BUSD: 1, WBTC: 1,
};

const LISTED_MIN_VOLUME = 100;
const DEX_MIN_VOLUME = 100;
const DEX_MIN_RESERVE = 1000;
// About 2.5 days. A pool that is not seen again, or whose last volume and
// liquidity stay under the floor, leaves the archive inside a 2–3 day window.
const ARCHIVE_QUIET_MS = 60 * 60 * 60 * 1000;
const ARCHIVE_MAX = 2000;
const HTML_DEX_PREVIEW = 24;
const MAX_DEX = ARCHIVE_MAX;

function chainInfo(network) {
  return CHAINS[String(network || '').toLowerCase()] || null;
}

function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanSymbol(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
}

function cleanName(value) {
  return String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
}

function httpsUrl(value) {
  const url = String(value || '').trim();
  if (!/^https:\/\/\S+$/i.test(url) || url.length > 300) return '';
  return url;
}

function canonicalAddress(chain, address) {
  const raw = String(address || '').trim();
  if (!raw) return '';
  return chain === 'sol' ? raw : raw.toLowerCase();
}

function validAddress(chain, address) {
  if (!address) return false;
  if (chain === 'sol') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  return /^0x[a-f0-9]{40}$/.test(address);
}

function dexId(chain, address) {
  return 'dex-' + chain + '-' + address;
}

function isDexRow(coin) {
  if (!coin) return false;
  if (coin.listed === false) return true;
  const source = String(coin.source || '').toLowerCase();
  if (source === 'geckoterminal' || source === 'dexscreener' || source === 'dex') return true;
  return /^dex-(eth|bsc|base|arb|sol)-/i.test(String(coin.id || ''));
}

function rowShell(fields) {
  const info = chainInfo(fields.chain || fields.network);
  if (!info) return null;
  const address = canonicalAddress(info.chain, fields.address);
  if (!validAddress(info.chain, address)) return null;
  const symbol = cleanSymbol(fields.symbol);
  const cgId = fields.cgId ? String(fields.cgId).trim().toLowerCase() : '';
  const price = finite(fields.price);
  const volume = finite(fields.volume);
  const marketCap = finite(fields.marketCap);
  const change = finite(fields.change);
  return {
    id: dexId(info.chain, address),
    cgId: cgId && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cgId) ? cgId : null,
    listed: false,
    source: fields.source,
    feed: fields.feed || '',
    symbol: symbol,
    name: cleanName(fields.name) || symbol,
    image: httpsUrl(fields.image),
    chain: info.chain,
    chainName: info.name,
    address: address,
    checkPath: '/check/' + info.chain + '/' + address,
    current_price: price,
    market_cap: marketCap != null && marketCap > 0 ? marketCap : 0,
    total_volume: volume != null && volume >= 0 ? volume : null,
    price_change_percentage_24h: change,
    price_change_percentage_7d_in_currency: null,
    market_cap_rank: null,
    reserve_usd: finite(fields.reserve),
  };
}

function symbolFromText(value) {
  const raw = String(value || '').trim();
  if (/^\$?[A-Za-z0-9]{2,12}$/.test(raw)) return raw.replace(/^\$/, '');
  return '';
}

function normalizeGtPool(pool, included, feed) {
  if (!pool || pool.type !== 'pool' || !pool.attributes) return null;
  const rel = pool.relationships || {};
  const baseRef = rel.base_token && rel.base_token.data;
  const network = (rel.network && rel.network.data && rel.network.data.id)
    || (baseRef && String(baseRef.id).split('_')[0])
    || '';
  const token = baseRef && included && included.get ? included.get(baseRef.id) : null;
  const attrs = (token && token.attributes) || {};
  const address = attrs.address || (baseRef ? String(baseRef.id).split('_').slice(1).join('_') : '');
  const poolName = String(pool.attributes.name || '');
  const symbol = attrs.symbol || symbolFromText(poolName.split('/')[0]);
  if (QUOTES[cleanSymbol(symbol).toUpperCase()]) return null;
  return rowShell({
    source: 'geckoterminal',
    feed: feed || 'new_pools',
    network: network,
    address: address,
    symbol: symbol,
    name: attrs.name || poolName.split('/')[0],
    image: attrs.image_url,
    price: pool.attributes.base_token_price_usd,
    volume: pool.attributes.volume_usd && pool.attributes.volume_usd.h24,
    marketCap: pool.attributes.market_cap_usd,
    change: pool.attributes.price_change_percentage && pool.attributes.price_change_percentage.h24,
    reserve: pool.attributes.reserve_in_usd,
    cgId: attrs.coingecko_coin_id,
  });
}

function indexIncluded(json) {
  const map = new Map();
  const rows = json && Array.isArray(json.included) ? json.included : [];
  rows.forEach((item) => {
    if (item && item.id) map.set(item.id, item);
  });
  return map;
}

function normalizeGtPayload(json, feed) {
  const included = indexIncluded(json);
  const data = json && Array.isArray(json.data) ? json.data : [];
  const out = [];
  data.forEach((pool) => {
    const row = normalizeGtPool(pool, included, feed);
    if (row) out.push(row);
  });
  return out;
}

function normalizeDexListItem(item, feed) {
  if (!item) return null;
  const description = typeof item.description === 'string' ? item.description : '';
  return rowShell({
    source: 'dexscreener',
    feed: feed || 'boosts_latest',
    network: item.chainId || item.chain,
    address: item.tokenAddress || item.address,
    symbol: symbolFromText(description),
    name: description,
    image: item.icon || item.header,
    price: null,
    volume: null,
    marketCap: null,
    change: null,
    cgId: null,
  });
}

function normalizeDexList(payload, feed) {
  const rows = Array.isArray(payload) ? payload : [];
  const out = [];
  rows.forEach((item) => {
    const row = normalizeDexListItem(item, feed);
    if (row) out.push(row);
  });
  return out;
}

function applyDexPair(row, pair) {
  if (!row || !pair) return row;
  const base = pair.baseToken || {};
  const symbol = cleanSymbol(base.symbol);
  const name = cleanName(base.name);
  if (symbol && !QUOTES[symbol.toUpperCase()]) row.symbol = symbol;
  if (name) row.name = name;
  const price = finite(pair.priceUsd);
  const volume = finite(pair.volume && pair.volume.h24);
  const change = finite(pair.priceChange && pair.priceChange.h24);
  const marketCap = finite(pair.marketCap);
  if (price != null && price > 0) row.current_price = price;
  if (volume != null && volume >= 0) row.total_volume = volume;
  if (change != null) row.price_change_percentage_24h = change;
  if (marketCap != null && marketCap > 0) row.market_cap = marketCap;
  const reserve = finite(pair.liquidity && pair.liquidity.usd);
  if (reserve != null) row.reserve_usd = reserve;
  return row;
}

function richness(row) {
  let score = 0;
  if (row.symbol) score += 2;
  if (row.current_price) score += 2;
  if (row.total_volume) score += 2;
  if (row.cgId) score += 1;
  if (row.source === 'geckoterminal') score += 1;
  if (row.feed === 'new_pools') score += 1;
  return score;
}

function addressKey(row) {
  return row.chain + ':' + (row.chain === 'sol' ? row.address : String(row.address).toLowerCase());
}

function dedupeRows(rows) {
  const best = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row || !row.chain || !row.address) return;
    const key = addressKey(row);
    const prev = best.get(key);
    if (!prev || richness(row) > richness(prev)) best.set(key, row);
  });
  return [...best.values()];
}

function listedVolumeOk(coin) {
  const volume = Number(coin && coin.total_volume);
  return Number.isFinite(volume) && volume >= LISTED_MIN_VOLUME;
}

function meetsDexFloor(row) {
  const volume = Number(row && row.total_volume);
  const reserve = Number(row && row.reserve_usd);
  if (Number.isFinite(volume) && volume >= DEX_MIN_VOLUME) return true;
  if (Number.isFinite(reserve) && reserve >= DEX_MIN_RESERVE) return true;
  return false;
}

function acceptDexRow(row) {
  if (!row || !row.symbol || !row.chain || !row.address || !row.id) return false;
  if (String(row.symbol).length < 2) return false;
  if (QUOTES[String(row.symbol).toUpperCase()]) return false;
  // Boosts and profiles need a real ticker and the same floor. A ticker alone
  // is not trading.
  return meetsDexFloor(row);
}

function judgeListedPage(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  let min = null;
  rows.forEach((coin) => {
    const volume = Number(coin && coin.total_volume);
    if (!Number.isFinite(volume)) return;
    if (min == null || volume < min) min = volume;
  });
  const stop = !rows.length || rows.length < 250 || (min != null && min < LISTED_MIN_VOLUME);
  return { stop: stop, minVolume: min, count: rows.length };
}

function slimListedCoin(coin) {
  if (!coin || !coin.id || isDexRow(coin)) return null;
  if (!listedVolumeOk(coin)) return null;
  const volume = Number(coin.total_volume);
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

function capRows(rows, limit) {
  const max = limit || MAX_DEX;
  const buckets = { new_pools: [], trending_pools: [], dexscreener: [] };
  rows.forEach((row) => {
    if (row.source === 'dexscreener') buckets.dexscreener.push(row);
    else if (row.feed === 'trending_pools') buckets.trending_pools.push(row);
    else buckets.new_pools.push(row);
  });
  Object.keys(buckets).forEach((key) => {
    buckets[key].sort((a, b) => (Number(b.total_volume) || 0) - (Number(a.total_volume) || 0));
  });
  const out = [];
  const seen = new Set();
  function take(list, count) {
    list.forEach((row) => {
      if (out.length >= max || count <= 0 || seen.has(row.id)) return;
      seen.add(row.id);
      out.push(row);
      count -= 1;
    });
  }
  take(buckets.new_pools, 100);
  take(buckets.trending_pools, 80);
  take(buckets.dexscreener, 60);
  const rest = rows.slice().sort((a, b) => (Number(b.total_volume) || 0) - (Number(a.total_volume) || 0));
  take(rest, max);
  return out.slice(0, max);
}

function finalizeDexList(rows, limit) {
  const accepted = dedupeRows(rows).filter(acceptDexRow);
  if (!limit) return accepted;
  return capRows(accepted, limit);
}

function cloneDexRow(row) {
  return {
    id: row.id,
    cgId: row.cgId || null,
    listed: false,
    source: row.source,
    feed: row.feed || '',
    symbol: row.symbol,
    name: row.name,
    image: row.image || '',
    chain: row.chain,
    chainName: row.chainName,
    address: row.address,
    checkPath: row.checkPath,
    current_price: row.current_price,
    market_cap: row.market_cap || 0,
    total_volume: row.total_volume,
    price_change_percentage_24h: row.price_change_percentage_24h,
    price_change_percentage_7d_in_currency: null,
    market_cap_rank: null,
    reserve_usd: row.reserve_usd,
    seenAt: row.seenAt || null,
    firstSeen: row.firstSeen || null,
    quietSince: row.quietSince || null,
  };
}

function fillGap(next, prev, field) {
  const value = next[field];
  if (value == null || value === '') next[field] = prev[field];
}

function mergeArchive(previous, incoming, now, opts) {
  const options = opts || {};
  const quietMs = options.quietMs || ARCHIVE_QUIET_MS;
  const max = options.max || ARCHIVE_MAX;
  const stamp = Number(now) || Date.now();
  const map = new Map();
  (Array.isArray(previous) ? previous : []).forEach((row) => {
    if (!row || !row.chain || !row.address || !row.id) return;
    const copy = cloneDexRow(row);
    if (!copy.seenAt) copy.seenAt = stamp;
    if (!copy.firstSeen) copy.firstSeen = copy.seenAt;
    if (!meetsDexFloor(copy) && !copy.quietSince) copy.quietSince = stamp;
    map.set(addressKey(copy), copy);
  });
  dedupeRows(incoming).forEach((row) => {
    if (!row || !row.symbol || !row.chain || !row.address || !row.id) return;
    if (QUOTES[String(row.symbol).toUpperCase()]) return;
    const key = addressKey(row);
    const prev = map.get(key);
    const meets = meetsDexFloor(row);
    if (!meets && !prev) return;
    const next = cloneDexRow(row);
    if (prev) {
      fillGap(next, prev, 'image');
      fillGap(next, prev, 'name');
      fillGap(next, prev, 'symbol');
      if (!(next.current_price > 0) && prev.current_price) next.current_price = prev.current_price;
      if (next.total_volume == null && prev.total_volume != null) next.total_volume = prev.total_volume;
      if (!(next.reserve_usd > 0) && prev.reserve_usd) next.reserve_usd = prev.reserve_usd;
      if (!(next.market_cap > 0) && prev.market_cap) next.market_cap = prev.market_cap;
      next.firstSeen = prev.firstSeen || stamp;
    } else {
      next.firstSeen = stamp;
    }
    next.seenAt = stamp;
    next.quietSince = meets ? null : ((prev && prev.quietSince) || stamp);
    map.set(key, next);
  });
  const kept = [];
  map.forEach((row) => {
    const seenAt = Number(row.seenAt) || 0;
    if (!seenAt || stamp - seenAt >= quietMs) return;
    if (row.quietSince && stamp - Number(row.quietSince) >= quietMs) return;
    kept.push(row);
  });
  kept.sort((a, b) => (Number(b.total_volume) || 0) - (Number(a.total_volume) || 0) || (Number(b.seenAt) || 0) - (Number(a.seenAt) || 0));
  const rows = kept.slice(0, max);
  return {
    rows: rows,
    visible: rows.filter(meetsDexFloor),
    held: rows.filter((row) => !meetsDexFloor(row)),
  };
}

function tagCoinGecko(coin) {
  if (!coin || !coin.id || isDexRow(coin)) return null;
  return Object.assign({}, coin, { source: 'coingecko', listed: true });
}

function mergeUniverse(cgCoins, dexRows) {
  const out = [];
  const cgIds = new Set();
  (Array.isArray(cgCoins) ? cgCoins : []).forEach((coin) => {
    const tagged = tagCoinGecko(coin);
    if (!tagged) return;
    const id = String(tagged.id).toLowerCase();
    if (cgIds.has(id)) return;
    cgIds.add(id);
    out.push(tagged);
  });
  const seen = new Set();
  finalizeDexList(dexRows).forEach((row) => {
    if (row.cgId && cgIds.has(String(row.cgId).toLowerCase())) return;
    const key = addressKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  });
  return out;
}

function summarize(rows) {
  const counts = {
    total: 0,
    geckoterminal: 0,
    dexscreener: 0,
    sol: 0,
    base: 0,
    bsc: 0,
    eth: 0,
    arb: 0,
  };
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    counts.total += 1;
    if (row.source === 'geckoterminal') counts.geckoterminal += 1;
    if (row.source === 'dexscreener') counts.dexscreener += 1;
    if (Object.prototype.hasOwnProperty.call(counts, row.chain)) counts[row.chain] += 1;
  });
  return counts;
}

const api = {
  MAX_DEX,
  LISTED_MIN_VOLUME,
  DEX_MIN_VOLUME,
  DEX_MIN_RESERVE,
  ARCHIVE_QUIET_MS,
  ARCHIVE_MAX,
  HTML_DEX_PREVIEW,
  chainInfo,
  isDexRow,
  dexId,
  normalizeGtPool,
  normalizeGtPayload,
  normalizeDexListItem,
  normalizeDexList,
  applyDexPair,
  dedupeRows,
  listedVolumeOk,
  meetsDexFloor,
  acceptDexRow,
  judgeListedPage,
  slimListedCoin,
  finalizeDexList,
  mergeArchive,
  mergeUniverse,
  summarize,
  canonicalAddress,
  validAddress,
};

if (typeof module === 'object' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.CipherUniverse = api;
