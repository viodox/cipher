'use strict';

const assert = require('assert');
const { test } = require('node:test');
const {
  normalizeGtPayload,
  normalizeDexList,
  applyDexPair,
  dedupeRows,
  acceptDexRow,
  finalizeDexList,
  mergeUniverse,
  isDexRow,
} = require('../universe');
const { spotlightOk, isUnlisted, staticCanon } = require('../quality');
const { loadDexUniverse, resetDexMemory, gtJobs, combineDex } = require('../lib/dex');
const { renderMoversPageFrom } = require('../lib/movers');

const canon = staticCanon();
const MINT = '9Ta3etGdsGFfSaqJEji98zb8u6Wua8TjCFJFRKrpump';
const ETH = '0x6982508145454ce325ddbe47a25d4ec3d2311933';

function gtPayload(opts) {
  const options = opts || {};
  const address = options.address || MINT;
  const symbol = options.symbol || 'JEANPHIL';
  const volume = options.volume == null ? '2500' : options.volume;
  const reserve = options.reserve == null ? '4000' : options.reserve;
  const network = options.network || 'solana';
  return {
    data: [{
      id: network + '_pool',
      type: 'pool',
      attributes: {
        name: symbol + ' / SOL',
        address: 'pooladdr',
        base_token_price_usd: options.price == null ? '0.01' : options.price,
        fdv_usd: '9000000',
        market_cap_usd: options.marketCap == null ? null : options.marketCap,
        price_change_percentage: { h24: options.change == null ? '12.5' : options.change },
        volume_usd: { h24: volume },
        reserve_in_usd: reserve,
      },
      relationships: {
        base_token: { data: { id: network + '_' + address, type: 'token' } },
      },
    }],
    included: [{
      id: network + '_' + address,
      type: 'token',
      attributes: {
        address: address,
        name: options.name || 'Jean Phil',
        symbol: symbol,
        image_url: 'https://example.com/token.png',
        coingecko_coin_id: options.cgId || null,
      },
    }],
  };
}

test('gecko terminal pools normalize without inventing a coingecko id', () => {
  const rows = normalizeGtPayload(gtPayload(), 'new_pools');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'geckoterminal');
  assert.equal(rows[0].chain, 'sol');
  assert.equal(rows[0].symbol, 'JEANPHIL');
  assert.equal(rows[0].address, MINT);
  assert.equal(rows[0].checkPath, '/check/sol/' + MINT);
  assert.equal(rows[0].listed, false);
  assert.equal(rows[0].cgId, null);
  assert.equal(rows[0].id, 'dex-sol-' + MINT);
  assert.equal(rows[0].current_price, 0.01);
  assert.equal(rows[0].total_volume, 2500);
  assert.equal(rows[0].price_change_percentage_24h, 12.5);
  assert.equal(rows[0].market_cap, 0);
  assert.equal(rows[0].image, 'https://example.com/token.png');
  const listed = normalizeGtPayload(gtPayload({ cgId: 'jean-phil', marketCap: '120000' }), 'trending_pools');
  assert.equal(listed[0].cgId, 'jean-phil');
  assert.equal(listed[0].market_cap, 120000);
  assert.equal(listed[0].id.startsWith('dex-sol-'), true);
  assert.notEqual(listed[0].id, 'jean-phil');
});

test('quote assets and unknown networks are dropped', () => {
  const quote = normalizeGtPayload(gtPayload({ symbol: 'SOL', name: 'Solana' }), 'new_pools');
  assert.equal(quote.length, 0);
  const odd = normalizeGtPayload(gtPayload({ network: 'tron', address: 'TXYZ' }), 'new_pools');
  assert.equal(odd.length, 0);
});

test('dexscreener lists normalize and pairs fill price', () => {
  const rows = normalizeDexList([
    { chainId: 'ethereum', tokenAddress: ETH, description: 'PEPE', icon: 'not-a-url' },
    { chainId: 'tron', tokenAddress: 'nope', description: 'NOPE' },
    { chainId: 'solana', tokenAddress: MINT, description: 'a long sentence about a coin' },
  ], 'boosts_latest');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, 'dexscreener');
  assert.equal(rows[0].chain, 'eth');
  assert.equal(rows[0].symbol, 'PEPE');
  assert.equal(rows[0].image, '');
  assert.equal(rows[0].checkPath, '/check/eth/' + ETH);
  assert.equal(rows[1].symbol, '');
  applyDexPair(rows[1], {
    baseToken: { address: MINT, symbol: 'JEAN', name: 'Jean Phil' },
    priceUsd: '0.2',
    volume: { h24: 800 },
    priceChange: { h24: -3 },
    marketCap: 50000,
    liquidity: { usd: 12000 },
  });
  assert.equal(rows[1].symbol, 'JEAN');
  assert.equal(rows[1].current_price, 0.2);
  assert.equal(rows[1].total_volume, 800);
  assert.equal(rows[1].reserve_usd, 12000);
});

test('dedupe keeps the richer row and merge drops listed coingecko ids', () => {
  const gt = normalizeGtPayload(gtPayload({ cgId: 'pepe', volume: '9000', price: '0.00001' }), 'trending_pools')[0];
  const thin = normalizeDexList([{ chainId: 'solana', tokenAddress: MINT, description: 'JEAN' }], 'boosts_top')[0];
  const mergedDupes = dedupeRows([thin, gt]);
  assert.equal(mergedDupes.length, 1);
  assert.equal(mergedDupes[0].source, 'geckoterminal');
  assert.equal(mergedDupes[0].cgId, 'pepe');
  const fresh = normalizeDexList([{ chainId: 'base', tokenAddress: '0x1111111111111111111111111111111111111111', description: 'FRESH' }], 'profiles_latest')[0];
  const universe = mergeUniverse([
    { id: 'pepe', symbol: 'PEPE', name: 'Pepe', total_volume: 1000, current_price: 1, market_cap: 10 },
    { id: 'pepe', symbol: 'PEPE', name: 'Pepe again', total_volume: 1000 },
  ], [gt, thin, fresh]);
  assert.equal(universe[0].source, 'coingecko');
  assert.equal(universe[0].listed, true);
  assert.equal(universe.filter((row) => row.cgId === 'pepe').length, 0);
  assert.equal(universe.some((row) => row.symbol === 'FRESH' && row.chain === 'base'), true);
  assert.equal(universe.length, 2);
});

test('dust pools are dropped and boosted names with a ticker are kept', () => {
  const dust = normalizeGtPayload(gtPayload({ volume: '0.9', reserve: '100' }), 'new_pools')[0];
  assert.equal(acceptDexRow(dust), false);
  const liquid = normalizeGtPayload(gtPayload({ volume: '0.9', reserve: '2500' }), 'new_pools')[0];
  assert.equal(acceptDexRow(liquid), true);
  const boost = normalizeDexList([{ chainId: 'bsc', tokenAddress: '0x2222222222222222222222222222222222222222', description: 'MOON' }], 'boosts_latest')[0];
  assert.equal(acceptDexRow(boost), true);
  const rows = [];
  for (let i = 0; i < 120; i += 1) {
    const address = '0x' + i.toString(16).padStart(40, 'a');
    rows.push(normalizeDexList([{ chainId: 'ethereum', tokenAddress: address, description: 'T' + i }], 'boosts_latest')[0]);
  }
  const capped = finalizeDexList(rows, 30);
  assert.equal(capped.length, 30);
});

test('spotlight ignores raw unlisted junk and still accepts a real listed coin', () => {
  const junk = {
    id: 'dex-sol-' + MINT,
    source: 'geckoterminal',
    listed: false,
    symbol: 'NEW',
    name: 'Brand New Rug',
    current_price: 1,
    market_cap: 5e7,
    total_volume: 2e6,
    chain: 'sol',
    address: MINT,
  };
  assert.equal(isDexRow(junk), true);
  assert.equal(isUnlisted(junk), true);
  assert.equal(spotlightOk(junk, canon), false);
  assert.equal(spotlightOk({
    id: 'pepe',
    symbol: 'PEPE',
    name: 'Pepe',
    current_price: 0.00001,
    market_cap: 2e9,
    total_volume: 3e8,
    source: 'coingecko',
    listed: true,
  }, canon), true);
});

test('a 429 backs off and does not call upstream again', async () => {
  resetDexMemory();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 429, json: null };
  };
  const first = await loadDexUniverse({ fetchImpl, now: 1000, budgetMs: 5000 });
  assert.equal(first.rows.length, 0);
  assert.equal(first.rateLimited, true);
  const after = calls;
  assert.ok(after > 0);
  assert.ok(after <= gtJobs().length + 3);
  const second = await loadDexUniverse({ fetchImpl, now: 2000 });
  assert.equal(calls, after);
  assert.equal(second.rateLimited, true);
  resetDexMemory();
});

test('a gecko payload becomes scanner rows and movers keeps fresh names off the ranked board', async () => {
  resetDexMemory();
  const payload = gtPayload({ symbol: 'NEW', name: 'New Pool', volume: '1800', change: '40' });
  const fetchImpl = async (url) => {
    if (url.includes('/networks/solana/new_pools')) return { ok: true, status: 200, json: payload };
    if (url.includes('token-boosts/latest')) {
      return { ok: true, status: 200, json: [{ chainId: 'base', tokenAddress: '0x3333333333333333333333333333333333333333', description: 'BASEDOG' }] };
    }
    return { ok: true, status: 200, json: { data: [], included: [] } };
  };
  const dex = await loadDexUniverse({ fetchImpl, now: 5000, budgetMs: 5000, force: true });
  assert.ok(dex.rows.some((row) => row.symbol === 'NEW' && row.chain === 'sol' && row.source === 'geckoterminal'));
  assert.ok(dex.rows.some((row) => row.symbol === 'BASEDOG' && row.chain === 'base' && row.source === 'dexscreener'));
  assert.equal(dex.counts.geckoterminal >= 1, true);
  assert.equal(dex.counts.dexscreener >= 1, true);
  const html = renderMoversPageFrom({
    ok: true,
    source: 'meme-token',
    updatedAt: '2026-11-05T12:00:00.000Z',
    universe: 1,
    note: 'note',
    gainers: [],
    losers: [],
    volumeSpikes: [],
    fresh: [{
      symbol: 'NEW',
      name: 'New Pool',
      chain: 'sol',
      chainName: 'Solana',
      href: '/check/sol/' + MINT,
      price: 0.01,
      change24h: 40,
      volume: 1800,
      source: 'geckoterminal',
    }],
    coins: [],
  }).html;
  assert.match(html, /fresh on-chain/);
  assert.match(html, /GeckoTerminal/);
  assert.match(html, /\/check\/sol\//);
  assert.match(html, /not CoinGecko listings/);
  const kept = combineDex(
    { rows: dex.rows },
    { rows: dex.rows.slice(0, 1), rateLimited: true, partial: true },
    6000
  );
  assert.ok(kept.rows.length >= dex.rows.length);
  assert.equal(kept.rateLimited, true);
  resetDexMemory();
});
