'use strict';

const crypto = require('crypto');
const { esc } = require('./http-util');
const { copyAddressHtml } = require('./copy-address');
const { shell, buyButtonsHtml, whereToBuyHtml, SITE } = require('./chrome');
const { alertsReady } = require('./alerts-ready');
const { safeImage, fmtMoney, fmtPrice, fmtPct } = require('./format');
const { proxyCoinGeckoJson } = require('./coingecko');
const { loadMovers } = require('./movers');
const { peekBoard } = require('./board');
const { loadCoin } = require('./coin');
const { checkToken } = require('./ape');
const { cacheGet, cacheSet } = require('./store');
const { postHref } = require('./share');
const { fortuneBooking } = require('./sponsor');

const SEGMENT_COUNT = 20;
const DAY_CACHE = 'cipher:fortune:v1:';
const memory = { at: 0, key: '', value: null };

const FORTUNE_LINES = [
  'Decoded for fun. The glyphs do not know the chart.',
  'Today’s stamp is a toy cipher, not a call.',
  'The wheel picked a coin. It did not pick a trade.',
  'A random read of a real market snapshot. Nothing more.',
  'The decoder landed here. Price can leave just as fast.',
  'Glyphs for the day. They are not a target price.',
];

function resetFortuneMemory() {
  memory.at = 0;
  memory.key = '';
  memory.value = null;
}

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

function secondsUntilNextNyDay(now) {
  const start = nyDayKey(now);
  let t = now;
  for (let i = 0; i < 64; i += 1) {
    t += 30 * 60 * 1000;
    if (nyDayKey(t) !== start) return Math.max(120, Math.ceil((t - now) / 1000) + 7200);
  }
  return 26 * 3600;
}

function hashIndex(seed, length) {
  const n = Math.max(0, length | 0);
  if (!n) return 0;
  const buf = crypto.createHash('sha256').update(String(seed)).digest();
  return buf.readUInt32BE(0) % n;
}

function wheelEase(t) {
  const x = Math.min(1, Math.max(0, Number(t) || 0));
  if (x < 0.14) {
    const u = x / 0.14;
    return 0.045 * u * u;
  }
  if (x < 0.5) {
    const u = (x - 0.14) / 0.36;
    return 0.045 + 0.70 * u;
  }
  if (x < 0.9) {
    const u = (x - 0.5) / 0.4;
    return 0.745 + 0.235 * (1 - Math.pow(1 - u, 3));
  }
  const u = (x - 0.9) / 0.1;
  return 0.98 + 0.02 * u + 0.014 * Math.sin(u * Math.PI);
}

function segmentAt(rotation, count) {
  const n = Math.max(1, count | 0);
  const seg = 360 / n;
  const norm = ((rotation % 360) + 360) % 360;
  const pointerWheelAngle = (360 - norm) % 360;
  let index = Math.round(pointerWheelAngle / seg) % n;
  if (index < 0) index += n;
  return index;
}

function landingRotation(from, index, count, turns) {
  const n = Math.max(1, count | 0);
  const seg = 360 / n;
  const desiredMod = (360 - (((index % n) + n) % n) * seg) % 360;
  const fromMod = ((from % 360) + 360) % 360;
  let add = desiredMod - fromMod;
  if (add <= 2) add += 360;
  return from + Math.max(0, turns | 0) * 360 + add;
}

function bonusIndex(roll, length, avoid) {
  const n = length | 0;
  if (n <= 1) return 0;
  let index = (Number(roll) >>> 0) % n;
  if (index === avoid) index = (index + 1) % n;
  return index;
}

function fortuneLine(dayKey, id) {
  return FORTUNE_LINES[hashIndex('cipher-fortune-line|' + dayKey + '|' + id, FORTUNE_LINES.length)];
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function riskNotes(token) {
  const notes = [];
  if (token.letter) {
    notes.push('Ape Check ' + token.letter + ' is a safety receipt for that contract. It is not a rating of the coin as a trade, and not a recommendation.');
  } else {
    notes.push('No Ape Check letter is attached on this card. A missing letter is not a clean bill of health.');
  }
  if (token.verdicts && token.verdicts[0]) notes.push(String(token.verdicts[0]));
  if (token.change24h != null && Math.abs(token.change24h) >= 30) notes.push('The 24 hour move is large. Big moves cut both ways.');
  if (token.marketCap > 0 && token.marketCap < 2e6) notes.push('Market cap is small. Small coins can gap when trading is thin.');
  if (token.volume && token.marketCap && token.volume > token.marketCap) notes.push('Volume is larger than market cap today. That can be attention, wash trading, or both.');
  return notes.slice(0, 4);
}

function buildPool(coins, board) {
  const grades = new Map();
  (board || []).forEach((row) => {
    const sym = String((row && row.symbol) || '').toUpperCase();
    if (!sym || sym === '???') return;
    if (!grades.has(sym)) grades.set(sym, row);
  });
  const out = [];
  const seen = new Set();
  (coins || []).forEach((coin) => {
    if (!coin || !coin.id || !coin.symbol) return;
    const id = String(coin.id);
    if (seen.has(id)) return;
    seen.add(id);
    const symbol = String(coin.symbol).toUpperCase().slice(0, 16);
    const graded = grades.get(symbol);
    const match = graded && (!graded.coinId || graded.coinId === id);
    const chain = match ? (graded.chain || '') : '';
    const address = match ? (graded.address || '') : '';
    out.push({
      id,
      symbol,
      name: String(coin.name || id).slice(0, 80),
      price: asNumber(coin.price != null ? coin.price : coin.current_price),
      change24h: asNumber(coin.change24h != null ? coin.change24h : coin.price_change_percentage_24h),
      marketCap: asNumber(coin.marketCap != null ? coin.marketCap : coin.market_cap) || 0,
      volume: asNumber(coin.volume != null ? coin.volume : coin.total_volume) || 0,
      image: safeImage(coin.image),
      letter: match ? (graded.letter || '') : '',
      chain,
      address,
      score: match && graded.score != null ? graded.score : null,
      checkHref: match && graded.href ? graded.href : (chain && address ? '/check/' + chain + '/' + address : ''),
      href: '/coin/' + encodeURIComponent(id),
      verdicts: [],
    });
  });
  out.sort((a, b) => (b.marketCap - a.marketCap) || a.id.localeCompare(b.id));
  return out;
}

function seededOrder(items, seed) {
  return items.slice().sort((a, b) => {
    const ha = hashIndex(seed + '|' + a.id, 1000000000);
    const hb = hashIndex(seed + '|' + b.id, 1000000000);
    return ha - hb || a.id.localeCompare(b.id);
  });
}

function layoutWheel(pool, dayKey, forcedId) {
  if (!pool.length) {
    return { winner: null, segments: [], winnerSlot: 0, poolSize: 0, winnerIndex: 0, source: 'empty' };
  }
  let winnerIndex = hashIndex('cipher-fortune-v1|' + dayKey, pool.length);
  let source = 'formula';
  if (forcedId) {
    const found = pool.findIndex((coin) => coin.id === forcedId);
    if (found >= 0) {
      winnerIndex = found;
      source = 'day-cache';
    }
  }
  const winner = pool[winnerIndex];
  const rest = pool.filter((_, index) => index !== winnerIndex);
  const ordered = seededOrder(rest, 'cipher-fortune-wheel|' + dayKey);
  const count = Math.min(SEGMENT_COUNT, pool.length);
  const segments = ordered.slice(0, Math.max(0, count - 1));
  const slot = hashIndex('cipher-fortune-slot|' + dayKey, Math.max(count, 1));
  segments.splice(Math.min(slot, segments.length), 0, winner);
  const winnerSlot = Math.max(0, segments.findIndex((coin) => coin.id === winner.id));
  return { winner, segments, winnerSlot, poolSize: pool.length, winnerIndex, source };
}

function annotate(model) {
  const paint = (token) => {
    if (!token) return token;
    token.line = fortuneLine(model.dayKey, token.id);
    token.notes = riskNotes(token);
    return token;
  };
  if (model.winner) paint(model.winner);
  (model.segments || []).forEach(paint);
  return model;
}

function emptyModel(now) {
  return annotate({
    ok: false,
    dayKey: nyDayKey(now || Date.now()),
    winner: null,
    segments: [],
    winnerSlot: 0,
    poolSize: 0,
    winnerIndex: 0,
    source: 'empty',
    note: 'The coin list did not load. Refresh in a minute. The wheel uses the cached market list, not a fixed set of tickers.',
  });
}

function placeSponsor(pool, booking) {
  const symbol = String(booking.symbol || '').toUpperCase();
  let index = pool.findIndex((coin) => coin.id === booking.id);
  if (index < 0 && symbol) index = pool.findIndex((coin) => coin.symbol === symbol);
  if (index < 0) {
    pool.unshift({
      id: booking.id || symbol.toLowerCase() || 'sponsor',
      symbol: (symbol || 'COIN').slice(0, 16),
      name: booking.name || symbol || 'Sponsored coin',
      price: null,
      change24h: null,
      marketCap: 0,
      volume: 0,
      image: booking.logo || '',
      letter: '',
      chain: '',
      address: '',
      score: null,
      checkHref: '',
      href: booking.href || '',
      verdicts: [],
      sponsored: true,
      blurb: booking.blurb || '',
    });
    return pool[0].id;
  }
  const coin = pool[index];
  coin.sponsored = true;
  if (booking.blurb) coin.blurb = booking.blurb;
  if (booking.href) coin.href = booking.href;
  if (booking.logo) coin.image = booking.logo;
  if (booking.name) coin.name = booking.name;
  return coin.id;
}

function modelFromCoins(coins, board, now, opts) {
  const options = opts || {};
  const dayKey = nyDayKey(now || Date.now());
  const pool = buildPool(coins, board);
  const booking = options.sponsor || null;
  if (booking && booking.forceFortune && booking.date === dayKey) {
    const forcedId = placeSponsor(pool, booking);
    const laid = layoutWheel(pool, dayKey, forcedId);
    if (!laid.winner || laid.winner.id !== forcedId) return emptyModel(now || Date.now());
    laid.source = 'sponsored';
    return annotate(Object.assign({ ok: true, dayKey, note: '', sponsored: true }, laid));
  }
  if (!pool.length) return emptyModel(now || Date.now());
  const laid = layoutWheel(pool, dayKey, options.storedId || '');
  return annotate(Object.assign({ ok: true, dayKey, note: '', sponsored: false }, laid));
}

function syncSegment(model) {
  const slot = model.segments[model.winnerSlot];
  if (slot && model.winner && slot.id === model.winner.id) {
    model.segments[model.winnerSlot] = Object.assign({}, slot, model.winner);
  }
}

async function enrichWinner(model, options) {
  const winner = model.winner;
  if (!winner) return;
  const loader = options.loadCoin || loadCoin;
  let detail = null;
  try {
    detail = await Promise.race([
      loader(winner.id),
      new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
  } catch (err) { detail = null; }
  if (detail && detail.ok && detail.coin) {
    const scan = (detail.coin.scans || []).find((row) => ['eth', 'bsc', 'base', 'sol'].includes(row.chain));
    if (scan && !winner.address) {
      winner.chain = scan.chain;
      winner.address = scan.address;
      winner.checkHref = '/check/' + scan.chain + '/' + scan.address;
    }
    if (detail.coin.price != null) winner.price = detail.coin.price;
    if (detail.coin.change24h != null) winner.change24h = detail.coin.change24h;
    if (detail.coin.marketCap != null) winner.marketCap = detail.coin.marketCap;
    if (detail.coin.volume != null) winner.volume = detail.coin.volume;
    if (detail.coin.name && !winner.sponsored) winner.name = String(detail.coin.name).slice(0, 80);
  }
  if (options.grade !== 0 && !winner.letter && winner.chain && winner.address) {
    const grader = options.gradeFn || checkToken;
    let report = null;
    try {
      report = await Promise.race([
        grader(winner.chain, winner.address),
        new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
      ]);
    } catch (err) { report = null; }
    const symbolOk = !report || !report.symbol || !winner.symbol || String(report.symbol).toUpperCase() === winner.symbol;
    const chainOk = !report || !report.chain || report.chain === winner.chain;
    if (report && report.ok && report.letter && symbolOk && chainOk) {
      winner.letter = report.letter;
      winner.score = report.score;
      if (Array.isArray(report.verdicts)) winner.verdicts = report.verdicts.slice(0, 2);
    }
  }
  syncSegment(model);
  annotate(model);
}

async function loadMarketCoins() {
  const hit = await proxyCoinGeckoJson('coins/markets', {
    vs_currency: 'usd',
    category: 'meme-token',
    order: 'market_cap_desc',
    per_page: '250',
    page: '1',
    price_change_percentage: '24h',
  });
  if (hit.ok && Array.isArray(hit.json) && hit.json.length) return hit.json;
  const movers = await loadMovers();
  if (!movers.ok) return [];
  const map = new Map();
  [].concat(movers.gainers || [], movers.losers || [], movers.volumeSpikes || []).forEach((row) => {
    if (row && row.id && !map.has(row.id)) map.set(row.id, row);
  });
  return [...map.values()];
}

async function loadFortune(opts) {
  const options = opts || {};
  const now = options.now || Date.now();
  const dayKey = nyDayKey(now);
  const sponsor = options.sponsor === undefined ? fortuneBooking(now) : (options.sponsor || null);
  const forced = !!(sponsor && sponsor.forceFortune && sponsor.date === dayKey);
  const passed = Object.assign({}, options, { sponsor: forced ? sponsor : null });
  if (options.coins) return modelFromCoins(options.coins, options.board || [], now, passed);
  const memoryHit = memory.value && memory.key === dayKey && (now - memory.at) < 8 * 60 * 1000;
  if (!options.force && memoryHit && !!memory.value.sponsored === forced) return memory.value;
  let coins = [];
  try { coins = await loadMarketCoins(); }
  catch (err) { coins = []; }
  const board = options.board || (peekBoard() && peekBoard().rows) || [];
  let storedId = options.storedId || '';
  if (forced) storedId = '';
  else if (!storedId && !options.skipStore) {
    const saved = await cacheGet(DAY_CACHE + dayKey);
    if (saved && saved.id) storedId = String(saved.id);
  }
  const model = modelFromCoins(coins, board, now, { storedId, sponsor: forced ? sponsor : null });
  if (!model.ok) return model;
  if (!options.skipStore && model.source !== 'day-cache' && model.source !== 'sponsored') {
    await cacheSet(DAY_CACHE + dayKey, { id: model.winner.id, symbol: model.winner.symbol, at: new Date(now).toISOString() }, secondsUntilNextNyDay(now));
  }
  if (!options.skipDetail) await enrichWinner(model, options);
  memory.at = now;
  memory.key = dayKey;
  memory.value = model;
  return model;
}

function loadFortuneBounded(opts) {
  const options = opts || {};
  return Promise.race([
    loadFortune(options),
    new Promise((resolve) => setTimeout(() => resolve(null), options.budgetMs || 6500)),
  ]).then((model) => model || emptyModel(options.now));
}

function cookieReveals(cookieHeader, model) {
  if (!model || !model.winner) return false;
  const raw = String(cookieHeader || '');
  const match = raw.match(/(?:^|;\s*)cf_fortune=([^;]+)/);
  if (!match) return false;
  let value = match[1];
  try { value = decodeURIComponent(value); } catch (err) { /* keep raw */ }
  return value === model.dayKey + ':' + model.winner.id;
}

function parkAngle(model, onWinner) {
  const n = model.segments ? model.segments.length : 0;
  if (!n) return 0;
  const index = onWinner ? model.winnerSlot : (model.winnerSlot + Math.floor(n / 2)) % n;
  return landingRotation(0, index, n, 0);
}

function shareCopy(token, bonus) {
  const symbol = token && token.symbol ? '$' + token.symbol : 'a coin';
  if (!bonus && token && token.sponsored) {
    return 'Cipher Fortune — ' + symbol + '\nToday’s spin is a sponsored placement. Not a prediction.\n' + SITE + '/cipher-fortune';
  }
  const head = bonus ? 'Cipher Fortune bonus spin — ' + symbol : 'Cipher Fortune — ' + symbol;
  return head + '\nSpin the wheel, land on a random coin, get today’s decoded breakdown.\nFree. For fun. Not a prediction.\n' + SITE + '/cipher-fortune';
}

function polar(cx, cy, r, deg) {
  const rad = deg * Math.PI / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

function wheelTicker(symbol) {
  const clean = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return '$' + (clean || '?');
}

function wheelFontSize(label) {
  const len = label.length;
  if (len <= 5) return 15;
  if (len <= 7) return 13;
  if (len <= 9) return 11;
  return 9;
}

function wheelSvg(segments) {
  const cx = 200;
  const cy = 200;
  const outer = 176;
  const inner = 78;
  const n = Math.max(segments.length, 1);
  const seg = 360 / n;
  const slices = (segments || []).map((token, i) => {
    const start = i * seg - seg / 2;
    const end = start + seg;
    const large = seg > 180 ? 1 : 0;
    const o1 = polar(cx, cy, outer, start);
    const o2 = polar(cx, cy, outer, end);
    const i1 = polar(cx, cy, inner, start);
    const i2 = polar(cx, cy, inner, end);
    const d = 'M ' + o1[0].toFixed(2) + ' ' + o1[1].toFixed(2)
      + ' A ' + outer + ' ' + outer + ' 0 ' + large + ' 1 ' + o2[0].toFixed(2) + ' ' + o2[1].toFixed(2)
      + ' L ' + i2[0].toFixed(2) + ' ' + i2[1].toFixed(2)
      + ' A ' + inner + ' ' + inner + ' 0 ' + large + ' 0 ' + i1[0].toFixed(2) + ' ' + i1[1].toFixed(2)
      + ' Z';
    const label = wheelTicker(token.symbol);
    const mid = i * seg;
    const at = polar(cx, cy, 132, mid);
    const size = wheelFontSize(label);
    const rot = mid - 90;
    return '<path class="cf-slice ' + (i % 2 ? 'cf-slice-b' : 'cf-slice-a') + '" d="' + d + '"></path>'
      + '<text class="cf-label" x="' + at[0].toFixed(2) + '" y="' + at[1].toFixed(2) + '" font-size="' + size + '" text-anchor="middle" dominant-baseline="middle" transform="rotate(' + rot.toFixed(2) + ' ' + at[0].toFixed(2) + ' ' + at[1].toFixed(2) + ')">' + esc(label) + '</text>';
  }).join('');
  return '<svg class="cf-svg" viewBox="0 0 400 400" role="img" aria-label="Cipher wheel of real coins">'
    + '<circle class="cf-disc" cx="200" cy="200" r="176"></circle>'
    + slices
    + '<circle class="cf-ring" cx="200" cy="200" r="176"></circle>'
    + '</svg>';
}

function hubSvg() {
  const cx = 70;
  const cy = 70;
  let bezel = '';
  for (let i = 0; i < 12; i += 1) {
    const a = i * 30;
    const p1 = polar(cx, cy, 46, a);
    const p2 = polar(cx, cy, 54, a);
    bezel += '<line class="cf-tick" x1="' + p1[0].toFixed(2) + '" y1="' + p1[1].toFixed(2) + '" x2="' + p2[0].toFixed(2) + '" y2="' + p2[1].toFixed(2) + '"></line>';
  }
  return '<svg class="cf-hub-svg" viewBox="0 0 140 140" aria-hidden="true">'
    + '<circle class="cf-hub" cx="70" cy="70" r="62"></circle>'
    + bezel
    + '<circle class="cf-hub-ring" cx="70" cy="70" r="36"></circle>'
    + '<text class="cf-hub-word" x="70" y="71" font-size="13" text-anchor="middle" dominant-baseline="middle">CIPHER</text>'
    + '</svg>';
}

function pointerSvg() {
  return '<svg class="cf-pointer" viewBox="0 0 36 24" aria-hidden="true"><polygon points="18,22 3,2 33,2"></polygon></svg>';
}

function resultInner(token, mode) {
  if (!token) return '';
  const bonus = mode === 'bonus';
  const kicker = bonus ? 'Bonus spin — not today’s Cipher Fortune' : 'Today’s Cipher Fortune';
  const change = token.change24h == null ? 'n/a' : fmtPct(token.change24h);
  const changeClass = token.change24h == null ? '' : (token.change24h >= 0 ? 'pos' : 'neg');
  const chain = token.chain ? String(token.chain).toUpperCase() : '';
  const contract = token.address
    ? (chain ? esc(chain) + ' · ' : '') + copyAddressHtml(token.address, { label: 'Copy contract address', full: true })
    : 'Contract not on this snapshot. Open the coin page for the market listing.';
  const grade = token.letter && token.checkHref
    ? '<a class="cf-grade" href="' + esc(token.checkHref) + '">Ape Check ' + esc(token.letter) + '</a>'
    : '<span class="cf-grade muted">No letter on this spin</span>';
  const notes = (token.notes || []).map((line) => '<li>' + esc(line) + '</li>').join('');
  const img = token.image ? '<img src="' + esc(token.image) + '" alt="" width="64" height="64">' : '';
  const paid = !bonus && token.sponsored;
  const badge = paid
    ? '<p class="cf-paid-note"><span class="cf-sponsored">SPONSORED</span> Paid placement. Forced Coin of the Day. Not a prediction.</p>'
    : '';
  const blurb = !bonus && token.blurb ? '<p class="cf-line">' + esc(token.blurb) + '</p>' : '';
  return '<div class="cf-result-top"><p class="cf-kicker">' + esc(kicker) + '</p><div class="cf-stamp">DECODED</div></div>'
    + badge
    + '<div class="cf-id">' + img + '<div><h2 id="cf-landed" tabindex="-1">$' + esc(token.symbol || 'COIN') + '</h2><p>' + esc(token.name || '') + '</p></div></div>'
    + blurb
    + '<dl class="cf-stats"><div><dt>Price</dt><dd>' + esc(fmtPrice(token.price)) + '</dd></div>'
    + '<div><dt>24h</dt><dd class="' + changeClass + '">' + esc(change) + '</dd></div>'
    + '<div><dt>Market cap</dt><dd>' + esc(token.marketCap ? fmtMoney(token.marketCap) : 'n/a') + '</dd></div>'
    + '<div><dt>Volume</dt><dd>' + esc(token.volume ? fmtMoney(token.volume) : 'n/a') + '</dd></div></dl>'
    + '<p class="cf-contract">' + contract + '</p>'
    + '<p class="cf-links">' + grade + ' <a href="' + esc(token.href || '/movers') + '">Coin page</a></p>'
    + '<ul class="cf-notes">' + notes + '</ul>'
    + '<p class="cf-line">' + esc(token.line || '') + '</p>'
    + '<p class="cf-remember">This browser remembers today’s coin until the New York date changes. Spin again is for fun and does not replace it.</p>'
    + '<a class="btn x" id="cf-share" href="' + esc(postHref(shareCopy(token, bonus))) + '">Post this fortune on X</a>';
}

function algorithmText(model) {
  const count = model.poolSize || 0;
  const day = model.dayKey || '';
  if (model.sponsored) {
    return 'Today’s coin is a paid placement for the New York date ' + day + '. '
      + 'The homepage calls the same placement Forced Coin of the Day. '
      + 'This page labels it SPONSORED. It is not a prediction. '
      + 'The spin reveals that coin. '
      + 'Spin again uses a separate random number in your browser and is labeled a bonus spin. It does not replace today’s pick.';
  }
  return 'Today’s coin is one shared pick for the New York date ' + day + '. '
    + 'The formula is SHA-256 of “cipher-fortune-v1|' + day + '”, then modulo the cached coin list'
    + (count ? ' (' + count + ' coins, sorted by market cap)' : '')
    + '. The first build of that date is stored so a later list change does not swap the coin. '
    + 'The spin reveals that coin. It is not weighted toward any holding. '
    + 'Spin again uses a separate random number in your browser and is labeled a bonus spin. It does not replace today’s pick.';
}

function fortuneCss() {
  return `<style>
.cf-disclaimer{color:var(--secondary);font-size:15px;line-height:1.55;margin:0 0 1rem}
.cf-stage{position:relative;width:min(92vw,520px);margin:0.25rem auto 0}
.cf-pointer{position:absolute;z-index:2;left:50%;top:0;width:28px;height:20px;transform:translateX(-50%);display:block}
.cf-pointer polygon{fill:var(--accent)}
.cf-rotor{width:100%;margin-top:16px;aspect-ratio:1}
.cf-hub-lock{position:absolute;left:0;right:0;bottom:0;height:calc(100% - 16px);display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:2}
.cf-hub-svg{width:34%;height:auto;display:block}
.cf-svg{display:block;width:100%;height:auto}
.cf-disc{fill:var(--bg)}
.cf-slice{stroke:var(--bg);stroke-width:1.5}
.cf-slice-a{fill:var(--surface)}
.cf-slice-b{fill:var(--surface2);fill:color-mix(in srgb, var(--accent) 18%, var(--bg))}
.cf-ring{fill:none;stroke:var(--accent);stroke-width:2}
.cf-hub{fill:var(--bg);stroke:var(--accent);stroke-width:1.5}
.cf-hub-ring{fill:none;stroke:var(--border2);stroke-width:1}
.cf-tick{stroke:var(--accent);stroke-width:1.5;stroke-linecap:butt}
.cf-label{fill:var(--text);font-family:'Share Tech Mono',monospace}
.cf-hub-word{fill:var(--accent);font-family:Orbitron,monospace;font-weight:700;letter-spacing:.14em}
.cf-controls{width:min(92vw,520px);margin:1.15rem auto 0;display:grid;grid-template-columns:1fr 148px;gap:10px;align-items:stretch}
.cf-spin,.cf-sound{height:52px;min-height:52px;border-radius:4px;cursor:pointer;touch-action:manipulation}
.cf-spin{width:100%;padding:0 18px;border:none;background:var(--accent);color:var(--on-accent);font-family:Orbitron,monospace;font-size:16px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.cf-spin:disabled{cursor:not-allowed;filter:grayscale(.35)}
.cf-spin:focus-visible,.cf-sound:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
.cf-sound{padding:0 12px;border:1px solid var(--border2);background:var(--surface);color:var(--text);font-family:Orbitron,monospace;font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.cf-status{max-width:40rem;min-height:1.4em;margin:.75rem auto 0;padding:0 1rem;text-align:center;color:var(--secondary)}
.cf-result{background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:1.05rem 1.1rem 1.15rem;margin:1.6rem 0 1.15rem}
.cf-result[hidden]{display:none}
.cf-result-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 .85rem}
.cf-kicker{font-family:Orbitron,monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin:0}
.cf-stamp{flex:0 0 auto;border:1px solid var(--accent);color:var(--accent);font-family:Orbitron,monospace;font-weight:700;font-size:12px;letter-spacing:.16em;padding:6px 8px;line-height:1}
.cf-id{display:flex;gap:14px;align-items:center;margin-bottom:.85rem}
.cf-id img{width:56px;height:56px;border-radius:50%;border:1px solid var(--border2);background:var(--bg);object-fit:cover}
.cf-id h2{font-size:30px;margin:0;color:var(--text);letter-spacing:.04em}
.cf-id p{margin:.15rem 0 0;color:var(--secondary);font-size:16px}
.cf-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 .8rem}
.cf-stats div{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 10px;min-width:0}
.cf-stats dt{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--secondary)}
.cf-stats dd{margin:3px 0 0;font-family:Orbitron,monospace;font-size:15px;color:var(--text);overflow-wrap:anywhere}
.cf-contract,.cf-line,.cf-remember,.cf-how{color:var(--secondary);font-size:16px;line-height:1.6}
.cf-links{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin:.45rem 0 .7rem}
.cf-grade{font-family:Orbitron,monospace;font-size:18px;font-weight:700;color:var(--accent);text-decoration:none}
.cf-grade.muted{color:var(--secondary);font-size:15px;font-weight:400}
.cf-notes{margin:.1rem 0 .75rem 1.1rem;color:var(--text);font-size:16px;line-height:1.55}
.cf-how{margin:0 0 1rem}
.cf-promo{color:var(--text);font-size:16px;line-height:1.55;margin:-.2rem 0 1rem}
.cf-promo a{color:var(--accent);font-weight:700}
.cf-paid-note{color:var(--text);font-size:16px;line-height:1.55;margin:0 0 .85rem;border:1px solid var(--warn);border-radius:6px;padding:8px 10px;background:var(--bg)}
.cf-sponsored{display:inline-block;margin-right:6px;background:var(--warn);color:var(--on-warn);font-family:Orbitron,monospace;font-size:11px;font-weight:700;letter-spacing:.12em;padding:3px 7px;border-radius:3px;vertical-align:1px}
.faq details{border-top:1px solid var(--border);padding:.7rem 0}
.faq summary{cursor:pointer;color:var(--text);font-family:Orbitron,monospace;font-size:14px}
.faq p{color:var(--secondary);font-size:16px;line-height:1.65}
@keyframes cf-pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.cf-stamp.pop{animation:cf-pop .35s ease-out both}
@media(max-width:640px){
  .cf-stats{grid-template-columns:1fr 1fr}
  .cf-id h2{font-size:26px}
  .cf-controls{grid-template-columns:1fr 132px}
  .cf-result-top{align-items:flex-start}
}
@media (prefers-reduced-motion: reduce){.cf-stamp.pop{animation:none}}
</style>`;
}

function clientScript(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const math = [wheelEase, segmentAt, landingRotation, bonusIndex].map((fn) => fn.toString()).join('\n');
  return '<script>\n' + math + '\n' + String.raw`
(function(){
  var data = __CF_JSON__;
  var segments = data.segments || [];
  var rotation = data.startAngle || 0;
  var spinning = false;
  var dailyDone = !!data.revealed;
  var reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var FULL_MS = 6400;
  var REDUCED_MS = 480;
  var audio = { ctx: null, noise: null, muted: false };
  var lastSeg = segments.length ? segmentAt(rotation, segments.length) : 0;
  var lastTick = 0;
  var prevEase = 0;
  try { audio.muted = localStorage.getItem('cipher-fortune-sound') === 'off'; } catch (e) {}

  function noiseBuffer(ctx) {
    if (audio.noise) return audio.noise;
    var seconds = 1.2;
    var n = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var channel = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < n; i++) {
      var white = Math.random() * 2 - 1;
      last = last * 0.55 + white * 0.45;
      channel[i] = white * 0.72 + last * 0.28;
    }
    audio.noise = buf;
    return buf;
  }
  function ensureAudio() {
    if (audio.muted) return null;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audio.ctx) audio.ctx = new AC();
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio.ctx;
  }
  function envGain(ctx, peak, attack, decay) {
    var g = ctx.createGain();
    var t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }
  function playTick(speed) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var fast = Math.max(0, Math.min(1, speed));
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.playbackRate.value = 0.88 + Math.random() * 0.36;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 480;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1650 + fast * 1100 + Math.random() * 180;
    bp.Q.value = 9;
    var peak = 0.36 - fast * 0.16;
    var g = envGain(ctx, peak, 0.0015, 0.018 + (1 - fast) * 0.02);
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(ctx.destination);
    var t = ctx.currentTime;
    src.start(t); src.stop(t + 0.07);
    var osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220 - fast * 50, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.028);
    var og = envGain(ctx, peak * 0.5, 0.001, 0.02);
    osc.connect(og); og.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.04);
  }
  function playWhoosh() {
    var ctx = ensureAudio();
    if (!ctx) return;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    var bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.Q.value = 0.65;
    var t = ctx.currentTime;
    bp.frequency.setValueAtTime(220, t);
    bp.frequency.exponentialRampToValueAtTime(1700, t + 0.5);
    bp.frequency.exponentialRampToValueAtTime(380, t + 1.35);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.065, t + 0.18);
    g.gain.exponentialRampToValueAtTime(0.028, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start(t); src.stop(t + 1.45);
  }
  function playThud(soft) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var mul = soft ? 0.32 : 1;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(156, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.18);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.52 * mul, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.3);
    var body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(84, t);
    body.frequency.exponentialRampToValueAtTime(36, t + 0.16);
    var gb = ctx.createGain();
    gb.gain.setValueAtTime(0.0001, t);
    gb.gain.exponentialRampToValueAtTime(0.3 * mul, t + 0.008);
    gb.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    body.connect(gb); gb.connect(ctx.destination);
    body.start(t); body.stop(t + 0.22);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 540;
    bp.Q.value = 1.3;
    var gn = envGain(ctx, 0.22 * mul, 0.002, 0.05);
    src.connect(bp); bp.connect(gn); gn.connect(ctx.destination);
    src.start(t); src.stop(t + 0.08);
    var t2 = t + 0.048;
    var knock = ctx.createOscillator();
    knock.type = 'sine';
    knock.frequency.setValueAtTime(96, t2);
    knock.frequency.exponentialRampToValueAtTime(40, t2 + 0.12);
    var gk = ctx.createGain();
    gk.gain.setValueAtTime(0.0001, t2);
    gk.gain.exponentialRampToValueAtTime(0.24 * mul, t2 + 0.008);
    gk.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.15);
    knock.connect(gk); gk.connect(ctx.destination);
    knock.start(t2); knock.stop(t2 + 0.16);
  }
  function paintSound() {
    var button = document.getElementById('cf-sound');
    if (!button) return;
    button.setAttribute('aria-pressed', audio.muted ? 'false' : 'true');
    button.textContent = audio.muted ? 'Sound off' : 'Sound on';
  }
  function setAngle(angle) {
    rotation = angle;
    var rotor = document.getElementById('cf-rotor');
    if (rotor) rotor.style.transform = 'rotate(' + angle + 'deg)';
  }
  function money(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
    if (a >= 1) return sign + '$' + a.toFixed(2);
    if (a >= 0.01) return sign + '$' + a.toFixed(4);
    return sign + '$' + a.toPrecision(3);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(ch) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]);
    });
  }
  function shareText(token, bonus) {
    var symbol = token && token.symbol ? '$' + token.symbol : 'a coin';
    if (!bonus && token && token.sponsored) {
      return 'Cipher Fortune — ' + symbol + '\nToday’s spin is a sponsored placement. Not a prediction.\n' + data.page;
    }
    var head = bonus ? 'Cipher Fortune bonus spin — ' + symbol : 'Cipher Fortune — ' + symbol;
    return head + '\nSpin the wheel, land on a random coin, get today’s decoded breakdown.\nFree. For fun. Not a prediction.\n' + data.page;
  }
  function cardHtml(token, bonus) {
    var change = token.change24h == null || !isFinite(token.change24h) ? 'n/a' : ((token.change24h > 0 ? '+' : '') + token.change24h.toFixed(1) + '%');
    var changeClass = token.change24h == null ? '' : (token.change24h >= 0 ? 'pos' : 'neg');
    var chain = token.chain ? String(token.chain).toUpperCase() : '';
    var addr = token.address || '';
    function copyChip(value) {
      if (!value) return '';
      var safe = esc(value);
      return '<span class="ca ca-open"><span class="ca-text" data-address="' + safe + '" title="' + safe + '">' + safe + '</span><button type="button" class="ca-copy" data-copy-address="' + safe + '" aria-label="Copy contract address">Copy</button></span>';
    }
    var contract = addr ? ((chain ? esc(chain) + ' · ' : '') + copyChip(addr)) : 'Contract not on this snapshot. Open the coin page for the market listing.';
    var grade = token.letter && token.checkHref
      ? '<a class="cf-grade" href="' + esc(token.checkHref) + '">Ape Check ' + esc(token.letter) + '</a>'
      : '<span class="cf-grade muted">No letter on this spin</span>';
    var notes = (token.notes || []).map(function(line){ return '<li>' + esc(line) + '</li>'; }).join('');
    var img = token.image ? '<img src="' + esc(token.image) + '" alt="" width="64" height="64">' : '';
    var kicker = bonus ? 'Bonus spin — not today’s Cipher Fortune' : 'Today’s Cipher Fortune';
    var href = 'https://x.com/intent/post?text=' + encodeURIComponent(shareText(token, bonus));
    var paid = !bonus && token.sponsored;
    var badge = paid ? '<p class="cf-paid-note"><span class="cf-sponsored">SPONSORED</span> Paid placement. Forced Coin of the Day. Not a prediction.</p>' : '';
    var blurb = (!bonus && token.blurb) ? '<p class="cf-line">' + esc(token.blurb) + '</p>' : '';
    return '<div class="cf-result-top"><p class="cf-kicker">' + esc(kicker) + '</p><div class="cf-stamp">DECODED</div></div>'
      + badge
      + '<div class="cf-id">' + img + '<div><h2 id="cf-landed" tabindex="-1">$' + esc(token.symbol || 'COIN') + '</h2><p>' + esc(token.name || '') + '</p></div></div>'
      + blurb
      + '<dl class="cf-stats"><div><dt>Price</dt><dd>' + esc(money(token.price)) + '</dd></div>'
      + '<div><dt>24h</dt><dd class="' + changeClass + '">' + esc(change) + '</dd></div>'
      + '<div><dt>Market cap</dt><dd>' + esc(token.marketCap ? money(token.marketCap) : 'n/a') + '</dd></div>'
      + '<div><dt>Volume</dt><dd>' + esc(token.volume ? money(token.volume) : 'n/a') + '</dd></div></dl>'
      + '<p class="cf-contract">' + contract + '</p>'
      + '<p class="cf-links">' + grade + ' <a href="' + esc(token.href || '/movers') + '">Coin page</a></p>'
      + '<ul class="cf-notes">' + notes + '</ul>'
      + '<p class="cf-line">' + esc(token.line || '') + '</p>'
      + '<p class="cf-remember">This browser remembers today’s coin until the New York date changes. Spin again is for fun and does not replace it.</p>'
      + '<a class="btn x" id="cf-share" href="' + esc(href) + '">Post this fortune on X</a>';
  }
  function rememberDaily() {
    try { localStorage.setItem('cipher-fortune-v1', JSON.stringify({ dayKey: data.dayKey, id: data.winnerId })); } catch (e) {}
    document.cookie = 'cf_fortune=' + encodeURIComponent(data.dayKey + ':' + data.winnerId) + '; Max-Age=172800; Path=/; SameSite=Lax';
  }
  function reveal(index, bonus, quiet) {
    var token = segments[index];
    var box = document.getElementById('cf-result');
    var status = document.getElementById('cf-status');
    if (!token || !box) return;
    box.hidden = false;
    box.innerHTML = cardHtml(token, bonus);
    var stamp = box.querySelector('.cf-stamp');
    if (stamp && !reducedQuery.matches && !quiet) stamp.className = 'cf-stamp pop';
    if (status) status.textContent = bonus ? 'Bonus spin landed. Today’s pick is unchanged.' : 'Landed on today’s Cipher Fortune.';
    var top = document.querySelector('.actions a.btn.x');
    if (top && !bonus) top.setAttribute('href', 'https://x.com/intent/post?text=' + encodeURIComponent(shareText(token, false)));
    if (!bonus) {
      dailyDone = true;
      rememberDaily();
    }
    if (!quiet) {
      var landed = document.getElementById('cf-landed');
      if (landed) landed.focus();
    }
  }
  function spinTo(index, bonus) {
    if (spinning || !segments.length) return;
    spinning = true;
    var button = document.getElementById('cf-spin');
    if (button) button.disabled = true;
    var reduced = reducedQuery.matches;
    var duration = reduced ? REDUCED_MS : FULL_MS;
    var turns = reduced ? 1 : 7;
    var from = rotation;
    var target = landingRotation(from, index, segments.length, turns);
    var t0 = performance.now();
    prevEase = 0;
    lastSeg = segmentAt(from, segments.length);
    if (!reduced) playWhoosh();
    var status = document.getElementById('cf-status');
    if (status) status.textContent = reduced ? 'Landing on a coin…' : 'Spinning…';
    function frame(now) {
      var t = Math.min(1, (now - t0) / duration);
      var eased = wheelEase(t);
      var angle = from + (target - from) * eased;
      setAngle(angle);
      var seg = segmentAt(angle, segments.length);
      var speed = Math.min(1, Math.abs(eased - prevEase) / 0.008);
      prevEase = eased;
      if (!reduced && seg !== lastSeg) {
        var gap = now - lastTick;
        var minGap = speed > 0.55 ? 34 : 20;
        if (gap >= minGap) {
          playTick(speed);
          lastTick = now;
          lastSeg = seg;
        }
      }
      if (t < 1) requestAnimationFrame(frame);
      else {
        setAngle(target);
        spinning = false;
        if (button) {
          button.disabled = false;
          button.textContent = 'Spin again for fun';
        }
        playThud(reduced);
        if (!reduced && navigator.vibrate) navigator.vibrate([16, 36, 28]);
        reveal(index, bonus);
      }
    }
    requestAnimationFrame(frame);
  }
  function randomBonus() {
    var roll = 0;
    if (window.crypto && crypto.getRandomValues) {
      var buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      roll = buf[0];
    } else {
      roll = Math.floor(Math.random() * 4294967295);
    }
    return bonusIndex(roll, segments.length, data.winnerSlot);
  }
  var spin = document.getElementById('cf-spin');
  if (spin) {
    spin.addEventListener('click', function() {
      if (!segments.length || spinning) return;
      var bonus = dailyDone;
      var index = bonus ? randomBonus() : data.winnerSlot;
      spinTo(index, bonus);
    });
  }
  var sound = document.getElementById('cf-sound');
  if (sound) {
    sound.addEventListener('click', function() {
      audio.muted = !audio.muted;
      try { localStorage.setItem('cipher-fortune-sound', audio.muted ? 'off' : 'on'); } catch (e) {}
      paintSound();
      if (!audio.muted) playTick(0.15);
    });
  }
  paintSound();
  setAngle(rotation);
  try {
    var saved = JSON.parse(localStorage.getItem('cipher-fortune-v1') || 'null');
    if (saved && saved.dayKey === data.dayKey && saved.id === data.winnerId) dailyDone = true;
  } catch (e) {}
  if (dailyDone && segments.length) {
    setAngle(landingRotation(0, data.winnerSlot, segments.length, 0));
    if (spin) spin.textContent = 'Spin again for fun';
    var box = document.getElementById('cf-result');
    if (box && box.hidden) reveal(data.winnerSlot, false, true);
  }
})();
`.replace('__CF_JSON__', json) + '\n</script>';
}

function renderFortunePage(model, opts) {
  const data = model && model.dayKey ? model : emptyModel(Date.now());
  const revealed = Boolean(opts && opts.revealed && data.winner);
  const angle = parkAngle(data, revealed);
  const ready = data.segments && data.segments.length;
  const payload = {
    dayKey: data.dayKey,
    winnerId: data.winner ? data.winner.id : '',
    winnerSlot: data.winnerSlot || 0,
    revealed,
    startAngle: angle,
    page: SITE + '/cipher-fortune',
    sponsored: !!data.sponsored,
    segments: (data.segments || []).map((token) => ({
      id: token.id,
      symbol: token.symbol,
      name: token.name,
      price: token.price,
      change24h: token.change24h,
      marketCap: token.marketCap,
      volume: token.volume,
      image: token.image || '',
      letter: token.letter || '',
      chain: token.chain || '',
      address: token.address || '',
      checkHref: token.checkHref || '',
      href: token.href || '',
      line: token.line || '',
      notes: token.notes || [],
      sponsored: !!token.sponsored,
      blurb: token.blurb || '',
    })),
  };
  const result = revealed
    ? '<div id="cf-result" class="cf-result" aria-live="polite">' + resultInner(data.winner, 'daily') + '</div>'
    : '<div id="cf-result" class="cf-result" aria-live="polite" hidden></div>';
  const body = [
    '<p class="cf-disclaimer">Entertainment only. No prizes and no paid spins. Not a prediction and not financial advice.</p>',
    '<p class="cf-promo">Projects can book a placement: banner row, Forced Coin of the Day, or a Fortune lock so the daily spin lands on their coin. Reach out — every paid day is labeled SPONSORED. Not a prediction. <a href="/#advertise">Book Coin of the Day</a></p>',
    data.sponsored ? '<p class="cf-paid-note"><span class="cf-sponsored">SPONSORED</span> Today’s Cipher Fortune is a paid placement. Not a prediction.</p>' : '',
    data.note ? '<p class="hint">' + esc(data.note) + '</p>' : '',
    '<div class="cf-stage">' + pointerSvg() + '<div class="cf-rotor" id="cf-rotor" style="transform:rotate(' + angle.toFixed(3) + 'deg)">' + wheelSvg(ready ? data.segments : []) + '</div><div class="cf-hub-lock">' + hubSvg() + '</div></div>',
    '<div class="cf-controls"><button type="button" class="cf-spin" id="cf-spin"' + (ready ? '' : ' disabled') + '>' + (revealed ? 'Spin again for fun' : 'Spin') + '</button><button type="button" class="cf-sound" id="cf-sound" aria-pressed="true">Sound on</button></div>',
    '<p id="cf-status" class="cf-status" role="status">' + (revealed ? 'Today’s coin is already on the card. Spin again is a bonus.' : 'Press Spin. The wheel speeds up, coasts, then snaps to a coin.') + '</p>',
    result,
    '<p class="cf-how">' + esc(algorithmText(data)) + '</p>',
    buyButtonsHtml({ heading: 'Where to buy', note: 'Referral desks. A spin is not a reason to use them.' }),
    whereToBuyHtml({ heading: 'where to buy', noteHtml: 'Affiliate links. CIPHER may earn a commission if you sign up. A listing is not a comment on the coin the wheel landed on. <a href="/terms">Terms and disclaimer</a>.' }),
    '<section class="card faq" id="how-fortune"><h2>How Cipher Fortune works</h2>' +
      '<details open><summary>What you get</summary><p>You spin a wheel of real coins from the cached market list. It lands on one coin and opens a breakdown: price, 24 hour change, market cap and volume when we have them, chain and contract when we know them, and an Ape Check letter when that contract can be graded. The decoded stamp is the fun part. It is not a forecast.</p></details>' +
      '<details><summary>Same coin for the day</summary><p>The New York date picks one coin for the whole site. Your browser stores it in local storage and a cookie so a refresh shows today’s fortune instead of making you spin forever. Spin again is allowed, and it is labeled a bonus. The bonus does not replace today’s pick.</p></details>' +
      '<details><summary>Sound, motion, and phones</summary><p>The wheel accelerates, coasts, slows, and snaps onto a segment. Clicks track the pointer. A short whoosh plays while it is fast, and a thud plays when it lands. Phones that support it get a short vibration on the landing. Sound on / Sound off is remembered in this browser. If you prefer reduced motion, the spin is short, the clicks and whoosh are skipped, and the thud is quieter. It still lands on the same coin.</p></details>' +
      (data.sponsored
        ? '<details><summary>Not a prediction</summary><p>On a sponsored day the New York coin is a paid placement, labeled SPONSORED. It is not a forecast. Visitors do not pay to spin. Spin again is a separate random bonus. Not financial advice.</p></details>'
        : '<details><summary>Not a prediction</summary><p>Cipher Fortune is a free random picker. There is nothing to win, nothing to pay, and nothing the glyphs know about tomorrow. Not financial advice.</p></details>') +
    '</section>',
    '<noscript><p class="hint">JavaScript runs the spin. Today’s coin is already chosen for this New York date and is the same for every visitor.</p></noscript>',
  ].join('');
  const html = shell({
    title: 'Cipher Fortune — spin the wheel, land on a random coin',
    heading: 'Cipher Fortune',
    description: 'Spin the wheel, land on a random coin, get today’s decoded breakdown. Free. For fun. Not a prediction.',
    path: '/cipher-fortune',
    image: SITE + '/og/cipher-fortune.png',
    active: 'fortune',
    alertsReady: alertsReady(),
    shareText: 'Cipher Fortune\nSpin the wheel, land on a random coin, get today’s decoded breakdown.\nFree. For fun. Not a prediction.\n' + SITE + '/cipher-fortune',
    shareLabel: 'Post this fortune on X',
    shareIntent: 'post',
    lede: 'Spin the wheel, land on a random coin, get today’s decoded breakdown. Free. For fun. Not a prediction.',
    extraHead: fortuneCss(),
    body: body + clientScript(payload),
  });
  return { status: 200, html, cacheControl: 'public, max-age=60, s-maxage=120, stale-while-revalidate=300' };
}

module.exports = {
  SEGMENT_COUNT,
  nyDayKey,
  hashIndex,
  wheelEase,
  segmentAt,
  landingRotation,
  bonusIndex,
  buildPool,
  layoutWheel,
  modelFromCoins,
  loadFortune,
  loadFortuneBounded,
  renderFortunePage,
  cookieReveals,
  resetFortuneMemory,
  fortuneLine,
  secondsUntilNextNyDay,
  emptyModel,
};
