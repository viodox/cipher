'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { renderGrade } = require('../lib/ape-page');
const {
  humanKey,
  botKey,
  botUaKey,
  nyDay,
  classifyApeLookup,
  userAgentLabel,
  recordApeHit,
  noteApeLookup,
  UA_KEEP,
} = require('../lib/ape-traffic');

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function req(headers) {
  return { headers: headers || {} };
}

test('New York dates roll at local midnight, including daylight time', () => {
  assert.equal(nyDay('2026-11-03T04:59:00Z'), '2026-11-02');
  assert.equal(nyDay('2026-11-03T05:00:00Z'), '2026-11-03');
  assert.equal(nyDay('2026-07-15T03:59:00Z'), '2026-07-14');
  assert.equal(nyDay('2026-07-15T04:00:00Z'), '2026-07-15');
  assert.equal(humanKey('2026-11-03'), 'ape:check:human:2026-11-03');
  assert.equal(botKey('2026-11-03'), 'ape:check:bot:2026-11-03');
  assert.equal(botUaKey('2026-11-03'), 'ape:check:bot-ua:2026-11-03');
});

test('classify separates a browser page, a confirmed view, and a direct API hit', () => {
  assert.equal(classifyApeLookup(req({
    'user-agent': CHROME,
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    accept: 'text/html',
  }), 'page'), 'skip');

  assert.equal(classifyApeLookup(req({
    'user-agent': CHROME,
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
  }), 'page'), 'skip');

  assert.equal(classifyApeLookup(req({
    'user-agent': 'curl/8.7.1',
    accept: '*/*',
  }), 'page'), 'bot');

  assert.equal(classifyApeLookup(req({
    'user-agent': CHROME,
    accept: 'text/html',
  }), 'page'), 'bot');

  assert.equal(classifyApeLookup(req({
    'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'sec-fetch-dest': 'document',
  }), 'page'), 'bot');

  assert.equal(classifyApeLookup(req({ 'user-agent': CHROME }), 'api'), 'bot');
  assert.equal(classifyApeLookup(req({
    'user-agent': CHROME,
    referer: 'https://www.ciphersignal.xyz/check',
  }), 'api'), 'bot');
  assert.equal(classifyApeLookup(req({
    'user-agent': 'curl/8.7.1',
    'x-cipher-view': '1',
  }), 'api'), 'human');
  assert.equal(classifyApeLookup(req({ 'x-cipher-view': '1', 'user-agent': CHROME }), 'view'), 'human');
  assert.equal(classifyApeLookup(req({ 'user-agent': CHROME }), 'view'), 'bot');
  assert.equal(classifyApeLookup(req({}), 'api'), 'bot');
});

test('user agent labels are trimmed and capped', () => {
  assert.equal(userAgentLabel(req({})), '(none)');
  assert.equal(userAgentLabel(req({ 'user-agent': ' curl/8.7.1 \n' })), 'curl/8.7.1');
  const long = 'A'.repeat(200);
  assert.equal(userAgentLabel(req({ 'user-agent': long })).length, 180);
});

test('record writes one pipeline and keeps the top user agents for bots', async () => {
  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const prevKvUrl = process.env.KV_REST_API_URL;
  const prevKvToken = process.env.KV_REST_API_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts.body, authorization: opts.headers.authorization });
    return { ok: true, json: async () => [] };
  };
  try {
    const when = '2026-11-03T15:00:00Z';
    assert.equal(await recordApeHit(req({ 'user-agent': CHROME, 'x-cipher-view': '1' }), 'human', when), true);
    assert.equal(await recordApeHit(req({ 'user-agent': 'curl/8.7.1' }), 'bot', when), true);
    assert.equal(await recordApeHit(req({ 'user-agent': CHROME }), 'skip', when), false);
    assert.equal(await noteApeLookup(req({
      'user-agent': CHROME,
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
    }), 'page', when), null);
  } finally {
    global.fetch = original;
    if (prevUrl == null) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = prevUrl;
    if (prevToken == null) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = prevToken;
    if (prevKvUrl == null) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = prevKvUrl;
    if (prevKvToken == null) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = prevKvToken;
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://example.upstash.io/pipeline');
  assert.equal(calls[0].authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(calls[0].body), [
    ['INCR', 'ape:check:human:2026-11-03'],
    ['EXPIRE', 'ape:check:human:2026-11-03', String(40 * 24 * 60 * 60)],
  ]);
  assert.deepEqual(JSON.parse(calls[1].body), [
    ['INCR', 'ape:check:bot:2026-11-03'],
    ['EXPIRE', 'ape:check:bot:2026-11-03', String(40 * 24 * 60 * 60)],
    ['ZINCRBY', 'ape:check:bot-ua:2026-11-03', '1', 'curl/8.7.1'],
    ['EXPIRE', 'ape:check:bot-ua:2026-11-03', String(40 * 24 * 60 * 60)],
    ['ZREMRANGEBYRANK', 'ape:check:bot-ua:2026-11-03', '0', String(-(UA_KEEP + 1))],
  ]);
});

test('a grade page pings after load and an API lookup counts as bot', async () => {
  const html = renderGrade({
    chain: 'eth',
    chainName: 'Ethereum',
    address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    symbol: 'PEPE',
    name: 'Pepe',
    letter: 'A',
    score: 90,
    verdicts: ['Public contract data only.'],
    checks: [],
    exchanges: [],
  }).html;
  assert.match(html, /\/api\/ape-view/);
  assert.match(html, /x-cipher-view/);

  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const prevKvUrl = process.env.KV_REST_API_URL;
  const prevKvToken = process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  const site = require('../api/site');
  const scan = require('../api/scan');
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ result: {} }) };
  };
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  function mockRes() {
    return {
      statusCode: 0,
      headers: {},
      body: null,
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; },
      send(payload) { this.body = payload; },
      end() {},
    };
  }
  try {
    const view = mockRes();
    await site({
      method: 'POST',
      query: { page: 'ape-view' },
      headers: { 'x-cipher-view': '1', 'user-agent': CHROME },
    }, view);
    assert.equal(view.statusCode, 204);
    assert.equal(view.headers['cache-control'], 'no-store');

    const bot = mockRes();
    await scan({
      method: 'GET',
      query: { mode: 'check', chain: 'nope', address: '0x123' },
      headers: { 'user-agent': 'curl/8.7.1' },
    }, bot);
    assert.equal(bot.statusCode, 400);
  } finally {
    global.fetch = original;
    if (prevUrl == null) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = prevUrl;
    if (prevToken == null) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = prevToken;
    if (prevKvUrl == null) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = prevKvUrl;
    if (prevKvToken == null) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = prevKvToken;
  }
  assert.ok(calls.some((url) => url.endsWith('/pipeline')), calls.join(','));
});
