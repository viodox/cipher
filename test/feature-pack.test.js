'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { THEMES, themeBootScript, themeCss } = require('../lib/theme');
const { parseBlockscoutV2, parseSolanaTransaction, parseHeliusSwaps, keepRow, renderSmartMoneyPage, resetSmartMoneyMemory, summarizeFeed, applyDexMeta, gradeApplies, looksLikeSwap, freshenFeed, loadSmartMoney } = require('../lib/smart-money');
const { SEGMENT_COUNT, nyDayKey, hashIndex, wheelEase, segmentAt, landingRotation, bonusIndex, modelFromCoins, renderFortunePage, cookieReveals } = require('../lib/fortune');
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
  assert.equal(keepRow({ symbol: '', usd: null, side: 'swap' }), true);
  assert.equal(keepRow({ symbol: '', usd: null, side: 'in' }), false);
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
  const received = parseSolanaTransaction({
    blockTime: Math.floor(now / 1000) - 60,
    signature: 'sig-in',
    transaction: {
      signatures: ['sig-in'],
      message: { accountKeys: [{ pubkey: wallet, signer: false }, { pubkey: 'Other1111111111111111111111111111111111111', signer: true }] },
    },
    meta: {
      preTokenBalances: [],
      postTokenBalances: [
        { owner: wallet, mint: 'Mint111111111111111111111111111111111111111', uiTokenAmount: { uiAmount: 10 } },
      ],
    },
  }, wallet, now);
  assert.equal(received.length, 1);
  assert.equal(received[0].side, 'in');
  assert.equal(received[0].amount, 10);
  const helius = parseHeliusSwaps([{
    timestamp: Math.floor(now / 1000) - 30,
    signature: 'sig2',
    tokenTransfers: [{ mint: 'Mint222', tokenAmount: 3, toUserAccount: wallet }],
  }], wallet, now);
  assert.equal(helius[0].tx, 'sig2');
});

function jsonResponse(body, ok) {
  const text = JSON.stringify(body);
  return Promise.resolve({
    ok: ok !== false,
    status: ok === false ? 500 : 200,
    text: async () => text,
    json: async () => body,
  });
}

test('a slow explorer does not wipe rows that already arrived', async () => {
  resetSmartMoneyMemory();
  const now = Date.now();
  const ts = Math.floor(now / 1000) - 120;
  const fast = '0x1111111111111111111111111111111111111111';
  const slow = '0x2222222222222222222222222222222222222222';
  const wallets = [
    { id: 'fast', name: 'Fast Desk', kind: 'desk', why: 'Test.', chains: [{ chain: 'eth', address: fast }] },
    { id: 'slow', name: 'Late Desk', kind: 'desk', why: 'Test.', chains: [{ chain: 'eth', address: slow }] },
  ];
  const fetchImpl = (url) => {
    const href = String(url);
    if (href.includes(slow)) return new Promise(() => {});
    if (href.includes('dexscreener')) {
      return jsonResponse([{
        priceUsd: '1',
        liquidity: { usd: 5000 },
        baseToken: { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', symbol: 'PEPE', name: 'Pepe' },
      }]);
    }
    return jsonResponse({
      status: '1',
      message: 'OK',
      result: [{
        timeStamp: String(ts),
        from: '0x3333333333333333333333333333333333333333',
        to: fast,
        tokenSymbol: 'PEPE',
        tokenName: 'Pepe',
        contractAddress: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
        tokenDecimal: '18',
        value: '1000000000000000000000000',
        hash: '0xabc',
        functionName: 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
        input: '0x38ed1739',
      }],
    });
  };
  const started = Date.now();
  const feed = await loadSmartMoney({ fetchImpl, wallets, now, fill: 0, budgetMs: 1200, force: true });
  assert.ok(Date.now() - started < 4000);
  assert.ok(feed.buys.some((row) => row.symbol === 'PEPE' && row.side === 'swap'));
  assert.equal(String(feed.note || '').toLowerCase().includes('slow'), false);
  resetSmartMoneyMemory();
});

test('a finished empty window is not described as a slow explorer', async () => {
  resetSmartMoneyMemory();
  const wallets = [
    { id: 'quiet', name: 'Quiet Desk', kind: 'desk', why: 'Test.', chains: [{ chain: 'eth', address: '0x4444444444444444444444444444444444444444' }] },
  ];
  const fetchImpl = () => jsonResponse({ status: '1', message: 'OK', result: [] });
  const empty = await loadSmartMoney({ fetchImpl, wallets, fill: 0, budgetMs: 2000, force: true });
  assert.equal(empty.buys.length, 0);
  assert.match(empty.note, /No tracked inflows/);
  assert.equal(empty.note.toLowerCase().includes('slow'), false);
  const failed = await loadSmartMoney({
    fetchImpl: () => jsonResponse({ message: 'nope' }, false),
    wallets,
    fill: 0,
    budgetMs: 2000,
    force: true,
  });
  assert.match(failed.note, /Quiet Desk ETH:/);
  assert.match(failed.note, /blockscout v2 HTTP 500/);
  assert.match(failed.note, /routescan HTTP 500/);
  resetSmartMoneyMemory();
});

test('a blockscout price keeps the inflow when routescan and dexscreener fail', async () => {
  resetSmartMoneyMemory();
  const now = Date.now();
  const wallet = '0x1111111111111111111111111111111111111111';
  const other = '0x2222222222222222222222222222222222222222';
  const fetchImpl = (url) => {
    const href = String(url);
    if (href.includes(other) || href.includes('routescan') || href.includes('dexscreener') || href.includes('module=account')) {
      return jsonResponse({ message: 'nope' }, false);
    }
    return jsonResponse({
      items: [{
        timestamp: new Date(now - 60000).toISOString(),
        transaction_hash: '0xabc',
        method: '0xa9059cbb',
        from: { hash: '0x3333333333333333333333333333333333333333', name: null },
        to: { hash: wallet },
        token: {
          address_hash: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
          symbol: 'PEPE',
          name: 'Pepe',
          decimals: '18',
          exchange_rate: '0.00001',
        },
        total: { value: '50000000000000000000000000', decimals: '18' },
      }],
    });
  };
  const feed = await loadSmartMoney({
    fetchImpl,
    wallets: [
      { id: 'desk', name: 'Desk', kind: 'desk', why: 'Test.', chains: [{ chain: 'eth', address: wallet }] },
      { id: 'other', name: 'Other Desk', kind: 'desk', why: 'Test.', chains: [{ chain: 'eth', address: other }] },
    ],
    now,
    fill: 0,
    budgetMs: 4000,
    force: true,
  });
  const pepe = feed.buys.find((row) => row.symbol === 'PEPE');
  assert.ok(pepe, JSON.stringify(feed.note));
  assert.ok(pepe.usd >= 200);
  assert.equal(pepe.side, 'in');
  assert.match(feed.note, /Other Desk ETH:/);
  assert.match(feed.note, /HTTP 500/);
  resetSmartMoneyMemory();
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
  assert.match(empty, /0 received · 0 swaps/);
  assert.match(html, /0 received · 1 swap/);
  assert.match(html, /data-swaps="1"/);
  assert.match(html, /data-received="0"/);
  assert.match(html, /data-priced="1"/);
  assert.match(html, /Active/);
  assert.equal(html.toLowerCase().includes('whale buy'), false);
});

test('smart money summary matches the rows and does not treat desk inflows as buys', () => {
  const now = Date.parse('2026-11-05T04:00:00Z');
  const feed = {
    updatedAt: '2026-11-05T03:00:00.000Z',
    wallets: [
      { id: 'jump', name: 'Jump Trading', kind: 'desk', why: 'Desk.', chains: ['eth'] },
      { id: 'vitalik', name: 'vitalik.eth', kind: 'notable', why: 'Public.', chains: ['eth'] },
    ],
    buys: [
      { walletId: 'jump', walletName: 'Jump Trading', walletKind: 'desk', chain: 'eth', symbol: 'ATH', usd: 6000, side: 'in', ts: now - 24 * 60 * 1000, tokenAddress: '0xbe0ed4138121ecfc5c0e56b40517da27e6c5226b', tx: '0x1', letter: 'F', ago: 'stale', checkHref: '/check/eth/0xbe0ed4138121ecfc5c0e56b40517da27e6c5226b' },
      { walletId: 'jump', walletName: 'Jump Trading', walletKind: 'desk', chain: 'eth', symbol: 'LIT', usd: 2000, side: 'in', ts: now - 60 * 60 * 1000, tokenAddress: '0x232ce3bd40fcd6', tx: '0x2', letter: 'C-', ago: 'stale', checkHref: '/check/eth/0x232ce3bd40fcd6' },
    ],
  };
  const summary = summarizeFeed(feed);
  assert.equal(summary.rows, 2);
  assert.equal(summary.received, 2);
  assert.equal(summary.swaps, 0);
  assert.equal(summary.usd, 8000);
  assert.equal(summary.priced, 2);
  assert.equal(summary.active.length, 1);
  assert.equal(summary.quiet.length, 1);
  assert.equal(summary.quiet[0].name, 'vitalik.eth');
  const html = renderSmartMoneyPage(feed, { now }).html;
  assert.match(html, /2 received · 0 swaps/);
  assert.match(html, /\$8\.0K on 2 priced rows/);
  assert.match(html, /1 of 2 wallets active/);
  assert.match(html, /Jump Trading 2 received \(desk\)/);
  assert.match(html, /Every row on screen is a desk wallet receiving tokens/);
  assert.match(html, /Quiet · no rows in the last 24 hours/);
  assert.match(html, /vitalik\.eth/);
  assert.match(html, /24m ago/);
  assert.match(html, /1h ago/);
  assert.equal(html.includes('stale'), false);
  assert.match(html, /How this works/);
  assert.match(html, /plain transfer/);
  assert.match(html, /not a buy/);
  assert.match(html, /HELIUS_API_KEY/);
  assert.equal(/whale buy/i.test(html), false);
});

test('prices and grades stick to the matching token only', () => {
  assert.equal(looksLikeSwap('', '0xa9059cbb'), false);
  assert.equal(looksLikeSwap('', '0x38ed1739'), true);
  const rows = [
    { chain: 'eth', tokenAddress: '0xabc', symbol: 'PEPE', amount: 10, usd: null, side: 'in' },
    { chain: 'eth', tokenAddress: '0xdef', symbol: 'NOPE', amount: 2, usd: null, side: 'in' },
  ];
  applyDexMeta(rows, [{
    liquidity: { usd: 1000 },
    priceUsd: '3',
    baseToken: { address: '0xAbC', symbol: 'PEPE', name: 'Pepe' },
  }]);
  assert.equal(rows[0].usd, 30);
  assert.equal(rows[1].usd, null);
  const report = { ok: true, letter: 'A', chain: 'eth', address: '0xabc', symbol: 'OTHER' };
  assert.equal(gradeApplies(rows[0], report), false);
  assert.equal(gradeApplies(rows[0], { ok: true, letter: 'B', chain: 'eth', address: '0xABC', symbol: 'PEPE' }), true);
  assert.equal(gradeApplies(rows[1], { ok: true, letter: 'B', chain: 'eth', address: '0xABC', symbol: 'PEPE' }), false);
  const fresh = freshenFeed({ buys: [{ ts: Date.parse('2026-11-05T03:00:00Z'), ago: 'stale' }] }, Date.parse('2026-11-05T03:10:00Z'));
  assert.equal(fresh.buys[0].ago, '10m ago');
});

test('cipher fortune pick is stable for a New York date and the page is not a wager', () => {
  assert.equal(nyDayKey('2026-11-05T04:59:00Z'), '2026-11-04');
  assert.equal(nyDayKey('2026-11-05T05:00:00Z'), '2026-11-05');
  const coins = [];
  for (let i = 0; i < 40; i += 1) {
    coins.push({
      id: 'coin-' + i,
      symbol: 'c' + i,
      name: 'Coin ' + i,
      current_price: 1 + i,
      market_cap: 1000000 - i * 1000,
      total_volume: 50000,
      price_change_percentage_24h: i - 10,
    });
  }
  const now = Date.parse('2026-11-05T16:00:00Z');
  const first = modelFromCoins(coins, [{ symbol: 'C3', letter: 'B', chain: 'eth', address: '0x1111111111111111111111111111111111111111', href: '/check/eth/0x1111111111111111111111111111111111111111', coinId: 'coin-3' }], now);
  const second = modelFromCoins(coins, [], now);
  assert.equal(first.ok, true);
  assert.equal(first.dayKey, '2026-11-05');
  assert.equal(first.segments.length, SEGMENT_COUNT);
  assert.equal(first.segments[first.winnerSlot].id, first.winner.id);
  assert.equal(second.winner.id, first.winner.id);
  assert.equal(new Set(first.segments.map((row) => row.id)).size, SEGMENT_COUNT);
  const locked = modelFromCoins(coins, [], now, { storedId: 'coin-7' });
  assert.equal(locked.winner.id, 'coin-7');
  assert.equal(locked.source, 'day-cache');
  assert.equal(hashIndex('cipher-fortune-v1|2026-11-05', 40), hashIndex('cipher-fortune-v1|2026-11-05', 40));
  for (let i = 0; i < 32; i += 1) {
    assert.equal(segmentAt(landingRotation(12, i, 32, 6), 32), i);
  }
  assert.equal(wheelEase(0), 0);
  assert.equal(wheelEase(1), 1);
  assert.ok(wheelEase(0.3) > wheelEase(0.08));
  let peak = 0;
  for (let step = 0; step <= 100; step += 1) peak = Math.max(peak, wheelEase(step / 100));
  assert.ok(peak > 1);
  const early = (wheelEase(0.1) - wheelEase(0.02)) / 0.08;
  const coast = (wheelEase(0.4) - wheelEase(0.25)) / 0.15;
  const late = (wheelEase(0.86) - wheelEase(0.78)) / 0.08;
  assert.ok(coast > early);
  assert.ok(coast > late);
  assert.equal(bonusIndex(5, 32, 5), 6);
  const graded = first.segments.find((row) => row.id === 'coin-3');
  if (graded) assert.equal(graded.letter, 'B');
  const html = renderFortunePage(first, { revealed: false }).html;
  assert.equal(html.includes('Cipher Fortune'), true);
  assert.match(html, /Spin the wheel, land on a random coin, get today’s decoded breakdown/);
  assert.match(html, /Free\. For fun\. Not a prediction/);
  assert.match(html, /No prizes and no paid spins/);
  assert.match(html, /SHA-256/);
  assert.match(html, /America\/New_York|New York date/);
  assert.match(html, /Spin again/);
  assert.match(html, /AudioContext/);
  assert.match(html, /navigator\.vibrate/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /REDUCED_MS = 480/);
  assert.match(html, /FULL_MS = 6400/);
  assert.match(html, /id="cf-sound"/);
  assert.match(html, /cf-slice-a/);
  assert.match(html, /cf-slice-b/);
  assert.match(html, /class="cf-pointer"/);
  assert.match(html, /rotate\(/);
  assert.equal(html.includes('cf-glyphs'), false);
  assert.match(html, /Post this fortune on X/);
  assert.match(html, /via @ciphersignal_/);
  assert.match(html, /via%20%40ciphersignal_/);
  assert.match(html, /https%3A%2F%2Fwww\.ciphersignal\.xyz%2Fcipher-fortune/);
  assert.match(html, /data-referral/);
  assert.match(html, /https:\/\/x\.com\/intent\/post\?text=/);
  const withoutFooter = html.replace(/offer to buy, sell, or bet/g, '');
  assert.equal(/jackpot|wager|casino|gambl|payout|you won|win money|\bbet\b/i.test(withoutFooter), false);
  assert.equal(/lucky seal|seal of fortune|seal face/i.test(html), false);
  assert.equal(cookieReveals('cf_fortune=' + encodeURIComponent(first.dayKey + ':' + first.winner.id), first), true);
  assert.equal(cookieReveals('cf_fortune=nope', first), false);
  const shown = renderFortunePage(first, { revealed: true }).html;
  assert.match(shown, new RegExp('\\$' + first.winner.symbol));
  assert.match(shown, /Today’s Cipher Fortune/);
  const home = require('fs').readFileSync(require('path').join(__dirname, '..', 'templates', 'home.html'), 'utf8');
  assert.match(home, /href="\/cipher-fortune"/);
  assert.match(home, /spin a real coin/);
  assert.match(home, /Spin the wheel, land on a random coin, get today’s decoded breakdown/);
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
  assert.match(text, /via @ciphersignal_/);
  assert.match(text, /https:\/\/www\.ciphersignal\.xyz\/check\/eth\/0x6982508145454ce325ddbe47a25d4ec3d2311933/);
  assert.ok(text.length < 280);
  const href = postHref(text);
  assert.ok(href.startsWith('https://x.com/intent/post?text='));
  const html = renderGrade(report).html;
  assert.match(html, /Post this grade on X/);
  assert.match(html, /https:\/\/x\.com\/intent\/post\?text=/);
  assert.match(html, /data-share="[^"]*@ciphersignal_/);
  assert.match(html, /btn\.getAttribute\('data-share'\)/);
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
  const paths = ['/', '/compare', '/digest', '/smart-money', '/cipher-fortune', '/updates', '/check', '/advertise', '/go/coinbase', '/go/binance-us', '/go/kraken', '/go/crypto-com', '/go/robinhood', '/og/smart-money.png', '/og/cipher-fortune.png'];
  try {
    for (const pathname of paths) {
      const res = await fetch('http://127.0.0.1:' + port + pathname);
      assert.equal(res.status, 200, pathname + ' ' + res.status);
      await res.arrayBuffer();
    }
    const missing = await fetch('http://127.0.0.1:' + port + '/go/evil?url=https://evil.example');
    assert.equal(missing.status, 404);
    await missing.arrayBuffer();
    const hopped = await fetch('http://127.0.0.1:' + port + '/go/kraken?url=https://evil.example');
    assert.equal(hopped.status, 200);
    const hoppedHtml = await hopped.text();
    assert.equal(hoppedHtml.includes('evil.example'), false);
    assert.match(hoppedHtml, /invite\.kraken\.com\/JDNW\/bkxtyuas/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
