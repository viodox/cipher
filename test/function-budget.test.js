'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { getTransformedRoutes } = require('@vercel/routing-utils');
const vercel = require('../vercel.json');

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; },
    send(payload) { this.body = payload; },
  };
}

test('hobby deployment stays at or under 8 serverless functions', () => {
  const files = walk(path.join(__dirname, '..', 'api'), []);
  assert.ok(files.length <= 8, files.join(','));
  assert.deepEqual(files.map((file) => path.relative(path.join(__dirname, '..'), file)).sort(), [
    'api/alerts.js',
    'api/coingecko.js',
    'api/scan.js',
    'api/site.js',
  ]);
  assert.equal(vercel.engines, undefined);
  assert.equal(require('../package.json').engines.node, '24.x');
  assert.equal(vercel.crons[0].path, '/api/alerts?action=run');
});

test('public urls rewrite onto the four functions', () => {
  const result = getTransformedRoutes({ rewrites: vercel.rewrites });
  assert.equal(result.error, null);
  const routes = result.routes.filter((route) => route.dest);
  function dest(pathname) {
    for (const route of routes) {
      const match = pathname.match(new RegExp(route.src));
      if (match) return route.dest.replace(/\$(\d+)/g, (_, index) => match[Number(index)]);
    }
    return null;
  }
  assert.equal(dest('/api/alerts/run'), '/api/alerts?action=run');
  assert.equal(dest('/api/alerts/unsubscribe'), '/api/alerts?action=unsubscribe');
  assert.equal(dest('/api/updates'), '/api/site?page=updates-json');
  assert.equal(dest('/api/movers'), '/api/site?page=movers-json');
  assert.equal(dest('/api/canon'), '/api/site?page=canon');
  assert.equal(dest('/api/security'), '/api/scan?mode=security');
  assert.equal(dest('/api/radar'), '/api/scan?mode=radar');
  assert.equal(dest('/movers'), '/api/site?page=movers');
  assert.equal(dest('/coin/pepe'), '/api/site?page=coin&id=pepe');
  assert.equal(dest('/og/movers.png'), '/api/scan?mode=og&kind=movers');
  assert.equal(dest('/'), '/api/site?page=home');
  assert.equal(dest('/smart-money'), '/api/site?page=smart-money');
  assert.equal(dest('/compare'), '/api/site?page=compare');
  assert.equal(dest('/digest'), '/api/site?page=digest');
  assert.equal(dest('/api/boot'), '/api/site?page=boot');
  assert.equal(dest('/api/board'), '/api/site?page=board');
  assert.equal(dest('/api/smart-money'), '/api/site?page=smart-money-json');
  assert.equal(dest('/api/digest'), '/api/alerts?action=digest');
  assert.equal(dest('/og/smart-money.png'), '/api/scan?mode=og&kind=smart-money');
  assert.equal(dest('/check'), '/api/site?page=check');
  assert.equal(dest('/hall'), '/api/site?page=hall');
  assert.equal(dest('/shame'), '/api/site?page=shame');
  assert.equal(dest('/check/eth/0x6982508145454ce325ddbe47a25d4ec3d2311933'), '/api/site?page=ape&chain=eth&address=0x6982508145454ce325ddbe47a25d4ec3d2311933');
  assert.equal(dest('/api/check'), '/api/scan?mode=check');
  assert.equal(dest('/api/ape-view'), '/api/site?page=ape-view');
  assert.equal(dest('/rq/s/script.js'), 'https://www.ciphersignal.xyz/_vercel/insights/script.js');
  assert.equal(dest('/rq/s/view'), 'https://www.ciphersignal.xyz/_vercel/insights/view');
  assert.equal(dest('/rq/s/event'), 'https://www.ciphersignal.xyz/_vercel/insights/event');
  assert.equal(dest('/og/check/sol/J1D3X8znX4AzUPMHVWyBLNHqBBqWDPN5jX4KwK3Qpump.png'), '/api/scan?mode=og&kind=ape&chain=sol&address=J1D3X8znX4AzUPMHVWyBLNHqBBqWDPN5jX4KwK3Qpump');
  assert.equal(dest('/sitemap-coins.xml'), '/api/site?page=sitemap');
  assert.equal(dest('/api/coingecko/search/trending').startsWith('/api/coingecko?path='), true);
});

test('alert runner action returns 401 without CRON_SECRET', async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const handler = require('../api/alerts');
  const res = mockRes();
  await handler({ method: 'GET', url: '/api/alerts?action=run', query: { action: 'run' }, headers: {} }, res);
  if (previous) process.env.CRON_SECRET = previous;
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});
