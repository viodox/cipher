'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { AFFILIATES, buyButtonsHtml, referralClickScript, shell, REFERRAL_DISCLOSURE } = require('../lib/chrome');
const { renderScanPage } = require('../lib/pages');
const { renderGrade } = require('../lib/ape-page');
const { renderCoinHtml } = require('../lib/coin');
const { renderMoversPageFrom } = require('../lib/movers');

const GO_PATHS = [
  '/go/coinbase',
  '/go/binance-us',
  '/go/kraken',
  '/go/crypto-com',
  '/go/robinhood',
];

function hrefs(html) {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replace(/&amp;/g, '&'));
}

function referralHrefs(html) {
  const allowed = new Set(AFFILIATES.map((item) => item.href));
  const hops = new Set(AFFILIATES.map((item) => '/go/' + item.slug));
  return hrefs(html).filter((href) => {
    if (hops.has(href)) return false;
    return /coinbase|binance\.us|kraken|crypto\.com|join\.robinhood/i.test(href) && !allowed.has(href);
  });
}

test('buy buttons point at the allowlisted /go routes', () => {
  const html = buyButtonsHtml({ heading: 'Buy on an exchange' });
  assert.deepEqual(hrefs(html).filter((href) => href.startsWith('/go/')), AFFILIATES.map((item) => '/go/' + item.slug));
  assert.deepEqual(hrefs(html).filter((href) => href.startsWith('/go/')), GO_PATHS);
  assert.equal(hrefs(html).some((href) => /^https?:/i.test(href)), false);
  assert.equal(referralHrefs(html).length, 0);
  assert.match(html, /Buy on Coinbase/);
  assert.match(html, /Buy on Binance\.US/);
  assert.match(html, /Buy on Kraken/);
  assert.match(html, /Buy on Crypto\.com/);
  assert.match(html, /Buy on Robinhood/);
  assert.match(html, /rel="sponsored nofollow noopener"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /data-referral="1"/);
  assert.ok(html.includes(REFERRAL_DISCLOSURE));
  assert.match(html, /color:#e4eef8/);
  assert.equal(html.includes('casino'), false);
  assert.equal(html.includes('#6a7a9a'), false);
  assert.equal(html.includes('coinbase.com'), false);
  assert.equal(html.includes('invite.kraken.com'), false);
});

test('a named subset still cannot invent a new exchange link', () => {
  const html = buyButtonsHtml({ names: ['KRAKEN', 'NOPE'] });
  const links = hrefs(html).filter((href) => href.startsWith('/go/'));
  assert.deepEqual(links, ['/go/kraken']);
  assert.equal(html.includes('invite.kraken.com'), false);
});

test('a referral click reports exchange and page to gtag and va', () => {
  const script = referralClickScript().replace(/^<script>\n?/, '').replace(/<\/script>$/, '');
  const listeners = [];
  const gtagCalls = [];
  const vaCalls = [];
  const link = {
    getAttribute(name) {
      if (name === 'data-exchange') return 'KRAKEN';
      if (name === 'data-referral') return '1';
      return '';
    },
  };
  const document = { addEventListener(type, fn) { listeners.push([type, fn]); } };
  const window = { va(...args) { vaCalls.push(args); } };
  const location = { pathname: '/coin/dogecoin' };
  const gtag = (...args) => { gtagCalls.push(args); };
  const run = new Function('document', 'window', 'location', 'gtag', script);
  run(document, window, location, gtag);
  assert.equal(listeners.length, 1);
  listeners[0][1]({ target: { closest: () => link } });
  assert.deepEqual(gtagCalls, [['event', 'referral_click', { exchange: 'KRAKEN', page: '/coin/dogecoin' }]]);
  assert.deepEqual(vaCalls, [['event', { name: 'referral_click', data: { exchange: 'KRAKEN', page: '/coin/dogecoin' } }]]);
  listeners[0][1]({ target: { closest: () => null } });
  assert.equal(gtagCalls.length, 1);
});

test('shell keeps GA and fires referral_click with exchange and page', () => {
  const html = shell({ title: 't', description: 'd', heading: 'h', body: buyButtonsHtml() });
  assert.match(html, /G-CQVB0E2CMB/);
  assert.match(html, /gtag\('event', 'referral_click', \{ exchange: exchange, page: page \}\)/);
  assert.match(html, /window\.va\('event', \{ name: 'referral_click', data: \{ exchange: exchange, page: page \} \}\)/);
  assert.match(html, /static\.cloudflareinsights\.com\/beacon\.min\.js/);
});

test('coin pages put Buy on buttons next to the price', () => {
  const html = renderCoinHtml({
    ok: true,
    coin: {
      id: 'dogecoin',
      symbol: 'DOGE',
      name: 'Dogecoin',
      image: '',
      description: 'A coin.',
      price: 0.1,
      change24h: 2,
      marketCap: 100,
      volume: 50,
      rank: 8,
      scans: [],
    },
  }).html;
  const priceAt = html.indexOf('>price<');
  const buyAt = html.indexOf('Buy on Coinbase');
  const scanAt = html.indexOf('contract scan');
  assert.ok(priceAt > 0 && buyAt > priceAt && scanAt > buyAt);
  assert.equal(referralHrefs(html).length, 0);
  assert.match(html, /Buy DOGE on an exchange/);
});

test('ape check pushes buy buttons under a B and a soft note under an F', () => {
  const base = {
    chain: 'eth',
    chainName: 'Ethereum',
    address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    symbol: 'PEPE',
    name: 'Pepe',
    score: 85,
    priceUsd: 0.00001,
    logo: '',
    verdicts: ['Clean enough.'],
    checks: [],
    exchanges: ['COINBASE'],
  };
  const good = renderGrade(Object.assign({}, base, { letter: 'B' })).html;
  const hero = good.indexOf('grade-letter');
  const cta = good.indexOf('Looks good?');
  const receipt = good.indexOf('>receipt<');
  assert.ok(hero > 0 && cta > hero && receipt > cta);
  assert.match(good, /Buy on Coinbase/);
  assert.equal(good.includes('Buy on Kraken'), false);
  assert.equal(referralHrefs(good).length, 0);

  const bad = renderGrade(Object.assign({}, base, { letter: 'F', score: 0, exchanges: [] })).html;
  assert.match(bad, /Low grade/);
  assert.equal(bad.includes('Buy on Coinbase'), false);
  assert.equal(bad.includes('coinbase.com/join'), false);

  const mixed = renderGrade(Object.assign({}, base, { letter: 'D-', score: 60 })).html;
  assert.equal(mixed.includes('Buy on '), false);
});

test('scan pages buy on a clean stamp and stay quiet on a honeypot', () => {
  const report = {
    symbol: 'PUMP',
    name: 'Example',
    chain: 'sol',
    chainName: 'Solana',
    address: 'J1D3X8znX4AzUPMHVWyBLNHqBBqWDPN5jX4KwK3Qpump',
    buyTax: 0,
    sellTax: 0,
    liquidityUsd: 100000,
    riskScore: 12,
    reasons: [],
    sources: ['RugCheck'],
    checks: {},
    updatedAt: '2026-11-02T00:00:00.000Z',
  };
  const clean = renderScanPage(Object.assign({}, report, { stamp: 'CLEAN' }));
  assert.match(clean, /Looks clear\?/);
  assert.match(clean, /Buy on Kraken/);
  assert.match(clean, /G-CQVB0E2CMB/);
  assert.match(clean, /referral_click/);
  assert.equal(referralHrefs(clean).length, 0);
  const stampAt = clean.indexOf('class="stamp"');
  const buyAt = clean.indexOf('Buy on Coinbase');
  assert.ok(stampAt > 0 && buyAt > stampAt);

  const honey = renderScanPage(Object.assign({}, report, { stamp: 'HONEYPOT' }));
  assert.match(honey, /no buy button/i);
  assert.equal(honey.includes('Buy on Coinbase'), false);
  assert.equal(honey.includes('coinbase.com/join'), false);
  assert.equal(honey.includes('invite.kraken.com'), false);
});

test('movers keeps a sticky Buy on bar', () => {
  const html = renderMoversPageFrom({
    ok: true,
    source: 'meme-token',
    updatedAt: '2026-11-02T00:00:00.000Z',
    universe: 1,
    note: 'note',
    gainers: [],
    losers: [],
    volumeSpikes: [],
    coins: [],
  }).html;
  assert.match(html, /buy-sticky/);
  assert.match(html, /Buy on Coinbase/);
  assert.match(html, /Referral links: we may earn a commission/);
  assert.equal(referralHrefs(html).length, 0);
});

test('the homepage where-to-buy block points at /go and still fires referral_click', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'templates', 'home.html'), 'utf8');
  GO_PATHS.forEach((route) => assert.ok(index.includes('href="' + route + '"'), route));
  assert.match(index, /data-exchange="COINBASE"/);
  assert.match(index, /data-exchange="BINANCE\.US"/);
  assert.match(index, /data-exchange="ROBINHOOD"/);
  assert.match(index, /rel="sponsored nofollow noopener"/);
  assert.match(index, /G-CQVB0E2CMB/);
  assert.match(index, /referral_click/);
  assert.match(index, /static\.cloudflareinsights\.com\/beacon\.min\.js/);
  assert.equal(index.includes('coinbase.com/join'), false);
  assert.equal(index.includes('invite.kraken.com'), false);
  assert.equal(index.includes('QQYSCTU'), false);
  assert.equal(index.includes('casino'), false);
});
