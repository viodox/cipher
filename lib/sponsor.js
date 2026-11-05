'use strict';

// Forced Coin of the Day.
// To book a day: edit data/sponsored-cotd.json or set the SPONSORED_COTD_* env
// vars, then redeploy. Leads come from the #advertise form. There is no card
// checkout in this build.
// TODO(stripe): if Michael wants cards on the site, fold Checkout into an
// existing function (api/site.js or api/alerts.js). Do not add a fifth
// serverless function on the Hobby plan.

const { esc } = require('./http-util');
const { spotlightOk } = require('../quality');

const PACKAGES = [
  {
    id: 'banner',
    name: 'Banner row only',
    price: 99,
    unit: 'day',
    blurb: 'The gold sponsored row in the scanner table: ticker, name, and a link. Labeled SPONSORED. Coin of the Day stays the organic pick.',
  },
  {
    id: 'cotd',
    name: 'Forced Coin of the Day',
    price: 249,
    unit: 'day',
    featured: true,
    blurb: 'Replaces the homepage Coin of the Day for the whole New York day. Logo, ticker, name, a short line, and a link. Labeled SPONSORED.',
  },
  {
    id: 'combo',
    name: 'Fortune + Coin of the Day',
    price: 399,
    unit: 'day',
    blurb: 'Homepage takeover, plus Cipher Fortune’s daily spin lands on your coin. Bonus spins stay random. Labeled paid placement. Not a prediction.',
  },
];

const ENV_KEYS = [
  'SPONSORED_COTD_DATE',
  'SPONSORED_COTD_ID',
  'SPONSORED_COTD_SYMBOL',
  'SPONSORED_COTD_NAME',
  'SPONSORED_COTD_LOGO',
  'SPONSORED_COTD_BLURB',
  'SPONSORED_COTD_HREF',
  'SPONSORED_COTD_FORCE_FORTUNE',
  'SPONSORED_COTD_PACKAGE',
];

function nyDayKey(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now == null ? Date.now() : now));
  const get = (type) => parts.find((part) => part.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

function safeHttps(value) {
  const href = String(value || '').trim();
  if (/^https:\/\/[^\s"'<>]+$/i.test(href) && href.length <= 400) return href;
  return '';
}

function safeHref(value) {
  const href = String(value || '').trim();
  if (safeHttps(href)) return href;
  if (/^\/[^\s"'<>]*$/.test(href) && !href.startsWith('//') && href.length <= 400) return href;
  return '';
}

function truthy(value) {
  return value === true || /^(1|true|yes)$/i.test(String(value || ''));
}

function normalizeBooking(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = String(raw.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  let id = String(raw.id || raw.coinId || '').trim().slice(0, 80);
  let symbol = String(raw.symbol || '').trim().replace(/^\$/, '').slice(0, 16);
  const name = String(raw.name || raw.displayName || '').trim().slice(0, 80);
  if (!id && !symbol) return null;
  if (!id) id = symbol.toLowerCase();
  if (!symbol) symbol = id.slice(0, 16);
  let packageId = String(raw.package || raw.tier || '').trim().toLowerCase();
  let force = truthy(raw.forceFortune);
  if (packageId === 'combo') force = true;
  if (force) packageId = 'combo';
  else if (packageId === 'banner') packageId = 'banner';
  else packageId = 'cotd';
  return {
    date,
    id,
    symbol: symbol.toUpperCase(),
    name: name || symbol.toUpperCase(),
    logo: safeHttps(raw.logo || raw.logoUrl),
    blurb: String(raw.blurb || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    href: safeHref(raw.href),
    forceFortune: force,
    package: packageId,
  };
}

function loadBookings() {
  const file = require('../data/sponsored-cotd.json');
  const rows = Array.isArray(file.bookings) ? file.bookings : [];
  return rows.map(normalizeBooking).filter(Boolean);
}

function bookingFromEnv(env) {
  const source = env || {};
  const date = String(source.SPONSORED_COTD_DATE || '').trim();
  if (!date) return null;
  return normalizeBooking({
    date,
    id: source.SPONSORED_COTD_ID,
    symbol: source.SPONSORED_COTD_SYMBOL,
    name: source.SPONSORED_COTD_NAME,
    logo: source.SPONSORED_COTD_LOGO,
    blurb: source.SPONSORED_COTD_BLURB,
    href: source.SPONSORED_COTD_HREF,
    forceFortune: source.SPONSORED_COTD_FORCE_FORTUNE,
    package: source.SPONSORED_COTD_PACKAGE,
  });
}

function listBookings(opts) {
  const options = opts || {};
  const explicit = options.bookings != null || options.env != null;
  const rows = (options.bookings != null
    ? options.bookings.map(normalizeBooking).filter(Boolean)
    : loadBookings()
  ).slice();
  const envSource = options.env != null ? options.env : (explicit ? null : process.env);
  const fromEnv = envSource ? bookingFromEnv(envSource) : null;
  if (!fromEnv) return rows;
  return rows.filter((row) => row.date !== fromEnv.date).concat([fromEnv]);
}

function activeBooking(now, opts) {
  const day = nyDayKey(now || Date.now());
  let hit = null;
  listBookings(opts).forEach((row) => {
    if (row.date === day) hit = row;
  });
  return hit;
}

function fortuneBooking(now, opts) {
  const booking = activeBooking(now, opts);
  if (!booking || !booking.forceFortune) return null;
  return booking;
}

function overridesCotd(booking, now) {
  if (!booking || booking.package === 'banner') return false;
  return booking.date === nyDayKey(now || Date.now());
}

function matchCoin(coins, booking) {
  const list = Array.isArray(coins) ? coins : [];
  const id = String(booking.id || '').toLowerCase();
  const symbol = String(booking.symbol || '').toUpperCase();
  return list.find((coin) => String(coin.id || '').toLowerCase() === id)
    || list.find((coin) => String(coin.symbol || '').toUpperCase() === symbol)
    || null;
}

function displayForBooking(coins, booking) {
  const live = matchCoin(coins, booking);
  const id = (live && live.id) || booking.id;
  const symbol = String(booking.symbol || (live && live.symbol) || id || 'COIN').replace(/^\$/, '').toUpperCase();
  const name = booking.name || (live && live.name) || symbol;
  return {
    id,
    symbol,
    name,
    image: booking.logo || (live && (live.image || '')) || '',
    blurb: booking.blurb || '',
    href: booking.href || (id ? '/coin/' + encodeURIComponent(id) : ''),
    live: !!live,
    forceFortune: !!booking.forceFortune,
    price: live ? (live.current_price != null ? live.current_price : live.price) : null,
    change24h: live ? (live.price_change_percentage_24h != null ? live.price_change_percentage_24h : live.change24h) : null,
    marketCap: live ? (live.market_cap != null ? live.market_cap : live.marketCap) : null,
    volume: live ? (live.total_volume != null ? live.total_volume : live.volume) : null,
  };
}

// Organic rotation keeps the existing local-date seed used in the homepage
// script. Paid days use the America/New_York date instead.
function pickOrganicCotd(coins, now, opts) {
  const list = Array.isArray(coins) ? coins : [];
  const today = new Date(now || Date.now());
  const seed = today.getFullYear() * 10000 + today.getMonth() * 100 + today.getDate();
  const trending = opts && opts.trendingIds ? opts.trendingIds : new Set();
  const eligible = list.filter((coin) => {
    if (!spotlightOk(coin)) return false;
    if ((coin.rug || 0) >= 70) return false;
    if ((coin.total_volume || 0) < 50000) return false;
    if ((coin.market_cap || 0) < 100000) return false;
    if (Math.abs(coin.price_change_percentage_24h || 0) < 0.01 && (coin.total_volume || 0) < 500000) return false;
    return true;
  });
  if (!eligible.length) return null;
  const scored = eligible.map((coin) => {
    const absChange = Math.min(Math.abs(coin.price_change_percentage_24h || 0), 100);
    const volRatio = coin.market_cap > 0 ? Math.min(coin.total_volume / coin.market_cap, 3) : 0;
    const isTrending = trending.has(coin.id) ? 15 : 0;
    const viral = Number(coin.viral) || 0;
    const score = (absChange * 0.3) + (volRatio * 10) + (viral * 0.3) + isTrending;
    return Object.assign({}, coin, { cotdScore: score });
  }).sort((a, b) => b.cotdScore - a.cotdScore || String(a.id).localeCompare(String(b.id)));
  const pool = scored.slice(0, Math.min(10, scored.length));
  return pool[seed % pool.length];
}

function decideCotd(coins, opts) {
  const options = opts || {};
  const now = options.now || Date.now();
  const booking = options.booking || null;
  if (overridesCotd(booking, now)) {
    return { source: 'sponsored', booking, coin: displayForBooking(coins, booking) };
  }
  return { source: 'organic', booking: null, coin: pickOrganicCotd(coins, now, options) };
}

function publicBooking(row) {
  return {
    date: row.date,
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    logo: row.logo,
    blurb: row.blurb,
    href: row.href,
    forceFortune: row.forceFortune,
    package: row.package,
  };
}

function clientPayload(now, opts) {
  return {
    generatedDay: nyDayKey(now || Date.now()),
    bookings: listBookings(opts).map(publicBooking),
    packages: PACKAGES.map((pack) => ({
      id: pack.id,
      name: pack.name,
      price: pack.price,
      unit: pack.unit,
    })),
  };
}

function money(price) {
  return '$' + Number(price);
}

function sellHtml(now) {
  const day = nyDayKey(now || Date.now());
  const cards = PACKAGES.map((pack) => {
    const flag = pack.featured ? '<div class="ad-flag">Start here</div>' : '';
    return '<article class="ad-pack' + (pack.featured ? ' featured' : '') + '">'
      + flag
      + '<div class="ad-name">' + esc(pack.name) + '</div>'
      + '<div class="ad-price">' + money(pack.price) + ' <span>/ ' + esc(pack.unit) + '</span></div>'
      + '<p>' + esc(pack.blurb) + '</p>'
      + '</article>';
  }).join('');
  const options = PACKAGES.map((pack) => (
    '<option value="' + esc(pack.id) + '"' + (pack.id === 'cotd' ? ' selected' : '') + '>'
      + esc(pack.name) + ' — ' + money(pack.price) + '/' + esc(pack.unit)
      + '</option>'
  )).join('');
  return '<section id="advertise" class="ad-sell">'
    + '<div class="ad-kicker">Sponsored placement</div>'
    + '<h2>Forced Coin of the Day</h2>'
    + '<p class="ad-lead">Take over Coin of the Day. Every homepage visitor sees your coin at the top, for the whole New York day, with a SPONSORED label so paid and organic stay honest.</p>'
    + '<ul class="ad-benefits">'
    + '<li>Every homepage visitor sees it at the top of the page.</li>'
    + '<li>It stays up for the whole America/New_York day.</li>'
    + '<li>The banner says SPONSORED and Forced Coin of the Day. Organic picks do not.</li>'
    + '<li>Optional Cipher Fortune lock: the daily spin lands on your coin. Bonus spins stay random. Entertainment only — not a prediction.</li>'
    + '<li>The banner links to your coin page, contract, or DEX, and the placement is easy to share.</li>'
    + '</ul>'
    + '<div class="ad-packages">' + cards + '</div>'
    + '<form id="advertise-form" class="ad-form" action="https://formspree.io/f/xzdjaele" method="POST" onsubmit="return submitAdvert(event)">'
    + '<input type="hidden" name="inquiry" value="Forced Coin of the Day">'
    + '<label>Email<input id="adv-email" name="email" type="email" required maxlength="160" placeholder="you@project.com" autocomplete="email"></label>'
    + '<label>Project<input id="adv-project" name="project" type="text" required maxlength="80" placeholder="project name" autocomplete="organization"></label>'
    + '<label>Package<select id="adv-package" name="package">' + options + '</select></label>'
    + '<label>Preferred New York date<input id="adv-date" name="preferredDate" type="date" min="' + esc(day) + '"></label>'
    + '<label>Ticker<input id="adv-ticker" name="ticker" type="text" required maxlength="16" placeholder="TICKER" autocomplete="off"></label>'
    + '<label>Chain, contract, or CoinGecko id<input id="adv-ref" name="contractOrId" type="text" maxlength="120" placeholder="solana + mint, or dogecoin" autocomplete="off"></label>'
    + '<label class="wide">Note<textarea id="adv-note" name="note" maxlength="400" placeholder="logo link, blurb, DEX or coin page"></textarea></label>'
    + '<div class="wide"><button type="submit" id="adv-btn" class="ad-submit">Book Coin of the Day</button></div>'
    + '</form>'
    + '<p id="adv-msg" role="status">Request received. We will email you to lock the day.</p>'
    + '<p class="ad-note">Starter rates. Every placement is labeled SPONSORED. We do not publish a visitor count we cannot verify. This is an ad, not financial advice, and not a prize.</p>'
    + '</section>';
}

module.exports = {
  PACKAGES,
  ENV_KEYS,
  nyDayKey,
  safeHref,
  normalizeBooking,
  loadBookings,
  bookingFromEnv,
  listBookings,
  activeBooking,
  fortuneBooking,
  overridesCotd,
  displayForBooking,
  pickOrganicCotd,
  decideCotd,
  clientPayload,
  sellHtml,
};
