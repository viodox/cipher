'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, test, beforeEach, afterEach } = require('node:test');
const { clearProxyCache, proxyCoinGeckoJson, ttlFor } = require('../lib/coingecko');
const { renderCoinHtml, renderCoinPage, loadCoin } = require('../lib/coin');
const { renderScanPage } = require('../lib/pages');
const { renderGrade, renderApeRoute } = require('../lib/ape-page');
const { checkToken, resetApeMemory } = require('../lib/ape');
const { coinSitemapXml } = require('../lib/movers');
const { CACHE_KEY } = require('../lib/boot');

const ROOT = path.join(__dirname, '..');
const PEPE = '0x6982508145454ce325ddbe47a25d4ec3d2311933';

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.body = payload; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

function jsonResponse(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

function installFetch(onUpstream) {
  const kv = new Map();
  process.env.KV_REST_API_URL = 'https://kv.test';
  process.env.KV_REST_API_TOKEN = 'test-token';
  process.env.COINGECKO_API_KEY = 'server-key';
  const calls = [];
  global.fetch = async (url, opts) => {
    const href = String(url);
    if (href.startsWith('https://kv.test')) {
      const cmd = JSON.parse(opts.body);
      if (cmd[0] === 'GET') {
        return jsonResponse(200, { result: kv.has(cmd[1]) ? kv.get(cmd[1]) : null });
      }
      if (cmd[0] === 'SET' && cmd.includes('NX')) {
        if (kv.has(cmd[1])) return jsonResponse(200, { result: null });
        kv.set(cmd[1], cmd[2]);
        return jsonResponse(200, { result: 'OK' });
      }
      if (cmd[0] === 'SET') {
        kv.set(cmd[1], cmd[2]);
        return jsonResponse(200, { result: 'OK' });
      }
      return jsonResponse(200, { result: null });
    }
    calls.push(href);
    return onUpstream(href, opts);
  };
  return { kv, calls };
}

function ageShared(kv, ms) {
  for (const [key, value] of kv) {
    if (!String(key).startsWith('cg:v1:')) continue;
    const parsed = JSON.parse(value);
    parsed.at = Date.now() - ms;
    kv.set(key, JSON.stringify(parsed));
  }
}

function pepeGoPlus() {
  return {
    code: 1,
    result: {
      [PEPE]: {
        token_name: 'Pepe',
        token_symbol: 'PEPE',
        is_honeypot: '0',
        cannot_sell_all: '0',
        is_mintable: '0',
        owner_address: '0x0000000000000000000000000000000000000000',
        buy_tax: '0',
        sell_tax: '0',
        holders: [{ percent: '0.12' }],
        lp_holders: [{ address: '0x000000000000000000000000000000000000dead', percent: '0.6', is_locked: '1' }],
        dex: [{ liquidity: '15000000' }],
      },
    },
  };
}

function pepeDex(price) {
  return {
    pairs: [{
      chainId: 'ethereum',
      baseToken: { symbol: 'PEPE', name: 'Pepe' },
      priceUsd: price,
      priceChange: { h24: -1.2 },
      liquidity: { usd: 15000000 },
      pairCreatedAt: 1681492871000,
    }],
  };
}

function robotGroups(text) {
  const groups = [];
  let current = null;
  text.split(/\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!match) return;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      return;
    }
    if (!current) return;
    if (key === 'allow' || key === 'disallow') current.rules.push({ key, value });
  });
  return groups;
}

describe('coingecko quota guard', { concurrency: 1 }, () => {
  beforeEach(() => {
    clearProxyCache();
    resetApeMemory();
  });

  afterEach(() => {
    clearProxyCache();
    resetApeMemory();
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.COINGECKO_API_KEY;
    delete process.env.APE_STORE;
    delete global.fetch;
  });

  test('fresh windows stay long for pages and short for alert prices', () => {
    assert.equal(ttlFor('coins/markets', { category: 'meme-token', order: 'volume_desc', page: '1' }), 60 * 60 * 1000);
    assert.equal(ttlFor('simple/price', { ids: 'dogecoin', vs_currencies: 'usd' }), 10 * 60 * 1000);
    assert.equal(ttlFor('coins/vine', { localization: 'false' }), 6 * 60 * 60 * 1000);
    assert.equal(ttlFor('coins/ethereum/contract/0xabc', {}), 6 * 60 * 60 * 1000);
    assert.equal(ttlFor('coins/vine/market_chart', { vs_currency: 'usd', days: '7' }), 3 * 60 * 60 * 1000);
  });

  test('a shared fresh payload is reused across a cleared isolate', async () => {
    const { kv, calls } = installFetch(() => jsonResponse(200, { id: 'vine', symbol: 'vine' }));
    const first = await proxyCoinGeckoJson('coins/vine', { localization: 'false' });
    assert.equal(first.ok, true);
    assert.equal(calls.length, 1);
    assert.ok([...kv.keys()].some((key) => String(key).startsWith('cg:v1:')));
    clearProxyCache();
    const second = await proxyCoinGeckoJson('coins/vine', { localization: 'false' });
    assert.equal(second.ok, true);
    assert.equal(second.json.id, 'vine');
    assert.equal(second.stale, false);
    assert.equal(calls.length, 1);
  });

  test('a 429 serves the last good payload and does not refetch during the cooldown', async () => {
    let status = 200;
    const { kv, calls } = installFetch(() => jsonResponse(status, status === 200 ? { id: 'vine', symbol: 'vine' } : { error: 'rate limit' }));
    await proxyCoinGeckoJson('coins/vine', { localization: 'false' });
    clearProxyCache();
    ageShared(kv, 7 * 60 * 60 * 1000);
    status = 429;
    const stale = await proxyCoinGeckoJson('coins/vine', { localization: 'false' });
    assert.equal(stale.ok, true);
    assert.equal(stale.stale, true);
    assert.equal(stale.json.id, 'vine');
    assert.equal(calls.length, 2);
    const again = await proxyCoinGeckoJson('coins/vine', { localization: 'false' });
    assert.equal(again.json.id, 'vine');
    assert.equal(calls.length, 2);
  });

  test('a confirmed 404 does not resurrect a stale coin', async () => {
    let status = 200;
    const { kv, calls } = installFetch(() => jsonResponse(status, status === 200 ? { id: 'gone-coin' } : { error: 'missing' }));
    await proxyCoinGeckoJson('coins/gone-coin', { localization: 'false' });
    clearProxyCache();
    ageShared(kv, 7 * 60 * 60 * 1000);
    status = 404;
    const missing = await proxyCoinGeckoJson('coins/gone-coin', { localization: 'false' });
    assert.equal(missing.status, 404);
    assert.equal(missing.ok, false);
    assert.equal(calls.length, 2);
  });

  test('monthly-cap wording pauses later CoinGecko calls', async () => {
    const { calls } = installFetch(() => jsonResponse(429, { error: 'API key usage exceeded' }));
    const first = await proxyCoinGeckoJson('ping', {});
    assert.equal(first.status, 429);
    const second = await proxyCoinGeckoJson('search/trending', {});
    assert.equal(second.status, 429);
    assert.equal(second.ok, false);
    assert.equal(calls.length, 1);
  });

  test('two callers share one in-flight CoinGecko request', async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return jsonResponse(200, { gecko_says: 'pong' });
    };
    const [a, b] = await Promise.all([
      proxyCoinGeckoJson('ping', {}),
      proxyCoinGeckoJson('ping', {}),
    ]);
    assert.equal(a.json.gecko_says, 'pong');
    assert.equal(b.json.gecko_says, 'pong');
    assert.equal(calls, 1);
  });

  test('coin page and coin image fall back to the boot snapshot', async () => {
    const { kv, calls } = installFetch((href) => {
      if (href.includes('coins/markets')) {
        return jsonResponse(200, [{ id: 'other', symbol: 'oth', name: 'Other', current_price: 1, total_volume: 1000, market_cap: 1000 }]);
      }
      return jsonResponse(429, { error: 'rate limit' });
    });
    kv.set(CACHE_KEY, JSON.stringify({
      coins: [{
        id: 'vine',
        symbol: 'vine',
        name: 'Vine',
        current_price: 0.04,
        price_change_percentage_24h: 8,
        market_cap: 1200000,
        total_volume: 300000,
        market_cap_rank: 400,
      }],
    }));
    const page = await renderCoinPage('vine');
    assert.equal(page.status, 200);
    assert.match(page.html, /Vine/);
    assert.match(page.html, /\$0\.0400/);
    assert.match(page.html, /index,follow/);
    assert.equal(page.html.includes('temporarily unavailable'), false);
    assert.equal(page.cacheControl.includes('no-store'), false);

    const loaded = await loadCoin('vine');
    assert.equal(loaded.ok, true);
    assert.equal(loaded.coin.snapshot, true);
    const scan = require('../api/scan');
    const res = mockRes();
    await scan({ query: { mode: 'og', kind: 'coin', id: 'vine' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.ok(Buffer.isBuffer(res.body));
    assert.equal(res.body[0], 0x89);
    assert.equal(calls.some((href) => href.includes('/coins/vine')), true);
  });

  test('grade and scan links on a coin page are nofollow, and the sitemap stays on /coin/', () => {
    const html = renderCoinHtml({
      ok: true,
      coin: {
        id: 'vine',
        symbol: 'VINE',
        name: 'Vine',
        image: '',
        description: 'A coin.',
        price: 0.04,
        change24h: 1,
        marketCap: 1000,
        volume: 100,
        rank: 4,
        scans: [{ chain: 'eth', chainName: 'Ethereum', address: PEPE, href: '/scan/eth/' + PEPE }],
      },
    }).html;
    assert.match(html, new RegExp('rel="nofollow" href="/check/eth/' + PEPE + '"'));
    assert.match(html, new RegExp('rel="nofollow" href="/scan/eth/' + PEPE + '"'));
    assert.match(html, /index,follow/);
    const xml = coinSitemapXml({
      ok: true,
      updatedAt: '2026-11-18T00:00:00.000Z',
      coins: [{ id: 'vine' }, { id: 'dex-eth-' + PEPE }],
    });
    assert.match(xml, /\/coin\/vine</);
    assert.equal(xml.includes('/check/'), false);
    assert.equal(xml.includes('/scan/'), false);
  });

  test('check and scan permalinks are noindex while coin errors stay noindex', () => {
    const grade = renderGrade({
      chain: 'eth',
      chainName: 'Ethereum',
      address: PEPE,
      symbol: 'PEPE',
      name: 'Pepe',
      letter: 'B',
      score: 85,
      priceUsd: 0.00001,
      logo: '',
      verdicts: ['Clean enough.'],
      checks: [],
      exchanges: [],
    }).html;
    assert.match(grade, /noindex, nofollow/);
    const scan = renderScanPage({
      stamp: 'CLEAN',
      symbol: 'PEPE',
      name: 'Pepe',
      chain: 'eth',
      chainName: 'Ethereum',
      address: PEPE,
      buyTax: 0,
      sellTax: 0,
      liquidityUsd: 1000,
      riskScore: 10,
      reasons: [],
      sources: ['GoPlus'],
      checks: {},
      updatedAt: '2026-11-18T00:00:00.000Z',
    });
    assert.match(scan, /<meta name="robots" content="noindex, nofollow">/);
    const missing = renderCoinHtml({ ok: false, status: 502, error: 'Coin data is temporarily unavailable.' });
    assert.equal(missing.status, 502);
    assert.match(missing.html, /noindex/);
    assert.match(missing.cacheControl, /no-store/);
  });

  test('robots lets share-card bots read /og/ and blocks everyone else from check, scan, and og', () => {
    const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
    const groups = robotGroups(robots);
    const social = groups.find((group) => group.agents.includes('twitterbot'));
    assert.ok(social, 'missing Twitterbot group');
    for (const agent of ['facebookexternalhit', 'discordbot', 'slackbot', 'telegrambot', 'linkedinbot', 'applebot']) {
      assert.ok(social.agents.includes(agent), agent);
    }
    assert.ok(social.rules.some((rule) => rule.key === 'allow' && rule.value === '/og/'));
    assert.equal(social.rules.some((rule) => rule.key === 'disallow' && rule.value.startsWith('/og')), false);
    const star = groups.find((group) => group.agents.length === 1 && group.agents[0] === '*');
    assert.ok(star);
    for (const pathName of ['/api/', '/go/', '/check/', '/scan/', '/og/']) {
      assert.ok(star.rules.some((rule) => rule.key === 'disallow' && rule.value === pathName), pathName);
    }
    assert.match(robots, /Sitemap: https:\/\/www\.ciphersignal\.xyz\/sitemap\.xml/);
    assert.match(robots, /Sitemap: https:\/\/www\.ciphersignal\.xyz\/sitemap-coins\.xml/);
  });

  test('ape check skips coingecko when name and price are already known and still renders when it is down', async () => {
    process.env.APE_STORE = 'memory';
    let price = '0.000007';
    let cgStatus = 200;
    const { calls } = installFetch((href) => {
      if (href.includes('gopluslabs.io')) return jsonResponse(200, pepeGoPlus());
      if (href.includes('dexscreener.com')) return jsonResponse(200, pepeDex(price));
      return jsonResponse(cgStatus, { error: 'rate limit' });
    });
    const first = await checkToken('eth', PEPE);
    assert.equal(first.ok, true);
    assert.equal(first.symbol, 'PEPE');
    assert.equal(first.priceUsd, 0.000007);
    assert.equal(calls.filter((href) => href.includes('api.coingecko.com')).length, 0);
    assert.equal(first.sources.includes('CoinGecko'), false);

    resetApeMemory();
    price = null;
    cgStatus = 429;
    const second = await checkToken('eth', PEPE);
    assert.equal(second.ok, true);
    assert.equal(second.name, 'Pepe');
    assert.equal(calls.filter((href) => href.includes('api.coingecko.com')).length, 1);
    const page = await renderApeRoute('ape', { chain: 'eth', address: PEPE });
    assert.equal(page.status, 200);
    assert.match(page.html, /noindex, nofollow/);
    assert.match(page.html, /PEPE/);
  });

  test('home and the fortune share image still render from a markets payload', async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const markets = [
      { id: 'vine', symbol: 'vine', name: 'Vine', current_price: 0.04, total_volume: 300000, market_cap: 1200000, price_change_percentage_24h: 8 },
      { id: 'pepe', symbol: 'pepe', name: 'Pepe', current_price: 0.00001, total_volume: 800000, market_cap: 4000000000, price_change_percentage_24h: -1 },
    ];
    global.fetch = async (url) => {
      const href = String(url);
      if (href.includes('api.coingecko.com')) return jsonResponse(200, markets);
      return jsonResponse(200, {});
    };
    const site = require('../api/site');
    const home = mockRes();
    await site({ query: { page: 'home' }, headers: {} }, home);
    assert.equal(home.statusCode, 200);
    assert.match(String(home.body), /vine/);
    assert.match(String(home.body), /G-CQVB0E2CMB/);
    assert.match(String(home.body), /cloudflareinsights/);

    const scan = require('../api/scan');
    const card = mockRes();
    await scan({ query: { mode: 'og', kind: 'fortune' }, headers: {} }, card);
    assert.equal(card.statusCode, 200);
    assert.equal(card.headers['content-type'], 'image/png');
    assert.ok(Buffer.isBuffer(card.body));
    assert.equal(card.body.slice(0, 4).toString('hex'), '89504e47');
  });
});
