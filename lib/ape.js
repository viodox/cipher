'use strict';

const { fetchJson } = require('./http-util');
const { kvConfig } = require('./alerts-ready');
const { proxyCoinGeckoJson } = require('./coingecko');
const { normalizeChain, chainFromDex, canonicalAddress, validAddress } = require('./chains');
const { gradeFacts } = require('./grade');

const REPORT_TTL_SEC = 6 * 60 * 60;
const META_TTL_SEC = 48 * 60 * 60;
const DAY_TTL_SEC = 3 * 24 * 60 * 60;
const FETCH_MS = 4000;

const CG_PLATFORM = {
  eth: 'ethereum',
  bsc: 'binance-smart-chain',
  base: 'base',
  arb: 'arbitrum-one',
  sol: 'solana',
};

const BURN = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
]);

const EXCHANGES = [
  ['COINBASE', /coinbase/i],
  ['BINANCE.US', /binance/i],
  ['KRAKEN', /kraken/i],
  ['CRYPTO.COM', /crypto\.com/i],
  ['ROBINHOOD', /robinhood/i],
];

const memory = {
  reports: new Map(),
  meta: new Map(),
  days: new Map(),
  recent: [],
};

function resetApeMemory() {
  memory.reports.clear();
  memory.meta.clear();
  memory.days.clear();
  memory.recent = [];
}

function useRedis() {
  if (process.env.APE_STORE === 'memory') return false;
  return Boolean(kvConfig());
}

function asNum(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function triFlag(value) {
  if (value == null || value === '') return null;
  if (value === '0' || value === 0 || value === false) return false;
  if (value === '1' || value === 1 || value === true) return true;
  return null;
}

function taxPercent(value) {
  const n = asNum(value);
  if (n == null || n < 0) return null;
  if (n <= 1) return Math.round(n * 1000) / 10;
  return Math.round(n * 10) / 10;
}

function shareOf(value) {
  const n = asNum(value);
  if (n == null || n < 0) return null;
  return n <= 1 ? n : n / 100;
}

function dayStamp(ms) {
  const date = new Date(ms == null ? Date.now() : ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return '' + y + m + d;
}

function memberOf(chain, address) {
  return chain + ':' + address;
}

function busyResult(res) {
  if (!res) return false;
  if (res.status === 429 || res.status === 402) return true;
  const blob = res.json && (res.json.message || res.json.msg || res.json.error || '');
  return /rate|too many|limit/i.test(String(blob));
}

function goplusToken(json, address) {
  const map = json && json.result;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  if (map[address]) return map[address];
  const lower = String(address).toLowerCase();
  const key = Object.keys(map).find((item) => item.toLowerCase() === lower);
  return key ? map[key] : null;
}

function pairsFor(json, chain) {
  const pairs = json && Array.isArray(json.pairs) ? json.pairs : [];
  return pairs.filter((pair) => {
    const found = chainFromDex(pair && pair.chainId);
    return found && found.slug === chain.slug;
  });
}

function lpMajorityLocked(holders) {
  if (!Array.isArray(holders) || !holders.length) return null;
  let locked = 0;
  let total = 0;
  let any = false;
  holders.forEach((row) => {
    const share = shareOf(row && row.percent);
    if (share == null) return;
    any = true;
    total += share;
    const addr = String((row && row.address) || '').toLowerCase();
    const lockedFlag = triFlag(row && row.is_locked) === true || BURN.has(addr);
    if (lockedFlag) locked += share;
  });
  if (!any || total <= 0) return null;
  return locked / total >= 0.5;
}

function top10Pct(holders) {
  if (!Array.isArray(holders) || !holders.length) return null;
  let total = 0;
  let any = false;
  holders.slice(0, 10).forEach((row) => {
    const share = shareOf(row && row.percent);
    if (share == null) return;
    any = true;
    total += share;
  });
  if (!any) return null;
  return Math.round(total * 1000) / 10;
}

function bestPair(pairs) {
  let best = null;
  let bestLiq = -1;
  pairs.forEach((pair) => {
    const liq = asNum(pair && pair.liquidity && pair.liquidity.usd);
    const score = liq == null ? 0 : liq;
    if (score >= bestLiq) {
      best = pair;
      bestLiq = score;
    }
  });
  return best;
}

function factsFromFeeds(chain, goplus, dexJson, now) {
  const token = goplus || {};
  const sol = chain.kind === 'sol';
  const pairs = pairsFor(dexJson, chain);
  const best = bestPair(pairs);
  const sources = [];
  if (goplus) sources.push('GoPlus');
  if (pairs.length) sources.push('DexScreener');

  let honeypot = null;
  if (sol) honeypot = triFlag(token.non_transferable);
  else {
    const flagged = triFlag(token.is_honeypot);
    const cannot = triFlag(token.cannot_sell_all);
    if (flagged === true || cannot === true) honeypot = true;
    else if (flagged === false || cannot === false) honeypot = false;
  }

  let mintable = null;
  if (sol) mintable = token.mintable ? triFlag(token.mintable.status) : null;
  else mintable = triFlag(token.is_mintable);

  let ownerRenounced = null;
  if (!sol && token.owner_address != null) {
    const owner = String(token.owner_address);
    ownerRenounced = owner === '' || /^0x0{40}$/i.test(owner);
  }

  let buyTax = sol ? null : taxPercent(token.buy_tax);
  let sellTax = sol ? null : taxPercent(token.sell_tax);
  if (sol && token.transfer_fee) sellTax = taxPercent(token.transfer_fee.current_fee_rate);

  let liquidityUsd = null;
  if (Array.isArray(token.dex)) {
    token.dex.forEach((row) => {
      const n = asNum(row && row.liquidity);
      if (n == null) return;
      liquidityUsd = liquidityUsd == null ? n : Math.max(liquidityUsd, n);
    });
  }
  pairs.forEach((pair) => {
    const n = asNum(pair && pair.liquidity && pair.liquidity.usd);
    if (n == null) return;
    liquidityUsd = liquidityUsd == null ? n : Math.max(liquidityUsd, n);
  });

  let created = null;
  pairs.forEach((pair) => {
    const raw = asNum(pair && pair.pairCreatedAt);
    if (raw == null) return;
    const ms = raw < 1e12 ? raw * 1000 : raw;
    if (created == null || ms < created) created = ms;
  });
  const ageHours = created == null ? null : ((now || Date.now()) - created) / 3600000;
  const change24h = best && best.priceChange ? asNum(best.priceChange.h24) : null;
  const priceUsd = best ? asNum(best.priceUsd) : null;
  const meta = token.metadata || {};
  const base = (best && best.baseToken) || {};
  const symbol = String(base.symbol || token.token_symbol || meta.symbol || '').replace(/^\$/, '').slice(0, 16);
  const name = String(base.name || token.token_name || meta.name || '').slice(0, 80);
  const logo = (best && best.info && best.info.imageUrl) || '';

  return {
    sources,
    symbol,
    name,
    priceUsd,
    logo,
    facts: {
      honeypot,
      mintable,
      ownerRenounced,
      buyTax,
      sellTax,
      liquidityUsd,
      lpLockedOrBurned: lpMajorityLocked(token.lp_holders),
      top10Pct: top10Pct(token.holders),
      ageHours,
      change24h,
    },
  };
}

function matchExchanges(tickers) {
  const names = [];
  (Array.isArray(tickers) ? tickers : []).forEach((row) => {
    const market = row && row.market ? (row.market.name || row.market.identifier || '') : '';
    EXCHANGES.forEach(([label, pattern]) => {
      if (pattern.test(String(market)) && names.indexOf(label) === -1) names.push(label);
    });
  });
  return names;
}

function publicLogo(url) {
  const value = String(url || '');
  if (/^https:\/\/([a-z0-9-]+\.)*coingecko\.com\//i.test(value)) return value;
  if (/^https:\/\/cdn\.dexscreener\.com\//i.test(value)) return value;
  return '';
}

async function redisPipeline(commands) {
  const cfg = kvConfig();
  if (!cfg) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(cfg.url.replace(/\/$/, '') + '/pipeline', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        authorization: 'Bearer ' + cfg.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json)) return null;
    return json.map((row) => (row && Object.prototype.hasOwnProperty.call(row, 'result') ? row.result : null));
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function compactOf(report) {
  return {
    chain: report.chain,
    chainName: report.chainName,
    address: report.address,
    symbol: report.symbol,
    name: report.name,
    letter: report.letter,
    score: report.score,
  };
}

function rememberLocal(report) {
  const member = memberOf(report.chain, report.address);
  const compact = compactOf(report);
  memory.reports.set(member, { value: report, exp: Date.now() + REPORT_TTL_SEC * 1000 });
  memory.meta.set(member, compact);
  const day = dayStamp();
  if (!memory.days.has(day)) memory.days.set(day, new Map());
  memory.days.get(day).set(member, report.score);
  memory.recent = [compact].concat(memory.recent.filter((row) => memberOf(row.chain, row.address) !== member)).slice(0, 40);
  return compact;
}

async function remember(report) {
  const compact = rememberLocal(report);
  if (!useRedis()) return;
  const member = memberOf(report.chain, report.address);
  const day = 'checks:day:' + dayStamp();
  await redisPipeline([
    ['SET', 'check:' + member, JSON.stringify(report), 'EX', String(REPORT_TTL_SEC)],
    ['SET', 'checkmeta:' + member, JSON.stringify(compact), 'EX', String(META_TTL_SEC)],
    ['ZADD', day, String(report.score), member],
    ['EXPIRE', day, String(DAY_TTL_SEC)],
    ['LPUSH', 'checks:recent', JSON.stringify(compact)],
    ['LTRIM', 'checks:recent', '0', '39'],
  ]);
}

async function touchBoard(report) {
  rememberLocal(Object.assign({}, report, { cached: true }));
  if (!useRedis()) return;
  const member = memberOf(report.chain, report.address);
  const day = 'checks:day:' + dayStamp();
  await redisPipeline([
    ['ZADD', day, String(report.score), member],
    ['EXPIRE', day, String(DAY_TTL_SEC)],
    ['LPUSH', 'checks:recent', JSON.stringify(compactOf(report))],
    ['LTRIM', 'checks:recent', '0', '39'],
  ]);
}

async function readCached(chain, address) {
  const member = memberOf(chain.slug, address);
  if (useRedis()) {
    const rows = await redisPipeline([['GET', 'check:' + member]]);
    const raw = rows && rows[0];
    if (raw) {
      try {
        const report = JSON.parse(raw);
        report.cached = true;
        return report;
      } catch (err) { /* fall through */ }
    }
  }
  const hit = memory.reports.get(member);
  if (!hit || Date.now() > hit.exp) return null;
  return Object.assign({}, hit.value, { cached: true });
}

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, status: 0, json: null, error: 'timeout' }), ms);
    Promise.resolve(promise).then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, () => {
      clearTimeout(timer);
      resolve({ ok: false, status: 0, json: null, error: 'timeout' });
    });
  });
}

async function fetchCoinGecko(chain, address) {
  const platform = CG_PLATFORM[chain.slug];
  if (!platform) return null;
  const result = await withTimeout(proxyCoinGeckoJson('coins/' + platform + '/contract/' + address, {
    localization: 'false',
    tickers: 'true',
    market_data: 'true',
    community_data: 'false',
    developer_data: 'false',
    sparkline: 'false',
  }), FETCH_MS);
  if (!result || !result.ok || !result.json) return null;
  return result.json;
}

function applyCoinGecko(parsed, coin) {
  if (!coin) return;
  parsed.sources.push('CoinGecko');
  if (coin.symbol) parsed.symbol = String(coin.symbol).toUpperCase().slice(0, 16);
  if (coin.name) parsed.name = String(coin.name).slice(0, 80);
  const image = coin.image && (coin.image.large || coin.image.small || coin.image.thumb);
  if (image) parsed.logo = image;
  const price = coin.market_data && coin.market_data.current_price && coin.market_data.current_price.usd;
  if (asNum(price) != null) parsed.priceUsd = asNum(price);
  const change = coin.market_data && coin.market_data.price_change_percentage_24h;
  if (parsed.facts.change24h == null && asNum(change) != null) parsed.facts.change24h = asNum(change);
  parsed.exchanges = matchExchanges(coin.tickers);
  parsed.coinId = coin.id || '';
}

async function loadFeeds(chain, address) {
  const goplusUrl = chain.kind === 'sol'
    ? 'https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=' + encodeURIComponent(address)
    : 'https://api.gopluslabs.io/api/v1/token_security/' + chain.goplus + '?contract_addresses=' + address;
  const dexUrl = 'https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(address);
  const [goplus, dex, coin] = await Promise.all([
    fetchJson(goplusUrl, FETCH_MS),
    fetchJson(dexUrl, FETCH_MS),
    fetchCoinGecko(chain, address),
  ]);
  return { goplus, dex, coin };
}

function assemble(chain, address, feeds) {
  if (busyResult(feeds.goplus) || busyResult(feeds.dex)) {
    return { ok: false, busy: true, status: 429, error: 'busy try again', chain: chain.slug, address };
  }
  const token = goplusToken(feeds.goplus && feeds.goplus.json, address);
  const parsed = factsFromFeeds(chain, token, feeds.dex && feeds.dex.json, Date.now());
  applyCoinGecko(parsed, feeds.coin);
  if (!parsed.sources.length) {
    return {
      ok: false,
      status: 502,
      error: 'scanners are unavailable — try again in a minute',
      chain: chain.slug,
      address,
    };
  }
  const graded = gradeFacts(parsed.facts, chain.slug + '|' + address);
  const symbol = parsed.symbol
    ? parsed.symbol.toUpperCase()
    : (address.slice(0, 4) + '…' + address.slice(-4));
  return {
    ok: true,
    status: 200,
    cached: false,
    chain: chain.slug,
    chainName: chain.name,
    address,
    symbol,
    name: parsed.name || 'Unknown token',
    priceUsd: parsed.priceUsd,
    logo: publicLogo(parsed.logo),
    coinId: parsed.coinId || '',
    score: graded.score,
    letter: graded.letter,
    autoF: graded.autoF,
    checks: graded.checks,
    verdicts: graded.verdicts,
    exchanges: parsed.exchanges || [],
    liquidityUsd: parsed.facts.liquidityUsd,
    buyTax: parsed.facts.buyTax,
    sellTax: parsed.facts.sellTax,
    top10Pct: parsed.facts.top10Pct,
    ageHours: parsed.facts.ageHours,
    change24h: parsed.facts.change24h,
    sources: parsed.sources,
    updatedAt: new Date().toISOString(),
  };
}

async function checkToken(chainInput, addressInput) {
  const chain = normalizeChain(chainInput);
  if (!chain) return { ok: false, status: 400, error: 'unsupported chain' };
  const address = canonicalAddress(chain, addressInput);
  if (!validAddress(chain, address)) return { ok: false, status: 400, error: 'invalid address', chain: chain.slug };

  const cached = await readCached(chain, address);
  if (cached) {
    cached.logo = publicLogo(cached.logo);
    await touchBoard(cached);
    return cached;
  }

  const report = assemble(chain, address, await loadFeeds(chain, address));
  if (report.ok) await remember(report);
  return report;
}

function parseCompact(raw) {
  if (!raw) return null;
  try {
    const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!row || !row.chain || !row.address || !row.letter) return null;
    return row;
  } catch (err) {
    return null;
  }
}

async function listRecent() {
  let rows = [];
  if (useRedis()) {
    const result = await redisPipeline([['LRANGE', 'checks:recent', '0', '24']]);
    const list = result && Array.isArray(result[0]) ? result[0] : [];
    rows = list.map(parseCompact).filter(Boolean);
  }
  if (!rows.length) rows = memory.recent.slice();
  const seen = new Set();
  return rows.filter((row) => {
    const id = memberOf(row.chain, row.address);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 12);
}

function takeScores(flat) {
  const out = [];
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i < flat.length; i += 2) {
    const member = flat[i];
    const score = Number(flat[i + 1]);
    if (typeof member === 'string' && Number.isFinite(score)) out.push({ member, score });
  }
  return out;
}

async function loadBoard() {
  const today = dayStamp();
  const yesterday = dayStamp(Date.now() - 86400000);
  const map = new Map();

  function put(member, score, compact) {
    if (map.has(member)) return;
    const row = compact || memory.meta.get(member) || {};
    map.set(member, {
      chain: row.chain || member.split(':')[0],
      chainName: row.chainName || '',
      address: row.address || member.slice(member.indexOf(':') + 1),
      symbol: row.symbol || '???',
      name: row.name || '',
      letter: row.letter || '',
      score,
    });
  }

  if (useRedis()) {
    const z = await redisPipeline([
      ['ZRANGE', 'checks:day:' + today, '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', '0', '80', 'WITHSCORES'],
      ['ZRANGE', 'checks:day:' + yesterday, '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', '0', '80', 'WITHSCORES'],
    ]);
    const ranked = takeScores(z && z[0]).concat(takeScores(z && z[1]));
    const missing = ranked.filter((row) => !map.has(row.member));
    const metas = missing.length
      ? await redisPipeline(missing.map((row) => ['GET', 'checkmeta:' + row.member]))
      : [];
    missing.forEach((row, index) => put(row.member, row.score, parseCompact(metas && metas[index])));
  }

  [today, yesterday].forEach((day) => {
    const board = memory.days.get(day);
    if (!board) return;
    board.forEach((score, member) => put(member, score, memory.meta.get(member)));
  });

  return [...map.values()];
}

async function loadRasterLogo(url) {
  const value = publicLogo(url);
  if (!value || /\.webp(\?|$)/i.test(value) || /format=auto/i.test(value)) return '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch(value, { signal: ctrl.signal });
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 32 || buf.length > 800000) return '';
    const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const jpg = buf[0] === 0xff && buf[1] === 0xd8;
    if (!png && !jpg) return '';
    return 'data:' + (png ? 'image/png' : 'image/jpeg') + ';base64,' + buf.toString('base64');
  } catch (err) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  factsFromFeeds,
  checkToken,
  listRecent,
  loadBoard,
  loadRasterLogo,
  resetApeMemory,
  matchExchanges,
  publicLogo,
  dayStamp,
};
