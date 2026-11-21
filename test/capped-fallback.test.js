'use strict';

const assert = require('assert');
const { describe, test, beforeEach, afterEach } = require('node:test');
const { clearProxyCache, proxyCoinGeckoJson } = require('../lib/coingecko');
const { renderCoinPage } = require('../lib/coin');
const { renderMoversPage } = require('../lib/movers');
const { loadFortune } = require('../lib/fortune');
const { renderFortuneCard } = require('../lib/og');
const { checkToken, resetApeMemory } = require('../lib/ape');
const { renderSmartMoneyPage } = require('../lib/smart-money');
const { fetchPrices, renderAlertsPage } = require('../lib/alerts');
const { loadBoot, resetBootMemory, renderHomeHtml } = require('../lib/boot');
const { classify, decide, runWithTraffic, sendDenied, RATE_LIMIT_MAX } = require('../lib/traffic');

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const X_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter';

function jsonResponse(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

function marketRow(id, price) {
  return {
    id: id,
    symbol: id,
    name: id[0].toUpperCase() + id.slice(1),
    image: '',
    current_price: price,
    market_cap: 2000000,
    total_volume: 800000,
    price_change_percentage_24h: 5,
    price_change_percentage_7d_in_currency: 2,
    market_cap_rank: 20,
  };
}

function installCapped() {
  process.env.COINGECKO_API_KEY = 'demo-key-capped';
  delete process.env.COINGECKO_KEY_DISABLED;
  const calls = [];
  global.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('x_cg_demo_api_key') || href.includes('api.coingecko.com') && href.includes('demo-key')) {
      return jsonResponse(429, { error: 'API key usage exceeded' });
    }
    if (href.includes('api.coingecko.com') && href.includes('/coins/markets')) {
      return jsonResponse(200, [marketRow('vine', 0.009), marketRow('pepe', 0.000004), marketRow('dogecoin', 0.12)]);
    }
    if (href.includes('api.coingecko.com') && href.includes('/coins/vine')) {
      return jsonResponse(200, {
        id: 'vine',
        symbol: 'vine',
        name: 'Vine',
        image: {},
        description: { en: 'Vine coin.' },
        market_data: {
          current_price: { usd: 0.009 },
          price_change_percentage_24h: 4.5,
          market_cap: { usd: 9000000 },
          total_volume: { usd: 800000 },
          market_cap_rank: 30,
        },
        platforms: {},
      });
    }
    if (href.includes('api.coingecko.com') && href.includes('/simple/price')) {
      return jsonResponse(200, { vine: { usd: 0.009 }, dogecoin: { usd: 0.12 } });
    }
    if (href.includes('api.coingecko.com') && href.includes('/search/trending')) {
      return jsonResponse(200, { coins: [{ item: { id: 'vine', name: 'Vine', symbol: 'VINE' } }] });
    }
    if (href.includes('api.coingecko.com')) return jsonResponse(200, { ok: true });
    return jsonResponse(200, {});
  };
  return calls;
}

describe('capped key fallback and bot guard', { concurrency: 1 }, () => {
  beforeEach(() => {
    clearProxyCache();
    resetApeMemory();
    resetBootMemory();
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.COINGECKO_KEY_DISABLED;
  });

  afterEach(() => {
    clearProxyCache();
    resetApeMemory();
    resetBootMemory();
    delete process.env.COINGECKO_API_KEY;
    delete process.env.COINGECKO_KEY_DISABLED;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.APE_STORE;
    delete global.fetch;
  });

  test('a capped demo key falls back to public CoinGecko and the pages render', async () => {
    const calls = installCapped();
    const boot = await loadBoot();
    const home = renderHomeHtml(boot);
    assert.match(home, /window\.__CIPHER_BOOT__/);
    assert.match(home, /vine/);

    const coin = await renderCoinPage('vine');
    assert.equal(coin.status, 200);
    assert.match(coin.html, /Vine/);
    assert.match(coin.html, /\$0\.0090|0\.009/);
    assert.equal(coin.html.includes('temporarily unavailable'), false);

    const movers = await renderMoversPage();
    assert.equal(movers.status, 200);
    assert.match(movers.html, /vine|Vine|top movers/i);
    assert.equal(movers.html.includes('market data is temporarily unavailable'), false);

    const fortune = await loadFortune({ skipDetail: true, grade: 0, skipStore: true, coins: null });
    assert.equal(fortune.ok, true);
    const png = renderFortuneCard(fortune);
    assert.equal(png.slice(0, 4).toString('hex'), '89504e47');

    const prices = await fetchPrices(['dogecoin', 'vine']);
    assert.equal(prices.dogecoin, 0.12);
    assert.equal(prices.vine, 0.009);

    process.env.APE_STORE = 'memory';
    global.fetch = async (url) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('gopluslabs.io')) {
        return jsonResponse(200, { code: 1, result: { '0x6982508145454ce325ddbe47a25d4ec3d2311933': {
          token_name: 'Pepe', token_symbol: 'PEPE', is_honeypot: '0', is_mintable: '0',
          owner_address: '0x0000000000000000000000000000000000000000', buy_tax: '0', sell_tax: '0',
        } } });
      }
      if (href.includes('dexscreener.com')) {
        return jsonResponse(200, { pairs: [{ chainId: 'ethereum', baseToken: { symbol: 'PEPE', name: 'Pepe' }, priceUsd: '0.000004', liquidity: { usd: 1000000 }, priceChange: { h24: 1 } }] });
      }
      if (href.includes('x_cg_demo_api_key')) return jsonResponse(429, { error: 'API key usage exceeded' });
      return jsonResponse(200, {});
    };
    const ape = await checkToken('eth', '0x6982508145454ce325ddbe47a25d4ec3d2311933');
    assert.equal(ape.ok, true);
    assert.equal(ape.symbol, 'PEPE');
    assert.equal(calls.filter((href) => href.includes('api.coingecko.com') && href.includes('contract')).length, 0);

    const alerts = await renderAlertsPage();
    assert.equal(alerts.status, 200);
    assert.match(alerts.html, /price alert/i);

    const smart = renderSmartMoneyPage({ ok: true, buys: [], updatedAt: '2026-11-21T00:00:00.000Z', note: '' });
    assert.equal(smart.status, 200);
    assert.match(smart.html, /smart money/i);
    assert.equal(calls.some((href) => href.includes('x_cg_demo_api_key')), true);
  });

  test('COINGECKO_KEY_DISABLED never sends the demo key', async () => {
    process.env.COINGECKO_API_KEY = 'demo-key-capped';
    process.env.COINGECKO_KEY_DISABLED = '1';
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      return jsonResponse(200, { id: 'vine', symbol: 'vine', name: 'Vine' });
    };
    const result = await proxyCoinGeckoJson('coins/vine', { localization: 'false' });
    assert.equal(result.ok, true);
    assert.equal(result.fallback, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].includes('x_cg_demo_api_key'), false);
    const again = await proxyCoinGeckoJson('coins/vine', { localization: 'false' });
    assert.equal(again.json.id, 'vine');
    assert.equal(calls.length, 1);
  });

  test('suspicious desktop traffic cannot trigger an upstream fetch', async () => {
    let fetches = 0;
    global.fetch = async () => {
      fetches += 1;
      return jsonResponse(200, { id: 'vine' });
    };
    const decision = classify({
      headers: {
        'user-agent': CHROME,
        'x-vercel-ip-country': 'SG',
      },
    }, 'coin');
    assert.equal(decision.suspicious, true);
    assert.equal(decision.allowUpstream, false);
    const result = await runWithTraffic(decision, () => proxyCoinGeckoJson('coins/vine', { localization: 'false' }));
    assert.equal(result.ok, false);
    assert.equal(fetches, 0);
  });

  test('empty and headless agents are denied, real clients and indexers are not', () => {
    assert.equal(classify({ headers: { 'user-agent': '' } }, 'coin').deny, true);
    assert.equal(classify({ headers: { 'user-agent': 'curl/8.0.0' } }, 'og').deny, true);
    assert.equal(classify({ headers: { 'user-agent': 'Mozilla/5.0 HeadlessChrome/120.0.0.0' } }, 'scan').deny, true);
    const google = classify({ headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } }, 'coin');
    assert.equal(google.deny, false);
    assert.equal(google.allowUpstream, true);
    const twitter = classify({ headers: { 'user-agent': 'Twitterbot/1.0' } }, 'og');
    assert.equal(twitter.allowUpstream, true);
    assert.equal(classify({ headers: { 'user-agent': IPHONE, 'x-vercel-ip-country': 'HK' } }, 'coin').allowUpstream, true);
    assert.equal(classify({ headers: { 'user-agent': X_APP } }, 'coin').allowUpstream, true);
    const typed = classify({ headers: { 'user-agent': CHROME, 'sec-fetch-site': 'none' } }, 'coin');
    assert.equal(typed.allowUpstream, true);
    const referred = classify({ headers: { 'user-agent': CHROME, 'x-vercel-ip-country': 'CN', referer: 'https://www.google.com/search?q=vine' } }, 'coin');
    assert.equal(referred.allowUpstream, true);
    const res = { statusCode: 0, headers: {}, body: '', setHeader(n, v) { this.headers[n] = v; }, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; } };
    sendDenied(res);
    assert.equal(res.statusCode, 403);
  });

  test('a busy IP is served from cache only', async () => {
    process.env.KV_REST_API_URL = 'https://kv.test';
    process.env.KV_REST_API_TOKEN = 'tok';
    let count = 0;
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      const cmd = body[0][0];
      if (cmd === 'INCR') {
        count += 1;
        return jsonResponse(200, [{ result: count }]);
      }
      return jsonResponse(200, [{ result: 1 }]);
    };
    const req = {
      headers: {
        'user-agent': CHROME,
        'sec-fetch-site': 'none',
        'x-forwarded-for': '203.0.113.8',
      },
    };
    let last = null;
    for (let i = 0; i < RATE_LIMIT_MAX + 1; i += 1) last = await decide(req, 'coingecko');
    assert.equal(last.limited, true);
    assert.equal(last.allowUpstream, false);
    assert.equal(last.deny, false);
  });
});
