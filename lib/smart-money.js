'use strict';

const { esc } = require('./http-util');
const { WALLETS, IGNORE_SYMBOLS, IGNORE_MINTS } = require('./wallets');
const { cacheGet, cacheSet } = require('./store');
const { shell, buyButtonsHtml, SITE } = require('./chrome');
const { alertsReady } = require('./alerts-ready');
const { checkToken } = require('./ape');
const { isBuyGrade } = require('./grade');
const { fmtMoney } = require('./format');
const { postHref } = require('./share');

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_MS = 8 * 60 * 1000;
const CACHE_KEY = 'cipher:smart-money:v1';
const MIN_USD = 200;

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
  return /pair|pool|router|swap|uniswap|pancake|sushi|aggregator|universal|1inch|odos|kyber|jupiter|raydium|curve/i.test(blob);
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
    const key = String(base.address);
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
    const meta = byToken.get(row.tokenAddress) || byToken.get(String(row.tokenAddress || '').toLowerCase());
    if (!meta) return;
    if (!row.symbol && meta.symbol) row.symbol = String(meta.symbol).slice(0, 16).toUpperCase();
    if (!row.name && meta.name) row.name = String(meta.name).slice(0, 64);
    if (row.usd == null && row.amount != null && Number.isFinite(meta.price) && meta.price > 0) {
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
  const missing = new Map();
  rows.forEach((row) => {
    if (row.symbol) return;
    const key = row.chain + ':' + row.tokenAddress;
    if (!missing.has(key)) missing.set(key, row);
  });
  const byChain = new Map();
  missing.forEach((row) => {
    if (!byChain.has(row.chain)) byChain.set(row.chain, []);
    byChain.get(row.chain).push(row.tokenAddress);
  });
  const dexChain = { eth: 'ethereum', base: 'base', bsc: 'bsc', sol: 'solana' };
  await Promise.all([...byChain.entries()].map(async ([chain, addresses]) => {
    const slug = dexChain[chain];
    if (!slug || !addresses.length) return;
    const url = 'https://api.dexscreener.com/tokens/v1/' + slug + '/' + addresses.slice(0, 30).join(',');
    const hit = await fetchJson(url, fetchImpl, 5000);
    const pairs = Array.isArray(hit.json) ? hit.json : (hit.json && hit.json.pairs) || [];
    applyDexMeta(rows.filter((row) => row.chain === chain), pairs);
  }));
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
    const id = [row.walletId, row.chain, row.tokenAddress, row.tx, row.side].join(':');
    if (seen.has(id)) return false;
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

async function attachGrades(rows, grade, limit) {
  const fn = grade || checkToken;
  const pending = [];
  const seen = new Set();
  rows.forEach((row) => {
    if (!row || row.letter) return;
    if (!['eth', 'bsc', 'base', 'sol'].includes(row.chain)) return;
    const id = row.chain + ':' + row.tokenAddress;
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
      if (report && report.ok && report.letter) {
        const id = row.chain + ':' + row.tokenAddress;
        rows.forEach((other) => {
          if (other.chain + ':' + other.tokenAddress !== id) return;
          other.letter = report.letter;
          other.score = report.score;
          if (!other.symbol && report.symbol) other.symbol = report.symbol;
          if (!other.name && report.name) other.name = report.name;
        });
      }
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
}

async function loadSmartMoney(opts) {
  const options = opts || {};
  const now = options.now || Date.now();
  if (!options.force && memory.value && (now - memory.at) < FRESH_MS) return memory.value;
  if (!options.force && !options.fetchImpl) {
    const saved = await cacheGet(CACHE_KEY);
    if (saved && saved.buys && (now - Date.parse(saved.updatedAt || 0)) < FRESH_MS) {
      memory.at = now;
      memory.value = saved;
      return saved;
    }
    if (options.refresh === false) return saved || publicFeed([], now, 'cached');
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
    return payload;
  }
  const saved = memory.value || (!options.fetchImpl ? await cacheGet(CACHE_KEY) : null);
  if (saved && saved.buys) {
    saved.note = note || saved.note || '';
    return saved;
  }
  return publicFeed([], now, note || 'No tracked inflows cleared the filter in the last 24 hours.');
}

function feedCss() {
  return `<style>
.sm-live{display:inline-flex;align-items:center;gap:8px;font-family:Orbitron,monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--pos);border:1px solid var(--border2);background:var(--surface);padding:6px 10px;border-radius:99px;margin-bottom:.8rem}
.sm-dot{width:8px;height:8px;border-radius:50%;background:var(--pos);box-shadow:0 0 0 0 var(--pos);animation:pulse 1.6s infinite}
.sm-grid{display:grid;grid-template-columns:280px 1fr;gap:12px}
.wallet-card{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:8px}
.wallet-card b{font-family:Orbitron,monospace;font-size:13px;letter-spacing:.06em;color:var(--text)}
.wallet-card p{margin:.35rem 0 0;color:var(--secondary);font-size:14px;line-height:1.5}
.kind{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.feed-row{display:grid;grid-template-columns:92px 1fr auto;gap:10px;align-items:center;padding:12px 4px;border-bottom:1px solid var(--border)}
.feed-row time{color:var(--muted);font-size:14px}
.side{display:inline-block;font-family:Orbitron,monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;border-radius:3px;padding:2px 6px;margin-right:6px}
.side.swap{color:var(--on-accent);background:var(--accent)}
.side.in{color:var(--ink);border:1px solid var(--border2)}
.token-name{font-family:Orbitron,monospace;font-size:16px;color:var(--text);letter-spacing:.04em}
.token-sub{display:block;color:var(--muted);font-size:14px;margin-top:2px}
.grade-pill{font-family:Orbitron,monospace;font-weight:700;font-size:18px;text-decoration:none;min-width:42px;text-align:right}
.row-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.row-actions a{font-size:13px}
.empty-feed{padding:1.2rem;border:1px dashed var(--border2);border-radius:8px;color:var(--secondary);line-height:1.6}
@media(max-width:800px){.sm-grid{grid-template-columns:1fr}.feed-row{grid-template-columns:72px 1fr}}
</style>`;
}

function renderSmartMoneyPage(data) {
  const feed = data && data.buys ? data : { ok: true, buys: [], wallets: WALLETS.map((w) => ({ id: w.id, name: w.name, kind: w.kind, why: w.why, chains: w.chains.map((c) => c.chain) })), updatedAt: new Date().toISOString(), note: '' };
  const when = String(feed.updatedAt || '').replace('T', ' ').slice(0, 19);
  const swaps = feed.buys.filter((row) => row.side === 'swap').length;
  const rows = feed.buys.length
    ? feed.buys.map((row) => {
      const size = row.usd != null ? fmtMoney(row.usd) : (fmtAmount(row.amount) ? fmtAmount(row.amount) + ' ' + row.symbol : 'size n/a');
      const letter = row.letter
        ? '<a class="grade-pill ' + gradeClass(row.letter) + '" href="' + esc(row.checkHref) + '">' + esc(row.letter) + '</a>'
        : '<a class="grade-pill" href="' + esc(row.checkHref) + '" style="color:var(--muted);font-size:13px">grade</a>';
      const explorer = EXPLORERS[row.chain] || EXPLORERS.eth;
      const txHref = row.tx ? explorer.tx + row.tx : explorer.address + row.tokenAddress;
      const cta = row.letter && isBuyGrade(row.letter)
        ? buyButtonsHtml({ heading: 'Grade is on the receipt. Buy on…', note: 'A letter is not a reason to buy.' })
        : '';
      return '<article class="feed-row">' +
        '<time datetime="' + esc(new Date(row.ts || Date.now()).toISOString()) + '">' + esc(row.ago || '') + '</time>' +
        '<div><div><span class="side ' + (row.side === 'swap' ? 'swap' : 'in') + '">' + (row.side === 'swap' ? 'swap' : 'received') + '</span>' +
        '<span class="token-name">$' + esc(row.symbol || '???') + '</span></div>' +
        '<span class="token-sub">' + esc(row.walletName) + ' · ' + esc(String(row.chain || '').toUpperCase()) + ' · ' + esc(size) + '</span>' +
        '<div class="row-actions"><a href="' + esc(row.checkHref) + '">Ape Check</a><a href="' + esc(txHref) + '" target="_blank" rel="noopener">' + esc(explorer.name) + '</a></div>' +
        cta +
        '</div>' + letter + '</article>';
    }).join('')
    : '<div class="empty-feed"><b style="color:var(--text)">Nothing in the window.</b><br>No swap or sized transfer from these wallets cleared the last 24 hours. The list is public and the page caches for a few minutes so the free explorers are not hammered. Hit refresh in a bit.</div>';
  const walletCards = (feed.wallets || []).map((wallet) => (
    '<div class="wallet-card"><div class="kind">' + esc(wallet.kind || 'wallet') + ' · ' + esc((wallet.chains || []).join(' · ')) + '</div><b>' + esc(wallet.name) + '</b><p>' + esc(wallet.why) + '</p></div>'
  )).join('');
  const share = 'Smart Money Watch — public wallet flow, last 24h\n\n' + swaps + ' swaps on the board\n\nvia @ciphersignal_\n' + SITE + '/smart-money';
  const body = [
    '<div class="sm-live"><span class="sm-dot"></span> last 24h · ' + feed.buys.length + ' rows · ' + swaps + ' swaps</div>',
    '<p class="hint">Snapshot ' + esc(when) + ' UTC. Swap means the wallet sent the transaction or the tokens left a pool or router. Received means a transfer in, including airdrops. Dust under $200 is hidden when a price is known. Grades are the Ape Check receipt. A letter is not a recommendation.</p>',
    feed.note ? '<p class="hint">' + esc(feed.note) + '</p>' : '',
    '<div class="sm-grid"><aside>' + walletCards + '</aside><section class="card"><h2>flow</h2>' + rows + '</section></div>',
    buyButtonsHtml({ heading: 'Looking for a venue?', note: 'Referral desks. Not a comment on any row above.' }),
  ].join('');
  const html = shell({
    title: 'Smart Money Watch — CipherSignal',
    heading: 'smart money',
    description: 'Public Solana and Ethereum wallets and the tokens that hit them in the last 24 hours, with Ape Check grades when the chain is ETH, BSC, Base, or Solana.',
    path: '/smart-money',
    image: SITE + '/og/smart-money.png',
    active: 'smart',
    alertsReady: alertsReady(),
    shareText: share,
    shareLabel: 'Post this board on X',
    shareIntent: 'post',
    lede: 'Whale buys and desk flow from a short public list. Refresh it. The grades sit on the row when Ape Check can read the token.',
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
  MIN_USD,
};
