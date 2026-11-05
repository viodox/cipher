'use strict';

const { esc } = require('./http-util');
const { copyAddressHtml } = require('./copy-address');
const { advertiseCalloutHtml } = require('./sponsor');
const { WALLETS, IGNORE_SYMBOLS, IGNORE_MINTS } = require('./wallets');
const { cacheGet, cacheSet } = require('./store');
const { shell, buyButtonsHtml, SITE } = require('./chrome');
const { alertsReady } = require('./alerts-ready');
const { checkToken } = require('./ape');
const { fmtMoney } = require('./format');
const { postHref } = require('./share');

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_MS = 8 * 60 * 1000;
const CACHE_KEY = 'cipher:smart-money:v2';
const MIN_USD = 200;
const SWAP_SELECTORS = new Set([
  '0x38ed1739', '0x8803dbee', '0x7ff36ab5', '0x18cbafe5', '0x5c11d795',
  '0x04e45aaf', '0x414bf389', '0xb858183f', '0x3593564c',
]);

const EXPLORERS = {
  eth: { tx: 'https://etherscan.io/tx/', address: 'https://etherscan.io/token/', name: 'Etherscan' },
  base: { tx: 'https://basescan.org/tx/', address: 'https://basescan.org/token/', name: 'Basescan' },
  bsc: { tx: 'https://bscscan.com/tx/', address: 'https://bscscan.com/token/', name: 'BscScan' },
  sol: { tx: 'https://solscan.io/tx/', address: 'https://solscan.io/token/', name: 'Solscan' },
};

const memory = { at: 0, value: null };

function resetSmartMoneyMemory() {
  memory.at = 0;
  memory.value = null;
}

function gradeClass(letter) {
  const head = String(letter || '').charAt(0).toLowerCase();
  if (head === 'a' || head === 'b' || head === 'c' || head === 'd') return 'grade-' + head;
  return 'grade-f';
}

function ago(ts, now) {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 60) return seconds + 's ago';
  if (seconds < 3600) return Math.round(seconds / 60) + 'm ago';
  return Math.round(seconds / 3600) + 'h ago';
}

function fmtAmount(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}

function amountOf(raw, decimals) {
  const value = Number(raw);
  const places = Number(decimals);
  if (!Number.isFinite(value) || value <= 0) return null;
  const div = 10 ** (Number.isFinite(places) && places >= 0 && places <= 24 ? places : 18);
  const amount = value / div;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function looksLikeSwap(name, method) {
  const blob = String(name || '') + ' ' + String(method || '');
  if (/pair|pool|router|swap|uniswap|pancake|sushi|aggregator|universal|1inch|odos|kyber|jupiter|raydium|curve/i.test(blob)) return true;
  const selector = String(method || '').trim().slice(0, 10).toLowerCase();
  return SWAP_SELECTORS.has(selector);
}

function tokenKey(address) {
  const value = String(address || '');
  if (value.slice(0, 2).toLowerCase() === '0x') return value.toLowerCase();
  return value;
}

function sideOf(side) {
  return side === 'swap' ? 'swap' : 'received';
}

function keepRow(row) {
  if (!row || !row.symbol || IGNORE_SYMBOLS.has(String(row.symbol).toUpperCase())) return false;
  if (row.usd != null && Number.isFinite(row.usd)) return row.usd >= MIN_USD;
  return row.side === 'swap';
}

function parseBlockscoutV2(items, walletAddress, now, chain) {
  const wallet = String(walletAddress || '').toLowerCase();
  const rows = [];
  (items || []).forEach((item) => {
    const ts = Date.parse(item && item.timestamp);
    if (!Number.isFinite(ts) || now - ts > DAY_MS || ts > now + 120000) return;
    const to = String((item.to && item.to.hash) || '').toLowerCase();
    const from = String((item.from && item.from.hash) || '').toLowerCase();
    if (!to || to !== wallet || !from || from === wallet) return;
    const token = item.token || {};
    const symbol = String(token.symbol || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 16).toUpperCase();
    const address = String(token.address_hash || '').toLowerCase();
    if (!symbol || IGNORE_SYMBOLS.has(symbol) || !/^0x[a-f0-9]{40}$/.test(address)) return;
    const decimals = token.decimals != null ? token.decimals : (item.total && item.total.decimals);
    const amount = amountOf(item.total && item.total.value, decimals);
    const rate = Number(token.exchange_rate);
    const usd = amount != null && Number.isFinite(rate) && rate > 0 ? amount * rate : null;
    const fromName = (item.from && item.from.name) || '';
    const side = looksLikeSwap(fromName, item.method) ? 'swap' : 'in';
    rows.push({
      chain,
      tokenAddress: address,
      symbol,
      name: String(token.name || symbol).slice(0, 64),
      amount,
      usd,
      side,
      ts,
      tx: String(item.transaction_hash || ''),
    });
  });
  return rows;
}

function parseEtherscanTokentx(items, walletAddress, now, chain) {
  const wallet = String(walletAddress || '').toLowerCase();
  const rows = [];
  const list = Array.isArray(items) ? items : [];
  list.forEach((item) => {
    const ts = Number(item && item.timeStamp) * 1000;
    if (!Number.isFinite(ts) || now - ts > DAY_MS || ts > now + 120000) return;
    const to = String(item.to || '').toLowerCase();
    const from = String(item.from || '').toLowerCase();
    if (!to || to !== wallet || !from || from === wallet) return;
    const symbol = String(item.tokenSymbol || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 16).toUpperCase();
    const address = String(item.contractAddress || '').toLowerCase();
    if (!symbol || IGNORE_SYMBOLS.has(symbol) || !/^0x[a-f0-9]{40}$/.test(address)) return;
    const amount = amountOf(item.value, item.tokenDecimal);
    const side = looksLikeSwap(item.functionName || '', item.input || '') ? 'swap' : 'in';
    rows.push({
      chain,
      tokenAddress: address,
      symbol,
      name: String(item.tokenName || symbol).slice(0, 64),
      amount,
      usd: null,
      side,
      ts,
      tx: String(item.hash || ''),
    });
  });
  return rows;
}

function parseSolanaTransaction(tx, wallet, now) {
  if (!tx || !tx.meta || tx.meta.err) return [];
  const ts = Number(tx.blockTime) * 1000;
  if (!Number.isFinite(ts) || now - ts > DAY_MS) return [];
  const keys = (tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys) || [];
  let signer = false;
  keys.forEach((key) => {
    const pub = typeof key === 'string' ? key : key && key.pubkey;
    const isSigner = typeof key === 'string' ? true : Boolean(key && key.signer);
    if (pub === wallet && isSigner) signer = true;
  });
  if (!signer) return [];
  const pre = new Map();
  (tx.meta.preTokenBalances || []).forEach((row) => {
    if (!row || row.owner !== wallet) return;
    pre.set(row.mint, Number(row.uiTokenAmount && row.uiTokenAmount.uiAmount) || 0);
  });
  const signature = (tx.transaction && tx.transaction.signatures && tx.transaction.signatures[0]) || tx.signature || '';
  const out = [];
  (tx.meta.postTokenBalances || []).forEach((row) => {
    if (!row || row.owner !== wallet || !row.mint || IGNORE_MINTS.has(row.mint)) return;
    const after = Number(row.uiTokenAmount && row.uiTokenAmount.uiAmount) || 0;
    const delta = after - (pre.get(row.mint) || 0);
    if (!(delta > 0)) return;
    out.push({
      chain: 'sol',
      tokenAddress: row.mint,
      symbol: '',
      name: '',
      amount: delta,
      usd: null,
      side: 'swap',
      ts,
      tx: signature,
    });
  });
  return out;
}

function parseHeliusSwaps(items, wallet, now) {
  const rows = [];
  (items || []).forEach((item) => {
    const ts = Number(item && item.timestamp) * 1000;
    if (!Number.isFinite(ts) || now - ts > DAY_MS) return;
    (item.tokenTransfers || []).forEach((transfer) => {
      if (!transfer || transfer.toUserAccount !== wallet) return;
      const mint = String(transfer.mint || '');
      if (!mint || IGNORE_MINTS.has(mint)) return;
      const amount = Number(transfer.tokenAmount);
      if (!(amount > 0)) return;
      rows.push({
        chain: 'sol',
        tokenAddress: mint,
        symbol: '',
        name: '',
        amount,
        usd: null,
        side: 'swap',
        ts,
        tx: String(item.signature || ''),
      });
    });
  });
  return rows;
}

function applyDexMeta(rows, pairs) {
  const byToken = new Map();
  (pairs || []).forEach((pair) => {
    const base = pair && pair.baseToken;
    if (!base || !base.address) return;
    const key = tokenKey(base.address);
    const prev = byToken.get(key);
    const liq = Number(pair.liquidity && pair.liquidity.usd) || 0;
    if (!prev || liq > prev.liq) {
      byToken.set(key, {
        liq,
        symbol: base.symbol,
        name: base.name,
        price: Number(pair.priceUsd),
      });
    }
  });
  rows.forEach((row) => {
    const meta = byToken.get(tokenKey(row.tokenAddress));
    if (!meta) return;
    if (!row.symbol && meta.symbol) row.symbol = String(meta.symbol).slice(0, 16).toUpperCase();
    if (!row.name && meta.name) row.name = String(meta.name).slice(0, 64);
    if ((row.usd == null || !Number.isFinite(Number(row.usd))) && row.amount != null && Number.isFinite(meta.price) && meta.price > 0) {
      row.usd = row.amount * meta.price;
    }
  });
  return rows;
}

async function fetchJson(url, fetchImpl, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 5000);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (compatible; CipherSignal/1.0; +https://www.ciphersignal.xyz)',
      },
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (err) { json = null; }
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    return { ok: false, status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

async function rpc(url, method, params, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json = await res.json();
    return json && json.result != null ? json.result : null;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function solRpcUrls() {
  const urls = [];
  if (process.env.HELIUS_API_KEY) urls.push('https://mainnet.helius-rpc.com/?api-key=' + process.env.HELIUS_API_KEY);
  if (process.env.SOLANA_RPC_URL) urls.push(process.env.SOLANA_RPC_URL);
  urls.push('https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com');
  return urls;
}

async function loadSolanaRows(address, fetchImpl, now) {
  if (process.env.HELIUS_API_KEY) {
    const url = 'https://api.helius.xyz/v0/addresses/' + address + '/transactions?api-key=' + encodeURIComponent(process.env.HELIUS_API_KEY) + '&type=SWAP&limit=12';
    const hit = await fetchJson(url, fetchImpl, 6000);
    if (hit.ok && Array.isArray(hit.json)) return parseHeliusSwaps(hit.json, address, now);
  }
  let signatures = null;
  let rpcUrl = solRpcUrls()[0];
  for (const url of solRpcUrls()) {
    signatures = await rpc(url, 'getSignaturesForAddress', [address, { limit: 8 }], fetchImpl);
    if (Array.isArray(signatures)) {
      rpcUrl = url;
      break;
    }
  }
  if (!Array.isArray(signatures)) return [];
  const recent = signatures.filter((row) => row && row.blockTime && (now / 1000 - row.blockTime) < 86400 && !row.err).slice(0, 4);
  const txs = await Promise.all(recent.map((row) => rpc(rpcUrl, 'getTransaction', [row.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }], fetchImpl)));
  const rows = [];
  txs.forEach((tx, index) => {
    if (!tx) return;
    tx.signature = recent[index].signature;
    parseSolanaTransaction(tx, address, now).forEach((row) => rows.push(row));
  });
  return rows;
}

async function loadEvmRows(chain, address, fetchImpl, now) {
  if (chain === 'eth') {
    const url = 'https://eth.blockscout.com/api/v2/addresses/' + address + '/token-transfers?type=ERC-20&filter=to';
    const hit = await fetchJson(url, fetchImpl, 6000);
    const items = hit.json && (hit.json.items || hit.json.result);
    if (hit.ok && Array.isArray(items)) return parseBlockscoutV2(items, address, now, chain);
  }
  const host = chain === 'base' ? 'https://base.blockscout.com' : chain === 'bsc' ? 'https://bsc.blockscout.com' : '';
  if (!host) return [];
  const url = host + '/api?module=account&action=tokentx&address=' + address + '&page=1&offset=40&sort=desc';
  const hit = await fetchJson(url, fetchImpl, 6000);
  const items = hit.json && hit.json.result;
  if (hit.ok && Array.isArray(items)) return parseEtherscanTokentx(items, address, now, chain);
  return [];
}

async function enrichUnknown(rows, fetchImpl) {
  const byChain = new Map();
  rows.forEach((row) => {
    const priced = row.usd != null && Number.isFinite(Number(row.usd));
    if (row.symbol && priced) return;
    if (!byChain.has(row.chain)) byChain.set(row.chain, []);
    const list = byChain.get(row.chain);
    if (!list.includes(row.tokenAddress)) list.push(row.tokenAddress);
  });
  const dexChain = { eth: 'ethereum', base: 'base', bsc: 'bsc', sol: 'solana' };
  const jobs = [];
  byChain.forEach((addresses, chain) => {
    const slug = dexChain[chain];
    if (!slug) return;
    for (let i = 0; i < addresses.length; i += 30) {
      const chunk = addresses.slice(i, i + 30);
      jobs.push((async () => {
        const url = 'https://api.dexscreener.com/tokens/v1/' + slug + '/' + chunk.join(',');
        const hit = await fetchJson(url, fetchImpl, 5000);
        const pairs = Array.isArray(hit.json) ? hit.json : (hit.json && hit.json.pairs) || [];
        applyDexMeta(rows.filter((row) => row.chain === chain), pairs);
      })());
    }
  });
  await Promise.all(jobs);
  return rows;
}

async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try { out[index] = await worker(items[index], index); }
      catch (err) { out[index] = []; }
    }
  }
  const runners = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) runners.push(run());
  await Promise.all(runners);
  return out;
}

async function buildFeed(opts) {
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || Date.now();
  const wallets = opts.wallets || WALLETS;
  const targets = [];
  wallets.forEach((wallet) => {
    (wallet.chains || []).forEach((entry) => {
      targets.push({ wallet, chain: entry.chain, address: entry.address });
    });
  });
  const groups = await mapPool(targets, 4, async (target) => {
    const rows = target.chain === 'sol'
      ? await loadSolanaRows(target.address, fetchImpl, now)
      : await loadEvmRows(target.chain, target.address, fetchImpl, now);
    return rows.map((row) => Object.assign({}, row, {
      walletId: target.wallet.id,
      walletName: target.wallet.name,
      walletKind: target.wallet.kind,
    }));
  });
  let rows = groups.flat().filter(Boolean);
  await enrichUnknown(rows, fetchImpl);
  rows = rows.filter(keepRow);
  const seen = new Set();
  rows = rows.filter((row) => {
    const token = tokenKey(row.tokenAddress);
    const txKey = row.tx ? [row.walletId, row.tx, token].join(':') : '';
    if (txKey && seen.has(txKey)) return false;
    const id = [row.walletId, row.chain, token, row.tx, row.side].join(':');
    if (seen.has(id)) return false;
    if (txKey) seen.add(txKey);
    seen.add(id);
    return true;
  });
  rows.sort((a, b) => b.ts - a.ts);
  const capped = [];
  const perWallet = new Map();
  rows.forEach((row) => {
    const count = perWallet.get(row.walletId) || 0;
    if (count >= 6) return;
    perWallet.set(row.walletId, count + 1);
    capped.push(row);
  });
  return capped.slice(0, 36);
}

function gradeApplies(row, report) {
  if (!row || !report || !report.ok || !report.letter) return false;
  if (report.chain && report.chain !== row.chain) return false;
  const reported = String(report.address || '');
  if (!reported) return false;
  if (row.chain === 'sol') {
    if (reported !== String(row.tokenAddress || '')) return false;
  } else if (reported.toLowerCase() !== String(row.tokenAddress || '').toLowerCase()) {
    return false;
  }
  if (row.symbol && report.symbol && String(row.symbol).toUpperCase() !== String(report.symbol).toUpperCase()) return false;
  return true;
}

async function attachGrades(rows, grade, limit) {
  const fn = grade || checkToken;
  const pending = [];
  const seen = new Set();
  rows.forEach((row) => {
    if (!row || row.letter) return;
    if (!['eth', 'bsc', 'base', 'sol'].includes(row.chain)) return;
    const id = row.chain + ':' + tokenKey(row.tokenAddress);
    if (seen.has(id)) return;
    seen.add(id);
    pending.push(row);
  });
  const batch = pending.slice(0, limit);
  await Promise.all(batch.map(async (row) => {
    try {
      const report = await Promise.race([
        fn(row.chain, row.tokenAddress),
        new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
      ]);
      if (!gradeApplies(row, report)) return;
      const id = row.chain + ':' + tokenKey(row.tokenAddress);
      rows.forEach((other) => {
        if (other.chain + ':' + tokenKey(other.tokenAddress) !== id) return;
        if (!gradeApplies(other, report)) return;
        other.letter = report.letter;
        other.score = report.score;
        if (!other.symbol && report.symbol) other.symbol = report.symbol;
        if (!other.name && report.name) other.name = report.name;
      });
    } catch (err) { /* grade is optional */ }
  }));
  return rows;
}

function publicFeed(rows, now, note) {
  return {
    ok: true,
    updatedAt: new Date(now).toISOString(),
    note: note || '',
    wallets: WALLETS.map((wallet) => ({
      id: wallet.id,
      name: wallet.name,
      kind: wallet.kind,
      why: wallet.why,
      chains: wallet.chains.map((entry) => entry.chain),
    })),
    buys: rows.map((row) => ({
      walletId: row.walletId,
      walletName: row.walletName,
      walletKind: row.walletKind,
      chain: row.chain,
      tokenAddress: row.tokenAddress,
      symbol: row.symbol,
      name: row.name,
      amount: row.amount,
      usd: row.usd,
      side: row.side,
      ts: row.ts,
      tx: row.tx,
      letter: row.letter || '',
      score: row.score == null ? null : row.score,
      ago: ago(row.ts, now),
      checkHref: '/check/' + row.chain + '/' + row.tokenAddress,
    })),
  };
  payload.rows = payload.buys;
  return payload;
}

function freshenFeed(payload, now) {
  if (!payload) return payload;
  const rows = payload.rows || payload.buys;
  if (!Array.isArray(rows)) return payload;
  const clock = now || Date.now();
  rows.forEach((row) => {
    if (row && Number.isFinite(Number(row.ts))) row.ago = ago(Number(row.ts), clock);
  });
  payload.buys = rows;
  payload.rows = rows;
  return payload;
}

function summarizeFeed(feed) {
  const rows = (feed && (feed.rows || feed.buys)) || [];
  const wallets = (feed && feed.wallets) || [];
  let swaps = 0;
  let received = 0;
  let priced = 0;
  let unpriced = 0;
  let usd = 0;
  const byWallet = new Map();
  const kinds = { notable: 0, desk: 0, trader: 0 };
  rows.forEach((row) => {
    const side = sideOf(row && row.side);
    if (side === 'swap') swaps += 1;
    else received += 1;
    const kind = row && row.walletKind;
    if (kinds[kind] != null) kinds[kind] += 1;
    const value = row && row.usd != null ? Number(row.usd) : NaN;
    if (Number.isFinite(value)) {
      priced += 1;
      usd += value;
    } else unpriced += 1;
    const id = (row && row.walletId) || (row && row.walletName) || 'unknown';
    if (!byWallet.has(id)) {
      byWallet.set(id, {
        id,
        name: (row && row.walletName) || id,
        kind: (row && row.walletKind) || '',
        rows: 0,
        swaps: 0,
        received: 0,
        usd: 0,
      });
    }
    const bucket = byWallet.get(id);
    bucket.rows += 1;
    if (side === 'swap') bucket.swaps += 1;
    else bucket.received += 1;
    if (Number.isFinite(value)) bucket.usd += value;
  });
  const active = [];
  const quiet = [];
  const seen = new Set();
  wallets.forEach((wallet) => {
    const hit = byWallet.get(wallet.id) || byWallet.get(wallet.name);
    if (hit) seen.add(hit.id);
    seen.add(wallet.id);
    const card = {
      id: wallet.id,
      name: wallet.name,
      kind: wallet.kind || '',
      why: wallet.why || '',
      chains: wallet.chains || [],
      rows: hit ? hit.rows : 0,
      swaps: hit ? hit.swaps : 0,
      received: hit ? hit.received : 0,
      usd: hit ? hit.usd : 0,
      active: Boolean(hit && hit.rows),
    };
    if (card.active) active.push(card);
    else quiet.push(card);
  });
  byWallet.forEach((bucket, id) => {
    if (seen.has(id)) return;
    active.push(Object.assign({ why: '', chains: [], active: true }, bucket));
  });
  return {
    rows: rows.length,
    swaps,
    received,
    priced,
    unpriced,
    usd,
    kinds,
    active,
    quiet,
    walletCount: active.length + quiet.length,
  };
}

async function loadSmartMoney(opts) {
  const options = opts || {};
  const now = options.now || Date.now();
  if (!options.force && memory.value && (now - memory.at) < FRESH_MS) return freshenFeed(memory.value, now);
  if (!options.force && !options.fetchImpl) {
    const saved = await cacheGet(CACHE_KEY);
    if (saved && saved.buys && (now - Date.parse(saved.updatedAt || 0)) < FRESH_MS) {
      memory.at = now;
      memory.value = saved;
      return freshenFeed(saved, now);
    }
    if (options.refresh === false) return freshenFeed(saved || publicFeed([], now, 'cached'), now);
  }
  let rows = [];
  let note = '';
  try {
    rows = await Promise.race([
      buildFeed(options),
      new Promise((resolve) => setTimeout(() => resolve(null), options.budgetMs || 8000)),
    ]);
    if (!rows) {
      note = 'The public explorers were slow. Showing the last saved window.';
      rows = [];
    }
  } catch (err) {
    note = 'The public explorers did not answer. Showing the last saved window.';
    rows = [];
  }
  if (rows && rows.length && options.fill !== 0) {
    await attachGrades(rows, options.grade, options.fill == null ? 3 : options.fill);
  }
  if (rows && rows.length) {
    const payload = publicFeed(rows, now, note);
    memory.at = now;
    memory.value = payload;
    if (!options.fetchImpl) await cacheSet(CACHE_KEY, payload, 2 * 60 * 60);
    return freshenFeed(payload, now);
  }
  const saved = memory.value || (!options.fetchImpl ? await cacheGet(CACHE_KEY) : null);
  if (saved && saved.buys) {
    saved.note = note || saved.note || '';
    return freshenFeed(saved, now);
  }
  return freshenFeed(publicFeed([], now, note || 'No tracked inflows cleared the filter in the last 24 hours.'), now);
}

const KIND_GLOSS = {
  notable: 'public name, not a trade call',
  desk: 'market-maker flow, not a buy signal',
  trader: 'public trader wallet, not their advice',
};

function feedCss() {
  return `<style>
.sm-live{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 14px;margin-bottom:.55rem}
.sm-summary{font-family:Orbitron,monospace;font-size:15px;letter-spacing:.03em;color:var(--text);line-height:1.45;margin:0}
.sm-mix,.sm-warn{color:var(--secondary);font-size:16px;line-height:1.55;margin:.35rem 0}
.sm-warn{border-left:3px solid var(--warn);padding:.45rem .75rem;background:var(--surface);color:var(--text)}
.sm-grid{display:grid;grid-template-columns:1fr 300px;gap:12px;align-items:start}
.wallet-card{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:8px}
.wallet-card.active{border-color:var(--accent)}
.wallet-card b{font-family:Orbitron,monospace;font-size:13px;letter-spacing:.06em;color:var(--text)}
.wallet-card p{margin:.35rem 0 0;color:var(--secondary);font-size:15px;line-height:1.5}
.wallet-status{font-family:Orbitron,monospace;font-size:12px;letter-spacing:.03em;color:var(--text)!important}
.kind{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--secondary)}
.quiet-wallets{margin-top:.35rem}
.quiet-wallets summary{cursor:pointer;color:var(--text);margin-bottom:.45rem}
.feed-row{display:grid;grid-template-columns:92px 1fr auto;gap:10px;align-items:center;padding:12px 4px;border-bottom:1px solid var(--border)}
.feed-row time{color:var(--secondary);font-size:14px}
.side{display:inline-block;font-family:Orbitron,monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;border-radius:3px;padding:2px 6px;margin-right:6px}
.side.swap{color:var(--on-accent);background:var(--accent)}
.side.in{color:var(--ink);border:1px solid var(--border2)}
.token-name{font-family:Orbitron,monospace;font-size:16px;color:var(--text);letter-spacing:.04em}
.token-sub{display:block;color:var(--secondary);font-size:15px;margin-top:2px}
.grade-pill{font-family:Orbitron,monospace;font-weight:700;font-size:18px;text-decoration:none;min-width:42px;text-align:right}
.row-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.row-actions a{font-size:15px}
.empty-feed{padding:1.2rem;border:1px dashed var(--border2);border-radius:8px;color:var(--secondary);line-height:1.6}
.faq details{border-top:1px solid var(--border);padding:.75rem 0}
.faq summary{cursor:pointer;color:var(--text);font-family:Orbitron,monospace;font-size:14px;letter-spacing:.04em}
.faq p,.faq li{color:var(--secondary);font-size:16px;line-height:1.65}
.faq ul{margin:.4rem 0 0 1.1rem}
.legend{color:var(--secondary);font-size:15px;line-height:1.5;margin:0 0 .6rem}
@media(max-width:800px){.sm-grid{grid-template-columns:1fr}.feed-row{grid-template-columns:72px 1fr}.row-actions a{min-height:44px;display:inline-flex;align-items:center}}
@media (prefers-reduced-motion: reduce){.sm-live{scroll-behavior:auto}}
</style>`;
}

function walletStatus(wallet) {
  if (!wallet.active) return 'Quiet · no rows in the last 24 hours';
  const bits = ['Active', wallet.rows + ' row' + (wallet.rows === 1 ? '' : 's')];
  if (wallet.received) bits.push(wallet.received + ' received');
  if (wallet.swaps) bits.push(wallet.swaps + ' swap' + (wallet.swaps === 1 ? '' : 's'));
  if (wallet.usd) bits.push(fmtMoney(wallet.usd) + ' priced');
  return bits.join(' · ');
}

function walletCard(wallet) {
  const gloss = KIND_GLOSS[wallet.kind] || 'public wallet';
  const chains = (wallet.chains || []).join(' · ');
  const source = WALLETS.find((item) => item.id === wallet.id);
  const addresses = source && source.chains
    ? '<div class="row-actions">' + source.chains.map((entry) => (
      copyAddressHtml(entry.address, { label: 'Copy ' + String(entry.chain || 'wallet').toUpperCase() + ' wallet address' })
    )).join('') + '</div>'
    : '';
  return '<div class="wallet-card ' + (wallet.active ? 'active' : 'quiet') + '">' +
    '<div class="kind">' + esc(wallet.kind || 'wallet') + ' · ' + esc(gloss) + (chains ? ' · ' + esc(chains) : '') + '</div>' +
    '<b>' + esc(wallet.name) + '</b>' +
    '<p class="wallet-status">' + esc(walletStatus(wallet)) + '</p>' +
    (wallet.why ? '<p>' + esc(wallet.why) + '</p>' : '') +
    addresses +
    '</div>';
}

function faqHtml() {
  return '<section class="card faq" id="how-this-works"><h2>How this works</h2>' +
    '<p class="legend">The rows stay up top. This section is the full explanation.</p>' +
    '<details open><summary>What this page is, and what it is not</summary><p>Smart Money Watch lists tokens that arrived in a short set of public wallets during the last 24 hours. It is a window onto public chain data. It is not a buy list, not a signal from those people, and not financial advice. Nothing here is an offer to buy or sell.</p></details>' +
    '<details><summary>How the wallets were chosen</summary><p>Every address is already public: an ENS name, a Blockscout or Solscan public name tag, or a wallet named in press as belonging to a public trader. No private individuals. The list lives in the site code and does not scrape private labels.</p></details>' +
    '<details><summary>What notable, desk, and trader mean</summary><ul><li><b>Notable</b> — a public figure or a foundation. A transfer is not a trade recommendation.</li><li><b>Desk</b> — a market maker such as Jump Trading or Wintermute. They take in inventory, hedge, and move size all day. An inflow is desk flow.</li><li><b>Trader</b> — a wallet publicly tied to a known trader. Their on-chain activity is still not a message from them, and not advice.</li></ul></details>' +
    '<details open><summary>Swap versus received</summary><p><b>Swap</b> — the tokens came from a pool or router, or the transaction method was a swap. Example: a wallet signs a Jupiter or Uniswap swap and WIF shows up from the pool. The row says swap.</p><p><b>Received</b> — someone transferred tokens in. Example: a wallet sends ATH to Jump Trading with a plain transfer(). Jump received ATH. That can happen without Jump buying it on a DEX. Six received rows and zero swaps means every line was a transfer in. The counts use the same rows you see.</p></details>' +
    '<details><summary>How the dollar amounts are priced</summary><p>USD is token amount times a price. On Ethereum, that price is Blockscout’s exchange rate when it publishes one. If the row has no price yet, the page asks DexScreener for the deepest pool. The summary total adds only the rows that have a price, and it says how many were included. The total is the sum of the rows on screen. It is not a net position, not profit, and not “they bought this much.” A row with no price says price n/a. The same transfer is counted once, even if two explorers echo it.</p></details>' +
    '<details><summary>Why dust under $200 is hidden</summary><p>Once a price is known, rows under $200 are dropped so airdrop dust does not bury the window. Stablecoins and wrapped gas (USDC, USDT, WETH, WSOL, and the rest of that list) are hidden too, because they are not the flow this page is for. An unpriced transfer is also hidden. An unpriced swap is kept, and labeled price n/a, so a real trade is not deleted just because the price feed missed it.</p></details>' +
    '<details><summary>How the Ape Check letter gets on a row</summary><p>The letter is the Ape Check safety receipt for that contract on that chain. The same letter is copied only onto rows with the same chain and the same address. If the scanner’s symbol does not match the token on the row, the letter is left off instead of being stuck on the wrong name. A letter is not a recommendation and not a grade of the wallet. Ungraded rows say “check” and open Ape Check. Only a few contracts are graded each refresh so the free scanners are not hammered.</p></details>' +
    '<details><summary>How often this refreshes</summary><p>The server reuses a snapshot for about 8 minutes, and can keep the last good window for up to 2 hours if the public explorers time out. The “ago” clock is counted from the transfer time when the page is drawn, so it does not stay frozen at the moment the snapshot was saved. The UTC time is on the row if you hover or focus it. Refresh the page for a newer window.</p></details>' +
    '<details><summary>Solana and the optional Helius key</summary><p>Solana rows use Helius when the optional HELIUS_API_KEY is set on the server. Without it, the page uses a public Solana RPC and reads fewer transactions. Solana coverage can look empty on the free RPC. That is a thin feed, not proof that the wallet did nothing. No new key is required for the rest of the page.</p></details>' +
    '<details><summary>Not a signal from these people</summary><p>Vitalik, the Ethereum Foundation, Jump, Wintermute, and Ansem did not publish this board. CipherSignal reads public chain data and labels it. Do not trade because a row appeared. Not financial advice.</p></details>' +
    '</section>';
}

function renderSmartMoneyPage(data, opts) {
  const now = (opts && opts.now) || Date.now();
  const feed = data && data.buys ? data : {
    ok: true,
    buys: [],
    wallets: WALLETS.map((w) => ({ id: w.id, name: w.name, kind: w.kind, why: w.why, chains: w.chains.map((c) => c.chain) })),
    updatedAt: new Date(now).toISOString(),
    note: '',
  };
  freshenFeed(feed, now);
  const summary = summarizeFeed(feed);
  const when = String(feed.updatedAt || '').replace('T', ' ').slice(0, 19);
  const usdBit = summary.priced
    ? fmtMoney(summary.usd) + ' on ' + summary.priced + ' priced row' + (summary.priced === 1 ? '' : 's')
    : 'no priced rows';
  const summaryLine = summary.received + ' received · ' + summary.swaps + ' swap' + (summary.swaps === 1 ? '' : 's') + ' · ' + usdBit + (summary.unpriced ? ' · ' + summary.unpriced + ' without a price' : '') + ' · ' + summary.active.length + ' of ' + summary.walletCount + ' wallets active';
  const mix = summary.active.length
    ? summary.active.map((wallet) => {
      const parts = [];
      if (wallet.received) parts.push(wallet.received + ' received');
      if (wallet.swaps) parts.push(wallet.swaps + ' swap' + (wallet.swaps === 1 ? '' : 's'));
      return wallet.name + ' ' + parts.join(', ') + (wallet.kind ? ' (' + wallet.kind + ')' : '');
    }).join(' · ')
    : 'No wallet has a row in this window.';
  let warn = '';
  if (summary.rows && summary.swaps === 0 && summary.kinds.desk === summary.rows) {
    warn = 'Every row on screen is a desk wallet receiving tokens. Received is a transfer in, not a buy.';
  } else if (summary.kinds.desk && summary.received) {
    warn = summary.kinds.desk + ' of these rows are desk flow. A desk inflow is not a smart-money buy.';
  }
  const rows = summary.rows
    ? (feed.rows || feed.buys).map((row) => {
      const priced = row.usd != null && Number.isFinite(Number(row.usd));
      const size = priced
        ? fmtMoney(Number(row.usd))
        : (fmtAmount(row.amount) ? fmtAmount(row.amount) + ' ' + (row.symbol || '') + ' · price n/a' : 'price n/a');
      const letter = row.letter
        ? '<a class="grade-pill ' + gradeClass(row.letter) + '" href="' + esc(row.checkHref) + '" title="Ape Check safety receipt. Not a recommendation.">' + esc(row.letter) + '</a>'
        : '<a class="grade-pill" href="' + esc(row.checkHref) + '" style="color:var(--secondary);font-size:13px" title="No letter on this pass. Open Ape Check.">check</a>';
      const explorer = EXPLORERS[row.chain] || EXPLORERS.eth;
      const txHref = row.tx ? explorer.tx + row.tx : explorer.address + row.tokenAddress;
      const side = sideOf(row.side);
      const sideTitle = side === 'swap'
        ? 'Tokens arrived from a pool, a router, or a swap this wallet signed.'
        : 'A transfer in. Not the same as a buy.';
      const iso = Number.isFinite(Number(row.ts)) ? new Date(Number(row.ts)).toISOString() : '';
      const title = iso ? iso.slice(0, 19).replace('T', ' ') + ' UTC' : '';
      return '<article class="feed-row">' +
        '<time datetime="' + esc(iso) + '" title="' + esc(title) + '">' + esc(row.ago || '') + '</time>' +
        '<div><div><span class="side ' + (side === 'swap' ? 'swap' : 'in') + '" title="' + esc(sideTitle) + '">' + side + '</span>' +
        '<span class="token-name">$' + esc(row.symbol || '???') + '</span></div>' +
        '<span class="token-sub">' + esc(row.walletName) + ' · ' + esc(String(row.chain || '').toUpperCase()) + ' · ' + esc(size) + '</span>' +
        '<div class="row-actions"><a href="' + esc(row.checkHref) + '">Ape Check</a><a href="' + esc(txHref) + '" target="_blank" rel="noopener">' + esc(explorer.name) + '</a>'
        + copyAddressHtml(row.tokenAddress, { label: 'Copy contract address' }) + '</div>' +
        '</div>' + letter + '</article>';
    }).join('')
    : '<div class="empty-feed"><b style="color:var(--text)">Nothing in the window.</b><br>No swap or received row from these wallets cleared the last 24 hours. Dust under $200 is hidden when a price is known. The list is public, and the page reuses a snapshot for a few minutes so the free explorers are not hammered.</div>';
  const activeCards = summary.active.map(walletCard).join('');
  const quietBlock = summary.quiet.length
    ? '<details class="quiet-wallets"' + (summary.active.length ? '' : ' open') + '><summary>Quiet · ' + summary.quiet.length + ' wallet' + (summary.quiet.length === 1 ? '' : 's') + ' with no rows</summary>' + summary.quiet.map(walletCard).join('') + '</details>'
    : '';
  const share = 'Smart Money Watch — public inflows, last 24h\n\n' + summary.received + ' received · ' + summary.swaps + ' swap' + (summary.swaps === 1 ? '' : 's') + '\n\nA received transfer is not a buy. Not financial advice.\n\nvia @ciphersignal_\n' + SITE + '/smart-money';
  const body = [
    '<div class="sm-live"><p class="sm-summary" data-received="' + summary.received + '" data-swaps="' + summary.swaps + '" data-usd="' + summary.usd + '" data-priced="' + summary.priced + '" data-unpriced="' + summary.unpriced + '" data-active="' + summary.active.length + '" data-wallets="' + summary.walletCount + '">' + esc(summaryLine) + '</p></div>',
    '<p class="sm-mix">Shown: ' + esc(mix) + '</p>',
    warn ? '<p class="sm-warn">' + esc(warn) + '</p>' : '',
    '<p class="hint">Snapshot ' + esc(when) + ' UTC. <a href="#how-this-works">How this works</a></p>',
    advertiseCalloutHtml(),
    feed.note ? '<p class="hint">' + esc(feed.note) + '</p>' : '',
    '<div class="sm-grid"><section class="card"><h2>flow</h2><p class="legend">swap = pool or router delivery · received = transfer in, not automatically a buy</p>' + rows + '</section><aside>' + activeCards + quietBlock + '</aside></div>',
    faqHtml(),
    buyButtonsHtml({ heading: 'Looking for a venue?', note: 'Referral desks. Not a comment on any row above.' }),
  ].join('');
  const html = shell({
    title: 'Smart Money Watch — CipherSignal',
    heading: 'smart money',
    description: 'Public wallet inflows from the last 24 hours. Swap and received are counted separately. A desk transfer is not a buy, and an Ape Check letter is not a recommendation.',
    path: '/smart-money',
    image: SITE + '/og/smart-money.png',
    active: 'smart',
    alertsReady: alertsReady(),
    shareText: share,
    shareLabel: 'Post this board on X',
    shareIntent: 'post',
    lede: 'Public wallets, last 24 hours. Each row is a swap or a transfer in. A desk receiving tokens is not a smart-money buy.',
    extraHead: feedCss(),
    body,
  });
  return { status: 200, html, cacheControl: 'public, max-age=30, s-maxage=120, stale-while-revalidate=300' };
}

module.exports = {
  WALLETS,
  parseBlockscoutV2,
  parseEtherscanTokentx,
  parseSolanaTransaction,
  parseHeliusSwaps,
  applyDexMeta,
  keepRow,
  ago,
  fmtAmount,
  loadSmartMoney,
  renderSmartMoneyPage,
  resetSmartMoneyMemory,
  gradeClass,
  gradeApplies,
  summarizeFeed,
  freshenFeed,
  looksLikeSwap,
  MIN_USD,
};
