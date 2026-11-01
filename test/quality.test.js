'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { spotlightOk, isImpostor, staticCanon, canonFromMarkets } = require('../quality');

const canon = staticCanon();

test('a fake BITCOIN with a hex symbol is not spotlight material', () => {
  const fake = {
    id: 'bitcoin-f7931a',
    symbol: 'F7931A',
    name: 'BITCOIN',
    current_price: 0.000279,
    market_cap: 259000,
    total_volume: 180000,
  };
  assert.equal(isImpostor(fake, canon), true);
  assert.equal(spotlightOk(fake, canon), false);
});

test('the real bitcoin and pepe ids pass', () => {
  assert.equal(spotlightOk({
    id: 'bitcoin',
    symbol: 'btc',
    name: 'Bitcoin',
    current_price: 67000,
    market_cap: 1.3e12,
    total_volume: 3e10,
  }, canon), true);
  assert.equal(spotlightOk({
    id: 'pepe',
    symbol: 'PEPE',
    name: 'Pepe',
    price: 0.000004,
    marketCap: 2.1e9,
    volume: 3e8,
  }, canon), true);
});

test('a lookalike ticker is dropped even with a large cap', () => {
  const lookalike = {
    id: 'pepe-2-0',
    symbol: 'PEPE',
    name: 'Pepe 2.0',
    current_price: 0.01,
    market_cap: 5e6,
    total_volume: 2e6,
  };
  assert.equal(isImpostor(lookalike, canon), true);
  assert.equal(spotlightOk(lookalike, canon), false);
});

test('a small unique meme fails the sanity floor', () => {
  assert.equal(spotlightOk({
    id: 'normie-6',
    symbol: 'NORMIE',
    name: 'Normie',
    current_price: 0.008,
    market_cap: 259000,
    total_volume: 180000,
  }, canon), false);
});

test('live top-100 rows extend the book without replacing a major', () => {
  const book = canonFromMarkets([
    { id: 'not-bitcoin', symbol: 'btc', name: 'Bitcoin' },
    { id: 'hyperliquid', symbol: 'hype', name: 'Hyperliquid' },
  ]);
  assert.equal(book.symbols.BTC, 'bitcoin');
  assert.equal(book.symbols.HYPE, 'hyperliquid');
  assert.equal(isImpostor({ id: 'hyperliquid-inu', symbol: 'HYPE', name: 'Hype Inu' }, book), true);
});
