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
  mergeArchive,
  isDexRow,
  judgeListedPage,
  slimListedCoin,
  LISTED_MIN_VOLUME,
  HTML_DEX_PREVIEW,
} = require('../universe');
const { spotlightOk, isUnlisted, staticCanon } = require('../quality');
const { loadDexUniverse, resetDexMemory, gtJobs, combineDex, jobsForRotation } = require('../lib/dex');
const { renderMoversPageFrom, coinSitemapXml } = require('../lib/movers');
const { slimCoin, publicBoot, renderHomeHtml, resetBootMemory } = require('../lib/boot');
const { planTail, stepListedTail, tailCoins, emptyTail, resetListedMemory } = require('../lib/listed');
const { ttlFor } = require('../lib/coingecko');

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
  fresh.total_volume = 250;
  fresh.reserve_usd = 1500;
  const dust = normalizeDexList([{ chainId: 'bsc', tokenAddress: '0x4444444444444444444444444444444444444444', description: 'DUST' }], 'profiles_latest')[0];
  const universe = mergeUniverse([
    { id: 'pepe', symbol: 'PEPE', name: 'Pepe', total_volume: 1000, current_price: 1, market_cap: 10 },
    { id: 'pepe', symbol: 'PEPE', name: 'Pepe again', total_volume: 1000 },
  ], [gt, thin, fresh, dust]);
  assert.equal(universe[0].source, 'coingecko');
  assert.equal(universe[0].listed, true);
  assert.equal(universe.filter((row) => row.cgId === 'pepe').length, 0);
  assert.equal(universe.some((row) => row.symbol === 'FRESH' && row.chain === 'base'), true);
  assert.equal(universe.some((row) => row.symbol === 'DUST'), false);
  assert.equal(universe.length, 2);
});

test('dust pools are dropped and a boosted ticker still needs the floor', () => {
  const dust = normalizeGtPayload(gtPayload({ volume: '0.9', reserve: '100' }), 'new_pools')[0];
  assert.equal(acceptDexRow(dust), false);
  const zero = normalizeGtPayload(gtPayload({ volume: '0', reserve: '0' }), 'new_pools')[0];
  assert.equal(acceptDexRow(zero), false);
  const liquid = normalizeGtPayload(gtPayload({ volume: '0.9', reserve: '2500' }), 'new_pools')[0];
  assert.equal(acceptDexRow(liquid), true);
  const traded = normalizeGtPayload(gtPayload({ volume: '100', reserve: '10' }), 'new_pools')[0];
  assert.equal(acceptDexRow(traded), true);
  const boost = normalizeDexList([{ chainId: 'bsc', tokenAddress: '0x2222222222222222222222222222222222222222', description: 'MOON' }], 'boosts_latest')[0];
  assert.equal(acceptDexRow(boost), false);
  applyDexPair(boost, {
    baseToken: { symbol: 'MOON', name: 'Moon' },
    priceUsd: '0.02',
    volume: { h24: 180 },
    liquidity: { usd: 50 },
  });
  assert.equal(acceptDexRow(boost), true);
  const rows = [];
  for (let i = 0; i < 120; i += 1) {
    const address = '0x' + i.toString(16).padStart(40, 'a');
    const row = normalizeDexList([{ chainId: 'ethereum', tokenAddress: address, description: 'T' + i }], 'boosts_latest')[0];
    row.total_volume = 150 + i;
    row.current_price = 0.01;
    rows.push(row);
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
  assert.equal(spotlightOk({
    id: 'tiny-listed',
    symbol: 'TINY',
    name: 'Tiny Listed',
    current_price: 0.02,
    market_cap: 2e6,
    total_volume: 150,
    source: 'coingecko',
    listed: true,
  }, canon), false);
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
    if (url.includes('tokens/v1/base/')) {
      return {
        ok: true,
        status: 200,
        json: [{
          baseToken: { address: '0x3333333333333333333333333333333333333333', symbol: 'BASEDOG', name: 'Base Dog' },
          priceUsd: '0.1',
          volume: { h24: 4200 },
          liquidity: { usd: 9000 },
          priceChange: { h24: 5 },
        }],
      };
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
  const replaced = combineDex(
    { rows: dex.rows, rotation: { coreCursor: 0, extraCursor: 0 } },
    { rows: dex.rows.slice(0, 1), rateLimited: false, partial: false, rotation: { coreCursor: 4, extraCursor: 1 } },
    7000
  );
  assert.ok(replaced.rows.length >= dex.rows.length);
  assert.equal(replaced.rotation.coreCursor, 4);
  resetDexMemory();
});

test('archive merge keeps qualifying rows, hides dust, and expires quiet names', () => {
  const quietMs = 1000;
  const keep = normalizeGtPayload(gtPayload({ symbol: 'KEEP', volume: '5000', reserve: '8000' }), 'new_pools')[0];
  const other = normalizeGtPayload(gtPayload({
    symbol: 'OTHER',
    volume: '900',
    reserve: '2000',
    address: '8Ta3etGdsGFfSaqJEji98zb8u6Wua8TjCFJFRKrpump',
  }), 'trending_pools')[0];
  const first = mergeArchive([keep], [other], 10_000, { quietMs: quietMs });
  assert.equal(first.visible.length, 2);
  assert.ok(first.visible.some((row) => row.symbol === 'KEEP'));
  assert.ok(first.visible.some((row) => row.symbol === 'OTHER'));
  const partial = mergeArchive(first.rows, [], 10_000 + 400, { quietMs: quietMs });
  assert.equal(partial.visible.length, 2);
  const faded = normalizeGtPayload(gtPayload({ symbol: 'KEEP', volume: '0', reserve: '20' }), 'new_pools')[0];
  const quiet = mergeArchive(first.rows, [faded], 10_000 + 400, { quietMs: quietMs });
  assert.equal(quiet.visible.some((row) => row.symbol === 'KEEP'), false);
  assert.equal(quiet.held.some((row) => row.symbol === 'KEEP'), true);
  assert.equal(quiet.visible.some((row) => row.symbol === 'OTHER'), true);
  const expired = mergeArchive(quiet.rows, [], 10_000 + 400 + quietMs, { quietMs: quietMs });
  assert.equal(expired.rows.some((row) => row.symbol === 'KEEP'), false);
  assert.equal(expired.visible.some((row) => row.symbol === 'OTHER'), false);
  const stale = mergeArchive([{
    id: keep.id,
    symbol: 'KEEP',
    name: 'Jean Phil',
    chain: 'sol',
    chainName: 'Solana',
    address: keep.address,
    checkPath: keep.checkPath,
    source: 'geckoterminal',
    total_volume: 5000,
    reserve_usd: 8000,
    current_price: 0.01,
    seenAt: 10_000,
    firstSeen: 10_000,
  }], [], 10_000 + quietMs, { quietMs: quietMs });
  assert.equal(stale.rows.length, 0);
});

test('listed cutoff is $100 and extra pages stop and stay cached', async () => {
  assert.equal(LISTED_MIN_VOLUME, 100);
  assert.equal(slimListedCoin({ id: 'alive', symbol: 'ALIVE', name: 'Alive', total_volume: 100, current_price: 1, market_cap: 1 }).total_volume, 100);
  const kept = slimCoin({ id: 'alive', symbol: 'ALIVE', name: 'Alive', total_volume: 100, current_price: 1, market_cap: 1000 });
  assert.equal(kept && kept.id, 'alive');
  assert.equal(slimCoin({ id: 'dust', total_volume: 99 }), null);
  assert.equal(slimCoin({ id: 'zero', total_volume: 0 }), null);
  assert.equal(slimCoin({ id: 'blank', total_volume: null }), null);
  const full = [];
  for (let i = 0; i < 250; i += 1) full.push({ id: 'c' + i, total_volume: 5000 - i, current_price: 1 });
  assert.equal(judgeListedPage(full).stop, false);
  const dying = full.slice();
  dying[249] = { id: 'last', total_volume: 40, current_price: 1 };
  const verdict = judgeListedPage(dying);
  assert.equal(verdict.stop, true);
  assert.equal(verdict.minVolume, 40);
  assert.equal(slimListedCoin(dying[249]), null);
  assert.equal(slimListedCoin(dying[0]).id, 'c0');

  resetListedMemory();
  const calls = [];
  const fetchPage = async (page) => {
    calls.push(page);
    if (page >= 4) {
      return [
        { id: 'low-' + page, symbol: 'LOW', name: 'Low', total_volume: 40, current_price: 1, market_cap: 10 },
        { id: 'ok-' + page, symbol: 'OK', name: 'Ok', total_volume: 180, current_price: 1, market_cap: 10 },
      ];
    }
    const rows = [];
    for (let i = 0; i < 250; i += 1) {
      rows.push({
        id: 'p' + page + '-' + i,
        symbol: 'P' + page,
        name: 'Page ' + page,
        total_volume: 1000 + page,
        current_price: 1,
        market_cap: 5000,
      });
    }
    return rows;
  };
  const now = 1_700_000_000_000;
  const cold = await stepListedTail(null, fetchPage, now);
  assert.deepEqual(calls, [2, 3, 4]);
  assert.equal(cold.state.stopped, true);
  assert.equal(cold.calls, 3);
  assert.ok(tailCoins(cold.state).some((coin) => coin.id === 'ok-4'));
  assert.equal(tailCoins(cold.state).some((coin) => coin.id === 'low-4'), false);
  assert.equal(tailCoins(cold.state).some((coin) => String(coin.id).startsWith('dex-')), false);
  const held = await stepListedTail(cold.state, fetchPage, now + 60 * 60 * 1000);
  assert.equal(held.calls, 0);
  assert.equal(calls.length, 3);
  assert.equal(planTail(cold.state, now + 60 * 60 * 1000).reason, 'hold');
  const again = planTail(cold.state, cold.state.holdUntil + 1);
  assert.equal(again.restart, true);
  assert.equal(again.pages, 1);
  assert.equal(ttlFor('coins/markets', { category: 'meme-token', order: 'volume_desc', page: '1' }), 60 * 60 * 1000);
  assert.equal(ttlFor('coins/markets', { category: 'meme-token', order: 'volume_desc', page: '2' }), 10 * 60 * 60 * 1000);
  const early = planTail(emptyTail(now), now);
  assert.equal(early.reason, 'cold');
  assert.equal(early.pages, 4);
});

test('homepage boot stays small and the sitemap skips unlisted ids', () => {
  resetBootMemory();
  const dex = [];
  for (let i = 0; i < 40; i += 1) {
    const address = '0x' + i.toString(16).padStart(40, 'b');
    dex.push({
      id: 'dex-eth-' + address,
      symbol: 'D' + i,
      name: 'Dex ' + i,
      chain: 'eth',
      address: address,
      source: 'geckoterminal',
      listed: false,
      total_volume: 200 + i,
      current_price: 0.1,
      market_cap: 0,
    });
  }
  const html = renderHomeHtml({
    updatedAt: '2026-11-05T12:00:00.000Z',
    coins: [slimCoin({ id: 'pepe', symbol: 'pepe', name: 'Pepe', total_volume: 5000, current_price: 1, market_cap: 10 })],
    tail: [slimCoin({ id: 'tail-coin', symbol: 'tail', name: 'Tail', total_volume: 150, current_price: 1, market_cap: 10 })],
    dex: dex,
  });
  const match = html.match(/window\.__CIPHER_BOOT__=(.*?)<\/script>/);
  assert.ok(match);
  const payload = JSON.parse(match[1].replace(/;$/, ''));
  assert.equal(payload.dex.length, HTML_DEX_PREVIEW);
  assert.equal(payload.coins.some((coin) => coin.id === 'tail-coin'), false);
  assert.equal(payload.coins.some((coin) => coin.id === 'pepe'), true);
  const body = publicBoot({
    ok: true,
    coins: [slimCoin({ id: 'pepe', symbol: 'pepe', name: 'Pepe', total_volume: 5000, current_price: 1, market_cap: 10 })],
    tail: [slimCoin({ id: 'tail-coin', symbol: 'tail', name: 'Tail', total_volume: 150, current_price: 1, market_cap: 10 })],
    dex: dex,
    held: [{ id: 'quiet', total_volume: 0 }],
  });
  assert.equal(body.coins.length, 2);
  assert.equal(body.held, undefined);
  assert.equal(body.tail, undefined);
  assert.equal(body.counts.coingecko, 2);
  assert.equal(body.counts.onchain, 40);
  assert.equal(body.counts.total, 42);
  const xml = coinSitemapXml({
    ok: true,
    updatedAt: '2026-11-05T00:00:00.000Z',
    coins: [{ id: 'pepe' }, { id: 'dex-sol-' + MINT }, { id: 'tail-coin' }],
  });
  assert.match(xml, /\/coin\/pepe/);
  assert.match(xml, /\/coin\/tail-coin/);
  assert.equal(xml.includes('dex-sol'), false);
  const first = jobsForRotation({ coreCursor: 0, extraCursor: 0 });
  const second = jobsForRotation({ coreCursor: 4, extraCursor: 1 });
  assert.equal(first.jobs.length, 8);
  assert.notDeepEqual(first.jobs.map((job) => job.url), second.jobs.map((job) => job.url));
  assert.ok(first.jobs.some((job) => job.url && job.url.includes('page=2')) || first.jobs.some((job) => job.url && job.url.includes('/arbitrum/')));
  assert.ok(second.jobs.some((job) => String(job.url || '').includes('/arbitrum/') || String(job.url || '').includes('page=2')));
});
