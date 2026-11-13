'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { GO_PARTNERS, goPath, goClientScript, renderGoPage, renderAdvertiseRedirect } = require('../lib/go');
const { AFFILIATES, affiliateHref } = require('../lib/chrome');
const { composeDigest } = require('../lib/digest');
const { comparePostText, creditShare } = require('../lib/share');
const { ANALYTICS_SNIPPET } = require('../lib/web-analytics');
const vercel = require('../vercel.json');

const ROOT = path.join(__dirname, '..');

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'test') continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function runHop(script, fetchImpl) {
  const calls = [];
  const timers = [];
  const location = {
    pathname: '/go/kraken',
    replace(url) { calls.push(url); },
  };
  const window = {
    fetch: fetchImpl || ((url) => {
      calls.push(['fetch', String(url)]);
      return Promise.resolve({ ok: true });
    }),
    setTimeout(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
  };
  new Function('window', 'location', script)(window, location);
  return { calls, timers, location, window };
}

test('the partner allowlist is fixed https and the static pages match it', () => {
  assert.deepEqual(GO_PARTNERS.map((partner) => partner.slug), [
    'coinbase',
    'binance-us',
    'kraken',
    'crypto-com',
    'robinhood',
  ]);
  const slugs = new Set();
  for (const partner of GO_PARTNERS) {
    assert.equal(slugs.has(partner.slug), false, partner.slug);
    slugs.add(partner.slug);
    assert.match(partner.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.match(partner.href, /^https:\/\/[^\s"'<>\\]+$/);
    const html = renderGoPage(partner.slug);
    const file = path.join(ROOT, 'go', partner.slug, 'index.html');
    assert.equal(fs.readFileSync(file, 'utf8'), html);
    assert.ok(html.includes(ANALYTICS_SNIPPET));
    assert.match(html, /noindex, nofollow/);
    assert.match(html, /rel="sponsored nofollow noopener"/);
    assert.ok(html.includes(partner.href));
    assert.equal(html.includes('location.search'), false);
    assert.equal(html.includes('URLSearchParams'), false);
    assert.equal(html.includes('javascript:'), false);
    for (const other of GO_PARTNERS) {
      if (other.slug !== partner.slug) assert.equal(html.includes(other.href), false, other.slug);
    }
  }
  assert.equal(renderGoPage('evil'), null);
  assert.equal(renderGoPage('../coinbase'), null);
  assert.throws(() => goClientScript('javascript:alert(1)'));
  assert.throws(() => goClientScript('/go/kraken'));
  assert.throws(() => goClientScript('https://evil.example/go?next=\\'));
});

test('a hop waits for the analytics pageview and ignores a query string', () => {
  const dest = 'https://invite.kraken.com/JDNW/bkxtyuas';
  const script = goClientScript(dest);
  const quiet = runHop(script);
  assert.deepEqual(quiet.calls, []);
  assert.ok(quiet.timers.some((timer) => timer.ms === 1800));

  quiet.window.fetch('/rq/s/event', { method: 'POST' });
  assert.equal(quiet.timers.some((timer) => timer.ms === 100), false);

  quiet.window.fetch('/rq/s/view', { method: 'POST', keepalive: true });
  const soon = quiet.timers.filter((timer) => timer.ms === 100);
  assert.equal(soon.length, 1);
  soon[0].fn();
  assert.deepEqual(quiet.calls.filter((call) => typeof call === 'string'), [dest]);
  quiet.timers.find((timer) => timer.ms === 1800).fn();
  assert.equal(quiet.calls.filter((call) => call === dest).length, 1);

  const blocked = runHop(script, () => Promise.reject(new Error('blocked')));
  blocked.timers.find((timer) => timer.ms === 1800).fn();
  assert.deepEqual(blocked.calls, [dest]);

  const page = renderGoPage('kraken');
  assert.equal(page.includes('evil.example'), false);
  assert.equal(page.includes('location.search'), false);
  assert.match(page, /content="3;url=https:\/\/invite\.kraken\.com\/JDNW\/bkxtyuas"/);
});

test('public referral links, the digest, the sitemap, and robots use /go only', () => {
  assert.deepEqual(AFFILIATES.map((item) => affiliateHref(item)), GO_PARTNERS.map((partner) => goPath(partner.slug)));
  const digest = composeDigest({});
  for (const partner of GO_PARTNERS) {
    const pub = 'https://www.ciphersignal.xyz' + goPath(partner.slug);
    assert.ok(digest.text.includes(pub), partner.slug);
    assert.ok(digest.html.includes(pub), partner.slug);
    assert.equal(digest.text.includes(partner.href), false, partner.slug);
    assert.equal(digest.html.includes(partner.href), false, partner.slug);
  }
  assert.match(digest.html, /rel="sponsored nofollow noopener"/);

  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  assert.equal(sitemap.includes('/go/'), false);
  assert.equal(sitemap.includes('/advertise'), false);
  const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  assert.match(robots, /Disallow: \/go\//);

  const codes = ['QQYSCTU', '52095831', 'bkxtyuas', '8hxtmyan6d', 'miked2104'];
  const allowed = new Set([
    path.normalize(path.join(ROOT, 'lib', 'go.js')),
    path.normalize(path.join(ROOT, 'robinhood', 'index.html')),
  ]);
  for (const partner of GO_PARTNERS) {
    allowed.add(path.normalize(path.join(ROOT, 'go', partner.slug, 'index.html')));
  }
  for (const file of walk(ROOT, [])) {
    if (allowed.has(path.normalize(file))) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const code of codes) {
      assert.equal(text.includes(code), false, path.relative(ROOT, file) + ' still has ' + code);
    }
  }
  const legacy = fs.readFileSync(path.join(ROOT, 'robinhood', 'index.html'), 'utf8');
  assert.ok(legacy.includes(GO_PARTNERS.find((partner) => partner.slug === 'robinhood').href));
  assert.equal(vercel.rewrites.some((rule) => String(rule.source || '').startsWith('/go')), false);
  assert.equal(vercel.rewrites.some((rule) => rule.source === '/advertise'), false);
});

test('/advertise redirects at the form and does not publish prices', () => {
  const html = renderAdvertiseRedirect();
  const file = fs.readFileSync(path.join(ROOT, 'advertise', 'index.html'), 'utf8');
  assert.equal(file, html);
  assert.ok(html.includes(ANALYTICS_SNIPPET));
  assert.match(html, /noindex/);
  assert.match(html, /url=\/#advertise/);
  assert.match(html, /location\.replace\('\/#advertise'\)/);
  assert.match(html, /href="\/#advertise"/);
  assert.match(html, /no public rate card/);
  assert.equal(/\$\s*\d/.test(html), false);
  assert.equal(html.includes('99'), false);
  assert.equal(html.includes('249'), false);
  assert.equal(html.includes('399'), false);
  assert.match(html, /background:#060810/);
  assert.match(html, /color:#00e5ff/);
});

test('compare and coin-of-the-day share text credit the X account', () => {
  const compare = comparePostText(
    [{ ok: true, symbol: 'PEPE', letter: 'A' }, { ok: true, symbol: 'DOGE', letter: 'C' }],
    'Public checks only. Not a call.',
    'https://www.ciphersignal.xyz/compare?a=eth:1&b=eth:2',
  );
  assert.match(compare, /via @ciphersignal_/);
  assert.match(compare, /https:\/\/www\.ciphersignal\.xyz\/compare\?a=eth:1&b=eth:2/);
  const again = creditShare(compare, 'https://www.ciphersignal.xyz/compare?a=eth:1&b=eth:2');
  assert.equal(again, compare);
  const home = fs.readFileSync(path.join(ROOT, 'templates', 'home.html'), 'utf8');
  assert.match(home, /via @ciphersignal_/);
  assert.match(home, /is Forced Coin of the Day on CipherSignal/);
});
