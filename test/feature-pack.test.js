'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { THEMES, themeBootScript, themeCss } = require('../lib/theme');
const { parseBlockscoutV2, parseSolanaTransaction, parseHeliusSwaps, keepRow, renderSmartMoneyPage, resetSmartMoneyMemory } = require('../lib/smart-money');
const { rowsFromBoosts, loadGradedBoard, resetBoardMemory } = require('../lib/board');
const { slotsFromQuery, judge, renderComparePage } = require('../lib/compare');
const { composeDigest, createDigestSignup, runDigest } = require('../lib/digest');
const { handleRun } = require('../lib/alerts');
const { gradePostText, postHref } = require('../lib/share');
const { renderGrade } = require('../lib/ape-page');
const { renderHomeHtml, slimCoin, resetBootMemory } = require('../lib/boot');

function lin(channel) {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function contrast(hex, bg) {
  function lum(value) {
    const n = parseInt(value.slice(1), 16);
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  }
  const hi = Math.max(lum(hex), lum(bg));
  const lo = Math.min(lum(hex), lum(bg));
  return (hi + 0.05) / (lo + 0.05);
}

test('four themes stay readable and the homepage boots the saved choice before paint', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'templates', 'home.html'), 'utf8');
  const boot = themeBootScript();
  assert.ok(home.startsWith('<!DOCTYPE html>'));
  assert.ok(home.indexOf(boot) < home.indexOf('<style'));
  assert.ok(home.includes('cipher-theme'));
  assert.ok(home.includes('data-theme-set="og"'));
  assert.ok(home.includes('data-theme-set="voltage"'));
  assert.ok(home.includes('data-theme-set="mint"'));
  assert.ok(home.includes('data-theme-set="paper"'));
  assert.ok(home.includes('aria-label="Color theme"'));
  assert.ok(home.includes('title="Original teal and black"'));
  assert.ok(home.includes(themeCss().slice(0, 80)));
  assert.ok(home.includes('class="flagship" href="/smart-money"'));
  assert.equal(THEMES.og.vars['--accent'], '#00e5ff');
  assert.equal(THEMES.og.vars['--bg'], '#060810');
  Object.keys(THEMES).forEach((id) => {
    const theme = THEMES[id];
    assert.ok(contrast(theme.vars['--ink'], theme.vars['--bg']) >= 4.5, id + ' ink');
    assert.ok(contrast(theme.vars['--muted'], theme.vars['--bg']) >= 4.5, id + ' muted');
    assert.ok(contrast(theme.vars['--muted'], theme.vars['--surface']) >= 4.5, id + ' muted surface');
    assert.ok(contrast(theme.vars['--on-accent'], theme.vars['--accent']) >= 4.5, id + ' button');
  });
});

test('blockscout inflows become swap rows and ignore dust and stables', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const wallet = '0xdbf5e9c5206d0db70a90108bf936da60221dc080';
  const rows = parseBlockscoutV2([
    {
      timestamp: '2026-11-05T11:00:00.000000Z',
      transaction_hash: '0xabc',
      method: 'swap',
      from: { hash: '0x1111111111111111111111111111111111111111', name: 'UniswapV2Pair', is_contract: true },
      to: { hash: wallet },
      token: { address_hash: '0x6982508145454ce325ddbe47a25d4ec3d2311933', symbol: 'PEPE', name: 'Pepe', decimals: '18', exchange_rate: '0.00001' },
      total: { value: '50000000000000000000000000', decimals: '18' },
    },
    {
      timestamp: '2026-11-05T11:00:00.000000Z',
      transaction_hash: '0xdef',
      from: { hash: '0x2222222222222222222222222222222222222222', name: null },
      to: { hash: wallet },
      token: { address_hash: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', name: 'USD Coin', decimals: '6', exchange_rate: '1' },
      total: { value: '5000000', decimals: '6' },
    },
    {
      timestamp: '2026-11-01T11:00:00.000000Z',
      transaction_hash: '0xold',
      from: { hash: '0x3333333333333333333333333333333333333333', name: 'UniswapV2Pair' },
      to: { hash: wallet },
      token: { address_hash: '0x4444444444444444444444444444444444444444', symbol: 'OLD', decimals: '18', exchange_rate: '2' },
      total: { value: '1000000000000000000', decimals: '18' },
    },
  ], wallet, now, 'eth');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, 'PEPE');
  assert.equal(rows[0].side, 'swap');
  assert.ok(rows[0].usd > 200);
  assert.equal(keepRow({ symbol: 'PEPE', usd: 10, side: 'swap' }), false);
  assert.equal(keepRow({ symbol: 'PEPE', usd: null, side: 'swap' }), true);
});

test('solana balance increases from the signer count as swaps', () => {
  const now = Date.now();
  const wallet = 'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm';
  const rows = parseSolanaTransaction({
    blockTime: Math.floor(now / 1000) - 60,
    signature: 'sig1',
    transaction: {
      signatures: ['sig1'],
      message: { accountKeys: [{ pubkey: wallet, signer: true }] },
    },
    meta: {
      preTokenBalances: [{ owner: wallet, mint: 'Mint111111111111111111111111111111111111111', uiTokenAmount: { uiAmount: 1 } }],
      postTokenBalances: [
        { owner: wallet, mint: 'Mint111111111111111111111111111111111111111', uiTokenAmount: { uiAmount: 5 } },
        { owner: wallet, mint: 'So11111111111111111111111111111111111111112', uiTokenAmount: { uiAmount: 9 } },
      ],
    },
  }, wallet, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 4);
  assert.equal(rows[0].side, 'swap');
  const helius = parseHeliusSwaps([{
    timestamp: Math.floor(now / 1000) - 30,
    signature: 'sig2',
    tokenTransfers: [{ mint: 'Mint222', tokenAmount: 3, toUserAccount: wallet }],
  }], wallet, now);
  assert.equal(helius[0].tx, 'sig2');
});

test('smart money page renders a grade, an explorer link, and an empty state', () => {
  resetSmartMoneyMemory();
  const html = renderSmartMoneyPage({
    ok: true,
    updatedAt: '2026-11-05T12:00:00.000Z',
    note: '',
    wallets: [{ id: 'ansem', name: 'Ansem', kind: 'trader', why: 'Public trader wallet.', chains: ['sol'] }],
    buys: [{
      walletId: 'ansem',
      walletName: 'Ansem',
      chain: 'sol',
      tokenAddress: 'Mint111',
      symbol: 'WIF',
      name: 'dogwifhat',
      amount: 10,
      usd: 500,
      side: 'swap',
      ts: Date.parse('2026-11-05T11:50:00Z'),
      tx: 'sig',
      letter: 'B',
      score: 85,
      ago: '10m ago',
      checkHref: '/check/sol/Mint111',
    }],
  }).html;
  assert.match(html, /Smart Money/);
  assert.match(html, /Ansem/);
  assert.match(html, /grade-b/);
  assert.match(html, /solscan\.io\/tx\/sig/);
  assert.match(html, /Post this board on X/);
  assert.match(html, /https:\/\/x\.com\/intent\/post\?text=/);
  assert.equal(html.toLowerCase().includes('scam'), false);
  const empty = renderSmartMoneyPage({ ok: true, buys: [], wallets: [], updatedAt: '2026-11-05T12:00:00.000Z' }).html;
  assert.match(empty, /Nothing in the window/);
});

test('boosts skip unknown chains and the board drops tokens that do not grade', async () => {
  resetBoardMemory();
  const rows = rowsFromBoosts([
    { chainId: 'solana', tokenAddress: 'Mint111' },
    { chainId: 'solana', tokenAddress: 'Mint111' },
    { chainId: 'ethereum', tokenAddress: '0xabc' },
    { chainId: 'tron', tokenAddress: 'nope' },
  ]);
  assert.equal(rows.length, 2);
  const board = await loadGradedBoard({
    skipMovers: true,
    fill: 5,
    boosts: [
      { chainId: 'ethereum', tokenAddress: '0x6982508145454ce325ddbe47a25d4ec3d2311933' },
      { chainId: 'base', tokenAddress: '0x1111111111111111111111111111111111111111' },
    ],
    fetchImpl: async () => ({ ok: true, text: async () => '[]', json: async () => [] }),
    grade: async (chain) => chain === 'eth'
      ? { ok: true, letter: 'A-', score: 91, symbol: 'PEPE' }
      : { ok: false, error: 'no' },
  });
  assert.equal(board.rows.length, 1);
  assert.equal(board.rows[0].letter, 'A-');
  assert.equal(board.rows[0].href, '/check/eth/0x6982508145454ce325ddbe47a25d4ec3d2311933');
});

test('compare deep links pick a higher receipt without telling anyone to buy', async () => {
  const slots = slotsFromQuery({ a: 'eth:0x6982508145454ce325ddbe47a25d4ec3d2311933', b: 'sol:Mint111111111111111111111111111111111111111' });
  assert.equal(slots.length, 2);
  assert.equal(slots[0].chain, 'eth');
  const verdict = judge([
    { ok: true, score: 90, letter: 'A-', symbol: 'PEPE' },
    { ok: true, score: 62, letter: 'D', symbol: 'NOPE' },
  ]);
  assert.equal(verdict.tone, 'lead');
  assert.match(verdict.line, /higher automated grade/);
  assert.equal(verdict.line.toLowerCase().includes('scam'), false);
  const close = judge([
    { ok: true, score: 80, letter: 'B-', symbol: 'ONE' },
    { ok: true, score: 79, letter: 'C+', symbol: 'TWO' },
  ]);
  assert.equal(close.tone, 'close');
  const page = await renderComparePage({ a: 'eth:0x6982508145454ce325ddbe47a25d4ec3d2311933', b: 'eth:0x1111111111111111111111111111111111111111' }, {
    grade: async (chain, address) => ({
      ok: true,
      chain,
      address,
      chainName: 'Ethereum',
      symbol: address.endsWith('1933') ? 'PEPE' : 'OTHER',
      name: 'Token',
      letter: address.endsWith('1933') ? 'A' : 'C',
      score: address.endsWith('1933') ? 95 : 74,
      checks: [{ label: 'Mint authority', status: 'pass', detail: 'Mint authority is off.' }],
      verdicts: ['Clean receipt.'],
    }),
  });
  assert.equal(page.status, 200);
  assert.match(page.html, /Post this compare on X/);
  assert.match(page.html, /a=eth%3A0x6982508145454ce325ddbe47a25d4ec3d2311933|a=eth:0x6982508145454ce325ddbe47a25d4ec3d2311933/);
  assert.match(page.html, /higher automated grade/);
});

test('grade post opens an X intent with the permalink', () => {
  const report = {
    chain: 'eth',
    chainName: 'Ethereum',
    address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    symbol: 'PEPE',
    name: 'Pepe',
    score: 85,
    letter: 'B',
    priceUsd: 0.00001,
    logo: '',
    verdicts: ['Clean enough.'],
    checks: [],
    exchanges: [],
  };
  const text = gradePostText(report);
  assert.match(text, /Ape Check B/);
  assert.match(text, /https:\/\/www\.ciphersignal\.xyz\/check\/eth\/0x6982508145454ce325ddbe47a25d4ec3d2311933/);
  assert.ok(text.length < 280);
  const href = postHref(text);
  assert.ok(href.startsWith('https://x.com/intent/post?text='));
  const html = renderGrade(report).html;
  assert.match(html, /Post this grade on X/);
  assert.match(html, /https:\/\/x\.com\/intent\/post\?text=/);
  assert.equal(html.toLowerCase().includes('scam'), false);
});

test('digest copy includes the five sections and signup stores a row', async () => {
  const message = composeDigest({
    movers: [{ id: 'pepe', symbol: 'PEPE', change24h: 12.5 }],
    hall: { symbol: 'PEPE', letter: 'A', chain: 'eth', address: '0xabc', score: 95 },
    shame: { symbol: 'NOPE', letter: 'F', chain: 'bsc', address: '0xdef', score: 10 },
    fear: { value: '50', label: 'Neutral' },
    unsub: 'https://www.ciphersignal.xyz/api/alerts/unsubscribe?token=abc&list=digest&confirm=1',
  });
  assert.match(message.text, /Smart Money Watch/);
  assert.match(message.text, /Hall highlight/);
  assert.match(message.text, /Shame highlight/);
  assert.match(message.text, /Fear & Greed: 50 Neutral/);
  assert.match(message.text, /Unsubscribe:/);
  assert.match(message.html, /Smart Money Watch/);
  assert.equal(message.text.toLowerCase().includes('scam'), false);
  const previous = process.env.DIGEST_FILE;
  const file = path.join(os.tmpdir(), 'cipher-digest-' + Date.now() + '.json');
  process.env.DIGEST_FILE = file;
  delete process.env.RESEND_API_KEY;
  delete process.env.VERCEL;
  const saved = await createDigestSignup({ email: 'reader@example.com' });
  assert.equal(saved.body.stored, true);
  assert.equal(saved.body.emailed, false);
  const again = await createDigestSignup({ email: 'reader@example.com' });
  assert.equal(again.body.stored, false);
  const dry = await runDigest({
    dry: true,
    loadMovers: async () => ({ ok: true, gainers: [{ id: 'pepe', symbol: 'PEPE', change24h: 3 }] }),
    loadBoard: async () => [],
    fetchFear: async () => null,
  });
  assert.equal(dry.dry, true);
  assert.equal(dry.sent, 0);
  assert.match(dry.text, /PEPE/);
  if (previous) process.env.DIGEST_FILE = previous;
  else delete process.env.DIGEST_FILE;
  fs.rmSync(file, { force: true });
});

test('digest dry-run stays unauthorized without CRON_SECRET', async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const denied = await handleRun({ headers: {} }, { digestOnly: true, dry: true });
  assert.equal(denied.status, 401);
  if (previous) process.env.CRON_SECRET = previous;
});

test('homepage html can include a cached coin before the client fetch', () => {
  resetBootMemory();
  const coin = slimCoin({
    id: 'pepe',
    symbol: 'pepe',
    name: 'Pepe',
    image: 'https://example.com/pepe.png',
    current_price: 0.00001,
    market_cap: 1000,
    total_volume: 5000,
    price_change_percentage_24h: 4,
    price_change_percentage_7d_in_currency: -2,
  });
  assert.equal(slimCoin({ id: 'dust', total_volume: 10 }), null);
  const html = renderHomeHtml({
    updatedAt: '2026-11-05T12:00:00.000Z',
    coins: [coin],
    board: [{ symbol: 'PEPE', letter: 'A', chain: 'eth', address: '0xabc', href: '/check/eth/0xabc', change24h: 4, name: 'Pepe' }],
  });
  assert.match(html, /window\.__CIPHER_BOOT__/);
  assert.match(html, /cached snapshot 2026-11-05 12:00:00 UTC/);
  assert.equal(html.includes('waiting for CoinGecko'), false);
  assert.match(html, /\$PEPE/);
  const cold = renderHomeHtml(null);
  assert.match(cold, /waiting for CoinGecko/);
});

test('linked feature routes answer 200 even when upstream data is empty', async () => {
  resetSmartMoneyMemory();
  const { server } = require('../server');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const paths = ['/compare', '/digest', '/smart-money', '/updates', '/check', '/og/smart-money.png'];
  try {
    for (const pathname of paths) {
      const res = await fetch('http://127.0.0.1:' + port + pathname);
      assert.equal(res.status, 200, pathname + ' ' + res.status);
      await res.arrayBuffer();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
