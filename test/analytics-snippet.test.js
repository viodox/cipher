'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { shell } = require('../lib/chrome');
const { renderScanPage, renderScanError } = require('../lib/pages');
const { ANALYTICS_SNIPPET, ANALYTICS_SRC, ANALYTICS_ENDPOINT } = require('../lib/web-analytics');

const ROOT = path.join(__dirname, '..');

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'test') continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

test('every static page loads the first-party analytics script', () => {
  const files = walk(ROOT, []);
  assert.ok(files.length >= 8, files.join(','));
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    assert.ok(html.includes(ANALYTICS_SNIPPET), file);
    assert.equal(html.includes('src="/_vercel/insights/script.js"'), false, file);
  }
  const index = fs.readFileSync(path.join(ROOT, 'templates', 'home.html'), 'utf8');
  assert.match(index, /history\.replaceState = function/);
  assert.match(index, /window\.va\('pageview', \{ path: location\.pathname \}\)/);
});

test('generated pages use the same snippet and endpoint', () => {
  const html = shell({ title: 't', description: 'd', heading: 'h', body: '<p>ok</p>' });
  assert.ok(html.includes('src="' + ANALYTICS_SRC + '"'));
  assert.ok(html.includes('data-endpoint="' + ANALYTICS_ENDPOINT + '"'));
  assert.match(html, /window\.vaq/);
  const scan = renderScanPage({
    chain: 'eth',
    address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    symbol: 'PEPE',
    name: 'Pepe',
    chainName: 'Ethereum',
    stamp: 'CLEAN',
    riskScore: 10,
    buyTax: 0,
    sellTax: 0,
    liquidityUsd: 1,
    reasons: [],
    sources: [],
    checks: {},
    updatedAt: '2026-11-03T00:00:00Z',
  });
  assert.ok(scan.includes('data-endpoint="' + ANALYTICS_ENDPOINT + '"'));
  assert.ok(renderScanError('bad scan').includes(ANALYTICS_SRC));
  const alerts = fs.readFileSync(path.join(ROOT, 'lib', 'alerts.js'), 'utf8');
  assert.match(alerts, /ANALYTICS_SNIPPET/);
  assert.equal(alerts.includes('/_vercel/insights/script.js'), false);
});
