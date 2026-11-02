'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { normalizeChain } = require('../lib/chains');
const { factsFromFeeds, checkToken, resetApeMemory } = require('../lib/ape');
const { gradeFacts } = require('../lib/grade');
const { renderApeCard } = require('../lib/og');

const PEPE = '0x6982508145454ce325ddbe47a25d4ec3d2311933';

function pepeGoPlus(overrides) {
  return Object.assign({
    token_name: 'Pepe',
    token_symbol: 'PEPE',
    is_honeypot: '0',
    cannot_sell_all: '0',
    is_mintable: '0',
    owner_address: '0x0000000000000000000000000000000000000000',
    buy_tax: '0',
    sell_tax: '0',
    holders: [{ percent: '0.12' }, { percent: '0.08' }],
    lp_holders: [
      { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', percent: '0.993', is_locked: '0' },
      { address: '0x000000000000000000000000000000000000dead', percent: '0.00009', is_locked: '1' },
    ],
    dex: [{ liquidity: '15700000' }],
  }, overrides || {});
}

function pepeDex() {
  return {
    pairs: [{
      chainId: 'ethereum',
      baseToken: { symbol: 'PEPE', name: 'Pepe' },
      priceUsd: '0.000007',
      priceChange: { h24: -1.59 },
      liquidity: { usd: 15000000 },
      pairCreatedAt: 1681492871000,
    }],
  };
}

test('a PEPE-like receipt loses points only for unlocked LP and stays at B or better', () => {
  const parsed = factsFromFeeds(normalizeChain('eth'), pepeGoPlus(), pepeDex(), Date.now());
  assert.equal(parsed.facts.honeypot, false);
  assert.equal(parsed.facts.lpLockedOrBurned, false);
  assert.equal(parsed.facts.buyTax, 0);
  assert.ok(parsed.facts.liquidityUsd > 10000);
  assert.ok(parsed.facts.ageHours > 24);
  const grade = gradeFacts(parsed.facts, 'eth|' + PEPE);
  assert.equal(grade.score, 85);
  assert.equal(grade.letter, 'B');
  assert.equal(grade.verdicts.join(' ').toLowerCase().includes('scam'), false);
});

test('a honeypot flag is an automatic F', () => {
  const parsed = factsFromFeeds(normalizeChain('eth'), pepeGoPlus({ is_honeypot: '1' }), pepeDex(), Date.now());
  const grade = gradeFacts(parsed.facts, 'seed');
  assert.equal(grade.letter, 'F');
  assert.equal(grade.autoF, true);
});

test('a cached check does not call GoPlus again', async () => {
  process.env.APE_STORE = 'memory';
  resetApeMemory();
  let goplusHits = 0;
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes('gopluslabs.io')) goplusHits += 1;
    const body = target.includes('gopluslabs.io')
      ? { code: 1, result: { [PEPE]: pepeGoPlus() } }
      : target.includes('dexscreener.com')
        ? pepeDex()
        : { id: 'pepe', symbol: 'pepe', name: 'Pepe', image: {}, market_data: { current_price: { usd: 0.000007 } }, tickers: [] };
    const text = JSON.stringify(body);
    return { ok: true, status: 200, text: async () => text };
  };
  try {
    const first = await checkToken('eth', PEPE);
    const second = await checkToken('eth', PEPE);
    assert.equal(first.ok, true);
    assert.equal(first.letter, 'B');
    assert.equal(second.cached, true);
    assert.equal(second.letter, first.letter);
    assert.equal(goplusHits, 1);
    const png = renderApeCard(first, '');
    assert.ok(Buffer.isBuffer(png));
    assert.ok(png.length > 1000);
  } finally {
    global.fetch = realFetch;
    resetApeMemory();
  }
});
