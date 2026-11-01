'use strict';

const assert = require('assert');
const { test, beforeEach, afterEach } = require('node:test');
const { getTransformedRoutes } = require('@vercel/routing-utils');
const vercelConfig = require('../vercel.json');

const SERVER_KEY = 'server-key-not-real';
const CLIENT_KEY = 'client-key-should-not-leak';

// Shapes index.html actually fetches, plus the single-segment ping probe.
const SITE_CALLS = [
  { pathname: '/api/coingecko/search/trending', search: '' },
  {
    pathname: '/api/coingecko/coins/markets',
    search: 'vs_currency=usd&category=meme-token&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h%2C7d',
  },
  {
    pathname: '/api/coingecko/coins/markets',
    search: 'vs_currency=usd&category=meme-token&order=volume_desc&per_page=250&page=2&sparkline=false&price_change_percentage=24h%2C7d',
  },
  {
    pathname: '/api/coingecko/coins/markets',
    search: 'vs_currency=usd&category=robinhood-chain-stocks-ecosystem&order=market_cap_desc&per_page=50&page=1&sparkline=false',
  },
  {
    pathname: '/api/coingecko/coins/pepe',
    search: 'localization=false&tickers=false&market_data=false&community_data=false&developer_data=false',
  },
  {
    pathname: '/api/coingecko/coins/ethereum/contract/0x6982508145454ce325ddbe47a25d4ec3d2311933',
    search: '',
  },
  { pathname: '/api/coingecko/search', search: 'query=pepe' },
  { pathname: '/api/coingecko/coins/pepe/market_chart', search: 'vs_currency=usd&days=7' },
  { pathname: '/api/coingecko/ping', search: '' },
];

function compiledRoutes() {
  const result = getTransformedRoutes({ rewrites: vercelConfig.rewrites });
  assert.equal(result.error, null);
  return result.routes;
}

function coingeckoRoute(routes) {
  const route = routes.find((entry) => entry.src && entry.src.includes('coingecko'));
  assert.ok(route, 'missing coingecko rewrite');
  return route;
}

function matchRoute(route, pathname) {
  const match = pathname.match(new RegExp(route.src));
  if (!match) return null;
  return match.slice(1);
}

// Mirrors the compiled dest `/api/coingecko?path=$1` plus the browser query.
function rewriteQuery(pathname, search) {
  const route = coingeckoRoute(compiledRoutes());
  const groups = matchRoute(route, pathname);
  assert.ok(groups, 'route did not match ' + pathname);
  const dest = route.dest.replace(/\$(\d+)/g, (_, index) => groups[Number(index) - 1]);
  const url = new URL(dest, 'http://127.0.0.1');
  const incoming = new URLSearchParams(search);
  for (const [key, value] of incoming) {
    if (!url.searchParams.has(key)) url.searchParams.append(key, value);
  }
  const query = {};
  for (const [key, value] of url.searchParams) {
    if (query[key] === undefined) query[key] = value;
    else if (Array.isArray(query[key])) query[key].push(value);
    else query[key] = [query[key], value];
  }
  return query;
}

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: 0,
    body: null,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.body = payload; },
  };
}

function loadHandler() {
  delete require.cache[require.resolve('../lib/coingecko')];
  delete require.cache[require.resolve('../api/coingecko')];
  return require('../api/coingecko');
}

beforeEach(() => {
  process.env.COINGECKO_API_KEY = SERVER_KEY;
});

afterEach(() => {
  delete process.env.COINGECKO_API_KEY;
  delete global.fetch;
});

test('vercel compiles the catch-all onto one function and leaves the other api routes alone', () => {
  const routes = compiledRoutes();
  assert.deepEqual(routes[0], { handle: 'filesystem' });

  const cg = coingeckoRoute(routes);
  // Destination must be the bare function. `:path+` inside the query compiles
  // to `path=$1%20` (a trailing space) and would 400 every call.
  assert.equal(cg.dest, '/api/coingecko?path=$1');
  assert.equal(cg.check, true);
  assert.equal(cg.dest.includes('%20'), false);
  assert.equal(routes.indexOf(cg) > 0, true);

  const byDest = Object.fromEntries(
    routes.filter((route) => route.dest).map((route) => [route.dest, route])
  );
  assert.equal(matchRoute(byDest['/api/page?route=ai-decrypt'], '/ai-decrypt') !== null, true);
  assert.equal(matchRoute(byDest['/api/page?route=profile'], '/profile') !== null, true);
  assert.equal(matchRoute(byDest['/api/page?route=cipherpot'], '/cipherpot') !== null, true);
  assert.equal(matchRoute(byDest['/api/page?route=on-chain-stocks'], '/on-chain-stocks') !== null, true);
  assert.equal(matchRoute(byDest['/api/page?route=rug-radar'], '/rug-radar') !== null, true);

  const scan = byDest['/api/scan?chain=$1&address=$2'];
  assert.deepEqual(
    matchRoute(scan, '/scan/eth/0x6982508145454ce325ddbe47a25d4ec3d2311933'),
    ['eth', '0x6982508145454ce325ddbe47a25d4ec3d2311933']
  );
  const og = byDest['/api/og?chain=$1&address=$2'];
  assert.deepEqual(
    matchRoute(og, '/og/scan/sol/So11111111111111111111111111111111111111112.png'),
    ['sol', 'So11111111111111111111111111111111111111112']
  );

  for (const pathname of ['/api/og', '/api/scan', '/api/radar', '/api/security', '/api/page', '/api/coingecko']) {
    assert.equal(matchRoute(cg, pathname), null, pathname + ' must not be swallowed by the coingecko rewrite');
  }

  for (const call of SITE_CALLS) {
    const groups = matchRoute(cg, call.pathname);
    assert.deepEqual(groups, [call.pathname.replace(/^\/api\/coingecko\//, '')], call.pathname);
  }
});

test('explicit :path+ in the destination query is the broken form', () => {
  const result = getTransformedRoutes({
    rewrites: [{ source: '/api/coingecko/:path+', destination: '/api/coingecko?path=:path+' }],
  });
  assert.equal(result.error, null);
  const route = result.routes.find((entry) => entry.dest);
  assert.equal(route.dest, '/api/coingecko?path=$1%20');
});

test('site paths proxy to CoinGecko with the server key, original query, and cache headers', async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return { status: 200, text: async () => '{"coins":[{"id":"pepe"}]}' };
  };
  const handler = loadHandler();

  for (const call of SITE_CALLS) {
    const before = calls.length;
    const res = mockRes();
    const query = rewriteQuery(call.pathname, call.search);
    query.x_cg_demo_api_key = CLIENT_KEY;
    await handler({
      url: call.pathname + (call.search ? '?' + call.search : ''),
      query,
    }, res);

    assert.equal(res.statusCode, 200, call.pathname);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'public, s-maxage=60, stale-while-revalidate=120');
    assert.equal(res.body.includes(SERVER_KEY), false);
    assert.equal(res.body.includes(CLIENT_KEY), false);

    const upstream = new URL(calls[before]);
    assert.equal(upstream.origin, 'https://api.coingecko.com');
    assert.equal(upstream.pathname, '/api/v3/' + call.pathname.replace(/^\/api\/coingecko\//, ''));
    assert.equal(upstream.searchParams.get('x_cg_demo_api_key'), SERVER_KEY);
    assert.equal(upstream.search.includes(CLIENT_KEY), false);
    const expected = new URLSearchParams(call.search);
    for (const [key, value] of expected) {
      assert.equal(upstream.searchParams.get(key), value, key + ' on ' + call.pathname);
    }
  }

  const again = mockRes();
  await handler({ url: '/api/coingecko/ping', query: rewriteQuery('/api/coingecko/ping', '') }, again);
  assert.equal(again.statusCode, 200);
  assert.equal(calls.length, SITE_CALLS.length);
});

test('a path array and the original URL both reach the same proxy', async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return { status: 200, text: async () => '{"gecko_says":"pong"}' };
  };
  const handler = loadHandler();

  const fromArray = mockRes();
  await handler({
    url: '/api/coingecko',
    query: { path: ['coins', 'ethereum', 'contract', '0xabc'], localization: 'false' },
  }, fromArray);
  assert.equal(fromArray.statusCode, 200);
  assert.equal(new URL(calls[0]).pathname, '/api/v3/coins/ethereum/contract/0xabc');
  assert.equal(new URL(calls[0]).searchParams.get('localization'), 'false');

  const fromUrl = mockRes();
  await handler({
    url: '/api/coingecko/search/trending?x_cg_demo_api_key=' + CLIENT_KEY,
    query: { x_cg_demo_api_key: CLIENT_KEY },
  }, fromUrl);
  assert.equal(fromUrl.statusCode, 200);
  assert.equal(new URL(calls[1]).pathname, '/api/v3/search/trending');
  assert.equal(new URL(calls[1]).searchParams.get('x_cg_demo_api_key'), SERVER_KEY);
});

test('invalid paths and upstream errors are not cached or keyed', async () => {
  let fetches = 0;
  global.fetch = async () => {
    fetches += 1;
    return { status: 429, text: async () => '{"error":"rate limit"}' };
  };
  const handler = loadHandler();

  const bad = mockRes();
  await handler({ url: '/api/coingecko/foo..bar', query: { path: 'foo..bar', x_cg_pro_api_key: CLIENT_KEY } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.headers['cache-control'], 'no-store');
  assert.equal(JSON.parse(bad.body).error, 'invalid path');
  assert.equal(fetches, 0);

  const empty = mockRes();
  await handler({ url: '/api/coingecko', query: {} }, empty);
  assert.equal(empty.statusCode, 400);
  assert.equal(fetches, 0);

  const limited = mockRes();
  await handler({ url: '/api/coingecko/ping', query: { path: 'ping' } }, limited);
  const limitedAgain = mockRes();
  await handler({ url: '/api/coingecko/ping', query: { path: 'ping' } }, limitedAgain);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['cache-control'], 'no-store');
  assert.equal(limitedAgain.statusCode, 429);
  assert.equal(fetches, 2);
  assert.equal(limited.body.includes(SERVER_KEY), false);
});
