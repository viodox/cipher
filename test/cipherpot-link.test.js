'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { cipherpotHref, normalizeCipherpotChain, renderScanPage } = require('../lib/pages');

const SOL = 'J1D3X8znX4AzUPMHVWyBLNHqBBqWDPN5jX4KwK3Qpump';
const ETH = '0x6982508145454ce325ddbe47a25d4ec3d2311933';

test('scan cards deep-link CipherPot with the chain, contract, and symbol', () => {
  const html = renderScanPage({
    stamp: 'CLEAN',
    symbol: 'PUMP',
    name: 'Example',
    chain: 'sol',
    chainName: 'Solana',
    address: SOL,
    buyTax: 0,
    sellTax: 0,
    liquidityUsd: 100000,
    riskScore: 12,
    reasons: [],
    sources: ['RugCheck'],
    checks: {},
    updatedAt: '2026-11-02T00:00:00.000Z',
  });
  const href = cipherpotHref('sol', SOL, 'PUMP');
  assert.equal(normalizeCipherpotChain('solana'), 'sol');
  assert.equal(normalizeCipherpotChain('eth'), '1');
  assert.ok(html.includes('id="open-cipherpot" href="' + href.replace(/&/g, '&amp;') + '"'));
  assert.ok(href.includes('chain=sol'));
  assert.ok(href.includes('address=' + SOL));
  assert.ok(href.includes('symbol=PUMP'));
  assert.equal(html.includes('href="/cipherpot"'), false);
});

test('an ethereum scan uses the CipherPot chain value', () => {
  const href = cipherpotHref('eth', ETH, 'PEPE');
  assert.equal(href, '/cipherpot?chain=1&address=' + ETH + '&symbol=PEPE');
});

test('the cipherpot page reads chain and address on load', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(index, /function readCipherpotParams\(/);
  assert.match(index, /function applyCipherpotDeepLink\(/);
  assert.match(index, /if\(path==='\/cipherpot'\) applyCipherpotDeepLink\(\)/);
  assert.match(index, /coin\._chainId/);
  assert.match(index, /document\.getElementById\('cp-chain'\)\.value=chain/);
});
