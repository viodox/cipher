'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { nyDayKey: fortuneNy, modelFromCoins, renderFortunePage, loadFortune } = require('../lib/fortune');
const { renderHomeHtml, resetBootMemory } = require('../lib/boot');
const { updatesPayload } = require('../lib/updates');
const {
  PACKAGES,
  ENV_KEYS,
  nyDayKey,
  normalizeBooking,
  activeBooking,
  listBookings,
  decideCotd,
  pickOrganicCotd,
  clientPayload,
  sellHtml,
} = require('../lib/sponsor');

const NOW = Date.parse('2026-11-05T16:00:00Z');

function coin(id, extra) {
  return Object.assign({
    id,
    symbol: id.slice(0, 8).toUpperCase(),
    name: id,
    current_price: 1,
    market_cap: 2e6,
    total_volume: 2e5,
    price_change_percentage_24h: 4,
    viral: 20,
    rug: 10,
  }, extra || {});
}

function fortuneCoins() {
  const coins = [];
  for (let i = 0; i < 8; i += 1) {
    coins.push({
      id: 'coin-' + i,
      symbol: 'c' + i,
      name: 'Coin ' + i,
      current_price: 1 + i,
      market_cap: 1000000 - i * 1000,
      total_volume: 80000,
      price_change_percentage_24h: i - 2,
    });
  }
  return coins;
}

test('New York dates match Fortune and an empty file does not force a coin', () => {
  assert.equal(nyDayKey('2026-11-05T04:59:00Z'), '2026-11-04');
  assert.equal(nyDayKey('2026-11-05T05:00:00Z'), fortuneNy('2026-11-05T05:00:00Z'));
  const file = require('../data/sponsored-cotd.json');
  assert.deepEqual(file.bookings, []);
  assert.match(file._note, /redeploy/i);
  assert.match(file._note, /Stripe/);
  assert.equal(activeBooking(NOW, { bookings: [], env: {} }), null);
  assert.equal(PACKAGES.find((pack) => pack.id === 'banner').price, 99);
  assert.equal(PACKAGES.find((pack) => pack.id === 'cotd').price, 249);
  assert.equal(PACKAGES.find((pack) => pack.id === 'combo').price, 399);
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  ENV_KEYS.forEach((key) => assert.ok(readme.includes(key), key));
});

test('organic coin of the day still picks a liquid coin and a paid day overrides it', () => {
  const loud = coin('loud-coin', { symbol: 'LOUD', name: 'Loud', price_change_percentage_24h: 40, viral: 90 });
  const quiet = coin('quiet-coin', { symbol: 'QUIET', name: 'Quiet', total_volume: 10, market_cap: 10, current_price: 1 });
  const organic = decideCotd([loud, quiet], { now: NOW });
  assert.equal(organic.source, 'organic');
  assert.equal(organic.coin.id, 'loud-coin');
  assert.equal(pickOrganicCotd([loud, quiet], NOW).id, pickOrganicCotd([loud, quiet], NOW).id);
  const paid = normalizeBooking({
    date: '2026-11-05',
    id: 'quiet-coin',
    symbol: 'QUIET',
    name: 'Quiet',
    blurb: 'Paid line',
    href: 'https://example.com/coin',
  });
  const forced = decideCotd([loud, quiet], { now: NOW, booking: paid });
  assert.equal(forced.source, 'sponsored');
  assert.equal(forced.coin.id, 'quiet-coin');
  assert.equal(forced.coin.symbol, 'QUIET');
  assert.equal(forced.coin.blurb, 'Paid line');
  assert.equal(forced.coin.href, 'https://example.com/coin');
  assert.equal(forced.coin.live, true);
  const ghost = normalizeBooking({
    date: '2026-11-05',
    id: 'brand-new',
    symbol: 'NEW',
    name: 'Brand New',
    logo: 'https://cdn.example/logo.png',
    href: '/coin/brand-new',
  });
  const shown = decideCotd([loud], { now: NOW, booking: ghost });
  assert.equal(shown.source, 'sponsored');
  assert.equal(shown.coin.id, 'brand-new');
  assert.equal(shown.coin.image, 'https://cdn.example/logo.png');
  assert.equal(shown.coin.live, false);
  const tomorrow = Object.assign({}, paid, { date: '2026-11-06' });
  assert.equal(decideCotd([loud, quiet], { now: NOW, booking: tomorrow }).source, 'organic');
  const banner = normalizeBooking({ date: '2026-11-05', id: 'quiet-coin', symbol: 'QUIET', name: 'Quiet', package: 'banner' });
  assert.equal(banner.package, 'banner');
  assert.equal(banner.forceFortune, false);
  assert.equal(decideCotd([loud, quiet], { now: NOW, booking: banner }).source, 'organic');
  assert.equal(normalizeBooking({ date: '2026-11-05', id: 'x', symbol: 'X', href: 'javascript:alert(1)' }).href, '');
});

test('env booking replaces the JSON row for that New York date', () => {
  const env = {
    SPONSORED_COTD_DATE: '2026-11-05',
    SPONSORED_COTD_ID: 'from-env',
    SPONSORED_COTD_SYMBOL: 'ENV',
    SPONSORED_COTD_NAME: 'From Env',
    SPONSORED_COTD_BLURB: 'Ribbit',
    SPONSORED_COTD_HREF: '/coin/from-env',
    SPONSORED_COTD_FORCE_FORTUNE: 'true',
    SPONSORED_COTD_LOGO: 'https://assets.example/logo.png',
  };
  const hit = activeBooking(NOW, {
    bookings: [{ date: '2026-11-05', id: 'from-file', symbol: 'FILE', name: 'File' }],
    env,
  });
  assert.equal(hit.id, 'from-env');
  assert.equal(hit.forceFortune, true);
  assert.equal(hit.package, 'combo');
  assert.equal(hit.logo, 'https://assets.example/logo.png');
  assert.equal(activeBooking(Date.parse('2026-11-05T04:30:00Z'), { bookings: [], env }), null);
  const rows = listBookings({
    bookings: [
      { date: '2026-11-05', id: 'from-file', symbol: 'FILE', name: 'File' },
      { date: '2026-12-01', id: 'later', symbol: 'LAT', name: 'Later' },
    ],
    env,
  });
  assert.equal(rows.some((row) => row.id === 'from-env'), true);
  assert.equal(rows.some((row) => row.id === 'later'), true);
  assert.equal(rows.some((row) => row.id === 'from-file'), false);
});

test('Fortune stays organic unless forceFortune is set for that New York date', async () => {
  const coins = fortuneCoins();
  const organic = modelFromCoins(coins, [], NOW);
  assert.equal(organic.sponsored, false);
  const banner = modelFromCoins(coins, [], NOW, {
    sponsor: normalizeBooking({ date: '2026-11-05', id: 'banner-only', symbol: 'BAN', name: 'Banner', package: 'banner' }),
  });
  assert.equal(banner.winner.id, organic.winner.id);
  assert.notEqual(banner.winner.id, 'banner-only');
  const off = modelFromCoins(coins, [], NOW, {
    sponsor: normalizeBooking({ date: '2026-11-05', id: 'coin-4', symbol: 'C4', name: 'Coin 4', forceFortune: false }),
  });
  assert.equal(off.winner.id, organic.winner.id);
  assert.notEqual(off.source, 'sponsored');
  const forced = modelFromCoins(coins, [], NOW, {
    storedId: 'coin-0',
    sponsor: normalizeBooking({
      date: '2026-11-05',
      id: 'coin-4',
      symbol: 'C4',
      name: 'Paid Name',
      blurb: 'Locked for fun',
      href: '/coin/coin-4',
      forceFortune: true,
    }),
  });
  assert.equal(forced.winner.id, 'coin-4');
  assert.equal(forced.winner.symbol, 'C4');
  assert.equal(forced.winner.name, 'Paid Name');
  assert.equal(forced.source, 'sponsored');
  assert.equal(forced.sponsored, true);
  assert.equal(forced.segments[forced.winnerSlot].id, 'coin-4');
  assert.equal(forced.segments[forced.winnerSlot].sponsored, true);
  const outside = modelFromCoins(coins, [], NOW, {
    sponsor: normalizeBooking({
      date: '2026-11-05',
      id: 'brand-new',
      symbol: 'NEW',
      name: 'Brand New',
      href: 'https://dex.example/new',
      forceFortune: true,
    }),
  });
  assert.equal(outside.winner.id, 'brand-new');
  assert.equal(outside.winner.href, 'https://dex.example/new');
  assert.equal(outside.segments[outside.winnerSlot].id, 'brand-new');
  const otherDay = modelFromCoins(coins, [], NOW, {
    sponsor: normalizeBooking({ date: '2026-11-06', id: 'coin-4', symbol: 'C4', name: 'Coin 4', forceFortune: true }),
  });
  assert.equal(otherDay.winner.id, organic.winner.id);
  const loaded = await loadFortune({
    coins,
    now: NOW,
    skipStore: true,
    skipDetail: true,
    storedId: 'coin-0',
    sponsor: normalizeBooking({ date: '2026-11-05', id: 'coin-2', symbol: 'C2', name: 'Coin 2', forceFortune: true }),
  });
  assert.equal(loaded.winner.id, 'coin-2');
  assert.equal(loaded.source, 'sponsored');
  const html = renderFortunePage(forced, { revealed: true }).html;
  assert.match(html, /SPONSORED/);
  assert.match(html, /Forced Coin of the Day/);
  assert.match(html, /Not a prediction/);
  assert.match(html, /Book Coin of the Day/);
  assert.match(html, /href="\/#advertise"/);
  assert.equal(html.includes('SHA-256'), false);
  const withoutFooter = html.replace(/offer to buy, sell, or bet/g, '');
  assert.equal(/jackpot|wager|casino|gambl|payout|you won|win money|\bbet\b/i.test(withoutFooter), false);
  const plain = renderFortunePage(organic, { revealed: false }).html;
  assert.match(plain, /Book Coin of the Day/);
  assert.match(plain, /SHA-256/);
  assert.match(plain, /No prizes and no paid spins/);
  const beforeCard = plain.slice(0, plain.indexOf('function cardHtml'));
  assert.equal(beforeCard.includes('class="cf-sponsored"'), false);
  assert.equal(beforeCard.includes('paid placement'), false);
});

test('homepage sells Forced Coin of the Day and injects the active booking', () => {
  resetBootMemory();
  const html = renderHomeHtml(null, {
    now: NOW,
    env: {
      SPONSORED_COTD_DATE: '2026-11-05',
      SPONSORED_COTD_ID: 'from-env',
      SPONSORED_COTD_SYMBOL: 'ENV',
      SPONSORED_COTD_NAME: 'From Env',
    },
    bookings: [],
  });
  assert.match(html, /id="advertise"/);
  assert.match(html, /Forced Coin of the Day/);
  assert.equal(html.includes('$99'), false);
  assert.equal(html.includes('$249'), false);
  assert.equal(html.includes('$399'), false);
  assert.equal(html.includes('from $'), false);
  assert.match(html, /I'm interested in/);
  assert.match(html, /Banner row/);
  assert.match(html, /Fortune \+ Coin of the Day/);
  assert.match(html, /Reach out/);
  assert.match(html, /class="ad-strip"/);
  assert.match(html, /class="nav-ad"/);
  assert.match(html, /Book Coin of the Day/);
  const sold = sellHtml(NOW);
  assert.equal(sold.includes('$'), false);
  const payload = clientPayload(NOW, { bookings: [], env: {} });
  payload.packages.forEach((pack) => assert.equal(Object.prototype.hasOwnProperty.call(pack, 'price'), false));
  assert.match(html, /id="adv-package"/);
  assert.match(html, /id="adv-ticker"/);
  assert.match(html, /id="adv-ref"/);
  assert.match(html, /id="adv-date"/);
  assert.match(html, /id="adv-note"/);
  assert.match(html, /value="cotd" selected/);
  assert.match(html, /formspree\.io\/f\/xzdjaele/);
  assert.match(html, /window\.__CIPHER_SPONSOR__/);
  assert.match(html, /from-env/);
  assert.match(html, /waiting for CoinGecko/);
  const home = fs.readFileSync(path.join(__dirname, '..', 'templates', 'home.html'), 'utf8');
  const src = home.slice(home.indexOf('function renderCoinOfTheDay'), home.indexOf('function renderRugOfTheDay'));
  assert.ok(src.indexOf('sponsorForNyDay') !== -1);
  assert.ok(src.indexOf('sponsorForNyDay') < src.indexOf('STRICT FILTERS'));
  assert.match(home, /package==='banner'/);
  assert.match(home, /href="#advertise"/);
  const files = fs.readdirSync(path.join(__dirname, '..', 'api')).filter((name) => name.endsWith('.js'));
  assert.deepEqual(files.sort(), ['alerts.js', 'coingecko.js', 'scan.js', 'site.js']);
});

test('updates announce the sponsorship with a link to the form', () => {
  const row = updatesPayload().updates.find((item) => item.id === 'forced-cotd');
  assert.ok(row);
  assert.equal(row.href, '/#advertise');
  assert.match(row.summary, /SPONSORED/);
  assert.match(row.summary, /not a prediction/i);
});
