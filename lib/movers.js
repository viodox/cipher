'use strict';

const { esc } = require('./http-util');
const { proxyCoinGeckoJson } = require('./coingecko');
const { shell, whereToBuyHtml, buyButtonsHtml, alertFormHtml, SITE } = require('./chrome');
const { fmtMoney, fmtPrice, fmtPct, fmtRatio, safeImage, jsonLdScript, tweetHref } = require('./format');
const { spotlightOk, isImpostor, hexBlobSymbol } = require('../quality');
const { loadCanon } = require('./canon');
const { alertsReady } = require('./alerts-ready');

const TTL_MS = 120 * 1000;
const FAIL_TTL_MS = 20 * 1000;
let cache = { exp: 0, value: null };

const SPIKE_NOTE = 'A volume spike means today\'s trading is large compared with the coin\'s size. It is not a change versus yesterday.';

function rowFromMarket(coin) {
  const change = Number(coin.price_change_percentage_24h);
  const volume = Number(coin.total_volume);
  const marketCap = Number(coin.market_cap);
  return {
    id: String(coin.id || ''),
    symbol: String(coin.symbol || '').toUpperCase().slice(0, 16),
    name: String(coin.name || '').slice(0, 80),
    image: safeImage(coin.image),
    price: Number.isFinite(Number(coin.current_price)) ? Number(coin.current_price) : null,
    change24h: Number.isFinite(change) ? change : null,
    volume: Number.isFinite(volume) ? volume : 0,
    marketCap: Number.isFinite(marketCap) ? marketCap : 0,
    volumeToCap: Number.isFinite(volume) && Number.isFinite(marketCap) && marketCap > 0 ? volume / marketCap : null,
    rank: coin.market_cap_rank || null,
  };
}

function takeSpikes(rows) {
  const base = rows.filter((row) => row.volume >= 25000 && row.marketCap >= 50000 && row.volumeToCap != null);
  const floors = [0.5, 0.25, 0.1];
  for (const floor of floors) {
    const hit = base.filter((row) => row.volumeToCap >= floor).sort((a, b) => b.volumeToCap - a.volumeToCap).slice(0, 12);
    if (hit.length >= 8 || floor === floors[floors.length - 1]) return hit;
  }
  return [];
}

async function fetchMarkets() {
  const meme = await proxyCoinGeckoJson('coins/markets', {
    vs_currency: 'usd',
    category: 'meme-token',
    order: 'volume_desc',
    per_page: '250',
    page: '1',
    price_change_percentage: '24h',
  });
  if (meme.ok && Array.isArray(meme.json) && meme.json.length) {
    return { source: 'meme-token', coins: meme.json };
  }
  const broad = await proxyCoinGeckoJson('coins/markets', {
    vs_currency: 'usd',
    order: 'volume_desc',
    per_page: '250',
    page: '1',
    price_change_percentage: '24h',
  });
  if (broad.ok && Array.isArray(broad.json)) {
    return { source: 'top-volume', coins: broad.json };
  }
  return { source: null, coins: null, status: meme.status || broad.status || 502, error: 'CoinGecko markets are unavailable' };
}

async function loadMovers() {
  const now = Date.now();
  if (cache.value && cache.exp > now) return cache.value;
  const fetched = await fetchMarkets();
  if (!fetched.coins) {
    const value = { ok: false, status: fetched.status || 502, error: fetched.error || 'markets unavailable' };
    cache = { exp: now + FAIL_TTL_MS, value };
    return value;
  }
  const canon = await loadCanon();
  const rows = [];
  const seen = new Set();
  fetched.coins.forEach((coin) => {
    const row = rowFromMarket(coin);
    if (!row.id || seen.has(row.id) || !/^[a-z0-9-]{1,80}$/.test(row.id)) return;
    if (isImpostor(row, canon) || hexBlobSymbol(row.symbol)) return;
    seen.add(row.id);
    rows.push(row);
  });
  const spotlight = rows.filter((row) => spotlightOk(row, canon));
  const traded = spotlight.filter((row) => row.change24h != null);
  const gainers = traded.filter((row) => row.change24h > 0).sort((a, b) => b.change24h - a.change24h).slice(0, 12);
  const losers = traded.filter((row) => row.change24h < 0).sort((a, b) => a.change24h - b.change24h).slice(0, 12);
  const value = {
    ok: true,
    status: 200,
    source: fetched.source,
    updatedAt: new Date().toISOString(),
    note: SPIKE_NOTE,
    universe: spotlight.length,
    gainers,
    losers,
    volumeSpikes: takeSpikes(spotlight),
    coins: rows,
  };
  cache = { exp: now + TTL_MS, value };
  return value;
}

function coinTweet(row) {
  return '$' + row.symbol + ' ' + fmtPct(row.change24h) + ' in 24h\n\nvia @ciphersignal_\n' + SITE + '/coin/' + row.id;
}

function tableHtml(rows, mode) {
  if (!rows.length) return '<p class="hint">Nothing cleared the filter in this snapshot.</p>';
  const head = mode === 'spike'
    ? '<th>vs cap</th>'
    : '';
  const body = rows.map((row, index) => {
    const changeClass = row.change24h == null ? '' : (row.change24h >= 0 ? 'pos' : 'neg');
    const img = row.image ? '<img src="' + esc(row.image) + '" alt="">' : '';
    const spikeCell = mode === 'spike' ? '<td class="num">' + esc(fmtRatio(row.volumeToCap)) + '</td>' : '';
    return '<tr>' +
      '<td class="num">' + (index + 1) + '</td>' +
      '<td><a class="coin" href="/coin/' + esc(row.id) + '">' + img + '<span><span class="sym">' + esc(row.symbol) + '</span><span class="sub">' + esc(row.name) + '</span></span></a></td>' +
      '<td class="num">' + esc(fmtPrice(row.price)) + '</td>' +
      '<td class="num ' + changeClass + '">' + esc(fmtPct(row.change24h)) + '</td>' +
      '<td class="num">' + esc(fmtMoney(row.volume)) + '</td>' +
      '<td class="num">' + esc(fmtMoney(row.marketCap)) + '</td>' +
      spikeCell +
      '<td><div class="row-links">' +
        '<a class="ghost" href="' + esc(tweetHref(coinTweet(row))) + '" target="_blank" rel="noopener">share</a>' +
        '<button type="button" class="ghost" data-watch="' + esc(row.id) + '">☆ watch</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
  return '<div class="table-wrap"><table><thead><tr><th>#</th><th>coin</th><th>price</th><th>24h</th><th>volume</th><th>mkt cap</th>' + head + '<th></th></tr></thead><tbody>' + body + '</tbody></table></div>';
}

function renderMoversPageFrom(data) {
  if (!data.ok) {
    const html = shell({
      title: 'Top Movers — CIPHER',
      heading: 'top movers',
      description: '24h meme coin gainers, losers, and volume spikes from CoinGecko.',
      path: '/movers',
      image: SITE + '/og/movers.png',
      active: 'movers',
      alertsReady: alertsReady(),
      robots: 'noindex',
      body: '<p class="err">// market data is temporarily unavailable. Reload in a minute.</p>' + buyButtonsHtml({ heading: 'Buy on an exchange', sticky: true }) + whereToBuyHtml(),
    });
    return { status: data.status || 502, html, cacheControl: 'no-store' };
  }
  const sourceLabel = data.source === 'meme-token' ? 'CoinGecko meme-token markets' : 'CoinGecko markets by 24h volume';
  const when = data.updatedAt.replace('T', ' ').slice(0, 19) + ' UTC';
  const shareText = 'CIPHER top movers — 24h gainers, losers, and volume spikes\n\nvia @ciphersignal_\n' + SITE + '/movers';
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'CIPHER Top Movers',
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    numberOfItems: data.gainers.length,
    itemListElement: data.gainers.map((row, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: row.name + ' (' + row.symbol + ')',
      url: SITE + '/coin/' + row.id,
    })),
  };
  const suggestions = []
    .concat(data.gainers, data.losers, data.volumeSpikes)
    .filter((row, index, all) => all.findIndex((other) => other.id === row.id) === index)
    .slice(0, 40)
    .map((row) => ({ id: row.id, symbol: row.symbol }));
  const body = [
    '<p class="hint">Snapshot ' + esc(when) + ' · ' + esc(sourceLabel) + ' · ' + esc(String(data.universe)) + ' markets. Names link to the coin page.</p>',
    buyButtonsHtml({ heading: 'Buy on an exchange', sticky: true }),
    '<section class="card"><h2>24h gainers</h2><p class="hint">Largest gains among coins with some real size and trading. Lookalike tickers that copy a major coin are left off.</p>' + tableHtml(data.gainers, 'move') + '</section>',
    '<section class="card"><h2>24h losers</h2><p class="hint">Largest drops in the same filtered set.</p>' + tableHtml(data.losers, 'move') + '</section>',
    '<section class="card"><h2>volume spikes</h2><p class="hint">' + esc(data.note) + '</p>' + tableHtml(data.volumeSpikes, 'spike') + '</section>',
    (alertsReady()
      ? '<section class="card"><h2>price alert</h2><p class="hint">Save an email and a USD threshold. A confirmation email is sent immediately.</p>' + alertFormHtml({ coins: suggestions }) + '</section>'
      : '<section class="card"><h2>price alert</h2><p class="hint">Coming soon. <a href="/alerts">Price alerts</a> will email you when a coin crosses a price you pick.</p></section>'),
    whereToBuyHtml(),
  ].join('');
  const html = shell({
    title: 'Top Movers — 24h meme coin gainers and losers — CIPHER',
    heading: 'top movers',
    description: 'Daily 24h gainers, losers, and volume spikes for meme coins. Each coin links to its CIPHER page. Affiliate where-to-buy links sit on the same page.',
    path: '/movers',
    image: SITE + '/og/movers.png',
    active: 'movers',
    alertsReady: alertsReady(),
    shareText,
    lede: 'Today\'s board from live CoinGecko data. Open a coin for the contract scan when one exists, or use the referral venues below.',
    extraHead: jsonLdScript(itemList),
    body,
  });
  return { status: 200, html, cacheControl: 'public, max-age=60, s-maxage=120' };
}

async function renderMoversPage() {
  return renderMoversPageFrom(await loadMovers());
}

function coinSitemapXml(data) {
  if (!data || !data.ok) return null;
  const day = String(data.updatedAt || '').slice(0, 10);
  const ids = [];
  const seen = new Set();
  (data.coins || []).forEach((row) => {
    if (!row.id || seen.has(row.id)) return;
    seen.add(row.id);
    ids.push(row.id);
  });
  const urls = ids.map((id) => '  <url><loc>' + esc(SITE + '/coin/' + id) + '</loc>' + (day ? '<lastmod>' + esc(day) + '</lastmod>' : '') + '</url>').join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n';
}

module.exports = { loadMovers, renderMoversPage, renderMoversPageFrom, coinSitemapXml, coinTweet, SPIKE_NOTE };
