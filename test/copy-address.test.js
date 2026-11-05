'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { copyAddressHtml, shortAddress } = require('../lib/copy-address');
const { renderGrade } = require('../lib/ape-page');
const { renderScanPage } = require('../lib/pages');
const { renderComparePage } = require('../lib/compare');
const { renderSmartMoneyPage, resetSmartMoneyMemory } = require('../lib/smart-money');
const { renderFortunePage } = require('../lib/fortune');
const { boardRowsHtml } = require('../lib/board');
const { shell } = require('../lib/chrome');

const ETH = '0x6982508145454ce325ddbe47a25d4ec3d2311933';

test('copy chip keeps the full address and a keyboard button', () => {
  const html = copyAddressHtml(ETH, { label: 'Copy contract address' });
  assert.match(html, new RegExp('data-copy-address="' + ETH + '"'));
  assert.match(html, new RegExp('data-address="' + ETH + '"'));
  assert.match(html, new RegExp('>' + ETH + '<'));
  assert.match(html, /<button type="button"/);
  assert.match(html, /aria-label="Copy contract address"/);
  assert.equal(shortAddress(ETH), '0x6982…1933');
  const quoted = copyAddressHtml('0x' + 'a'.repeat(40) + '" onclick');
  assert.equal(quoted.includes('" onclick'), false);
  assert.match(quoted, /&quot;/);
});

test('shell, homepage, scan, grade, compare, fortune, and smart money share the control', async () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'templates', 'home.html'), 'utf8');
  assert.match(home, /function copyAddrHtml\(/);
  assert.match(home, /window\.__cipherCopyAddress/);
  assert.match(home, /toast\('Copied'\)/);
  const wrapped = shell({ title: 't', description: 'd', heading: 'h', body: copyAddressHtml(ETH, { full: true }) });
  assert.match(wrapped, /window\.__cipherCopyAddress/);
  assert.match(wrapped, /\.ca-toast\{/);
  assert.match(wrapped, new RegExp(ETH));

  const grade = renderGrade({
    chain: 'eth',
    chainName: 'Ethereum',
    address: ETH,
    symbol: 'PEPE',
    name: 'Pepe',
    score: 80,
    letter: 'B',
    priceUsd: null,
    logo: '',
    verdicts: ['Clean enough.'],
    checks: [],
    exchanges: [],
  }).html;
  assert.match(grade, new RegExp('data-copy-address="' + ETH + '"'));
  assert.match(grade, /Copy contract address/);

  const scan = renderScanPage({
    stamp: 'CLEAN',
    symbol: 'PEPE',
    name: 'Pepe',
    chain: 'eth',
    chainName: 'Ethereum',
    address: ETH,
    buyTax: 0,
    sellTax: 0,
    liquidityUsd: 1,
    riskScore: 1,
    reasons: [],
    sources: ['GoPlus'],
    checks: { dexUrl: 'https://dexscreener.com/ethereum/' + ETH },
    updatedAt: '2026-11-05T00:00:00.000Z',
  });
  assert.match(scan, new RegExp('data-copy-address="' + ETH + '"'));
  assert.match(scan, /dexscreener\.com\/ethereum\//);
  assert.match(scan, /id="open-cipherpot"/);

  const compared = await renderComparePage({ a: 'eth:' + ETH, b: 'eth:0x1111111111111111111111111111111111111111' }, {
    grade: async (chain, address) => ({
      ok: true,
      chain,
      address,
      chainName: 'Ethereum',
      symbol: 'PEPE',
      name: 'Pepe',
      letter: 'A',
      score: 90,
      checks: [],
      verdicts: ['Clean receipt.'],
    }),
  });
  assert.match(compared.html, new RegExp('data-copy-address="' + ETH + '"'));
  assert.match(compared.html, /full receipt/);

  const fortune = renderFortunePage({
    dayKey: '2026-11-05',
    winnerSlot: 0,
    poolSize: 1,
    segments: [{ id: 'pepe', symbol: 'PEPE', address: ETH, chain: 'eth' }],
    winner: {
      id: 'pepe',
      symbol: 'PEPE',
      name: 'Pepe',
      address: ETH,
      chain: 'eth',
      href: '/coin/pepe',
      notes: [],
      line: 'A line',
    },
  }, { revealed: true }).html;
  assert.match(fortune, new RegExp('data-copy-address="' + ETH + '"'));
  assert.equal(fortune.includes('0x6982…1933'), false);

  resetSmartMoneyMemory();
  const smart = renderSmartMoneyPage({
    ok: true,
    updatedAt: '2026-11-05T12:00:00.000Z',
    wallets: [{ id: 'ansem', name: 'Ansem', kind: 'trader', why: 'Public.', chains: ['sol'] }],
    buys: [{
      walletId: 'ansem',
      walletName: 'Ansem',
      chain: 'sol',
      tokenAddress: ETH,
      symbol: 'WIF',
      amount: 1,
      usd: 500,
      side: 'swap',
      ts: Date.parse('2026-11-05T11:50:00Z'),
      tx: 'sig',
      letter: 'B',
      ago: '10m ago',
      checkHref: '/check/sol/' + ETH,
    }],
  }).html;
  assert.match(smart, new RegExp('data-copy-address="' + ETH + '"'));
  assert.match(smart, /solscan\.io\/tx\/sig/);
  assert.match(smart, /Ape Check/);

  const board = boardRowsHtml([{
    href: '/check/eth/' + ETH,
    letter: 'A',
    symbol: 'PEPE',
    name: 'Pepe',
    chain: 'eth',
    address: ETH,
    change24h: 1,
  }]);
  assert.match(board, /class="graded-row"/);
  assert.match(board, new RegExp('data-copy-address="' + ETH + '"'));
  assert.ok(board.indexOf('graded-row') < board.indexOf('data-copy-address'));
});
