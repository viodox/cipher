'use strict';

const { esc } = require('./http-util');
const { proxyCoinGeckoJson } = require('./coingecko');
const { normalizeChain, canonicalAddress, validAddress } = require('./chains');
const { shell, whereToBuyHtml, alertFormHtml, SITE } = require('./chrome');
const { fmtMoney, fmtPrice, fmtPct, safeImage, plainText, clip, jsonLdScript, tweetHref } = require('./format');

const COIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PLATFORM_ORDER = [
  ['ethereum', 'eth', 'Ethereum'],
  ['binance-smart-chain', 'bsc', 'BSC'],
  ['base', 'base', 'Base'],
  ['solana', 'sol', 'Solana'],
];

function validCoinId(id) {
  const value = String(id || '').trim().toLowerCase();
  if (!COIN_ID.test(value) || value.length > 80) return '';
  return value;
}

function platformAddress(platforms, key) {
  const raw = platforms && platforms[key];
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && raw.contract_address) return String(raw.contract_address).trim();
  return '';
}

function scanLinks(platforms) {
  const links = [];
  PLATFORM_ORDER.forEach(([key, slug, name]) => {
    const chain = normalizeChain(slug);
    const address = canonicalAddress(chain, platformAddress(platforms, key));
    if (!validAddress(chain, address)) return;
    links.push({
      chain: slug,
      chainName: name,
      address,
      href: '/scan/' + slug + '/' + address,
    });
  });
  return links;
}

async function loadCoin(id) {
  const coinId = validCoinId(id);
  if (!coinId) return { ok: false, status: 404, error: 'That coin id is not valid.' };
  const result = await proxyCoinGeckoJson('coins/' + coinId, {
    localization: 'false',
    tickers: 'false',
    market_data: 'true',
    community_data: 'false',
    developer_data: 'false',
    sparkline: 'false',
  });
  if (result.status === 404) return { ok: false, status: 404, error: 'CoinGecko has no coin with that id.' };
  if (!result.ok || !result.json || !result.json.id) {
    return { ok: false, status: result.status || 502, error: 'Coin data is temporarily unavailable.' };
  }
  const coin = result.json;
  const market = coin.market_data || {};
  const price = market.current_price && Number.isFinite(Number(market.current_price.usd)) ? Number(market.current_price.usd) : null;
  const change = Number(market.price_change_percentage_24h);
  const marketCap = market.market_cap && Number(market.market_cap.usd);
  const volume = market.total_volume && Number(market.total_volume.usd);
  return {
    ok: true,
    status: 200,
    coin: {
      id: coin.id,
      symbol: String(coin.symbol || '').toUpperCase().slice(0, 16),
      name: String(coin.name || coin.id),
      image: safeImage(coin.image && (coin.image.large || coin.image.small || coin.image.thumb)),
      description: plainText(coin.description && coin.description.en, 420),
      price,
      change24h: Number.isFinite(change) ? change : null,
      marketCap: Number.isFinite(marketCap) ? marketCap : null,
      volume: Number.isFinite(volume) ? volume : null,
      rank: market.market_cap_rank || null,
      scans: scanLinks(coin.platforms || {}),
    },
  };
}

function renderCoinHtml(loaded) {
  if (!loaded.ok) {
    const html = shell({
      title: 'Coin — CIPHER',
      heading: 'coin',
      description: 'CIPHER coin page.',
      path: '/coin',
      active: 'movers',
      robots: 'noindex',
      body: '<p class="err">// ' + esc(loaded.error || 'not found') + '</p><p class="hint"><a href="/movers">back to top movers</a></p>',
    });
    return { status: loaded.status || 404, html, cacheControl: 'no-store' };
  }
  const coin = loaded.coin;
  const pagePath = '/coin/' + coin.id;
  const changeClass = coin.change24h == null ? '' : (coin.change24h >= 0 ? 'pos' : 'neg');
  const blurb = coin.description || (coin.name + ' market snapshot from CoinGecko. Not financial advice.');
  const description = clip(coin.symbol + ' (' + coin.name + ') is ' + fmtPrice(coin.price) + ', ' + fmtPct(coin.change24h) + ' over 24 hours. Market cap ' + fmtMoney(coin.marketCap) + '. Scan and where to buy on CIPHER. Not financial advice.', 180);
  const title = coin.symbol + ' price — ' + coin.name + ' — CIPHER';
  const shareText = '$' + coin.symbol + ' ' + fmtPct(coin.change24h) + ' in 24h — ' + coin.name + '\n\nvia @ciphersignal_\n' + SITE + pagePath;
  const scans = coin.scans.length
    ? '<div class="actions">' + coin.scans.map((scan) => (
      '<a class="btn warn" href="' + esc(scan.href) + '">scan on ' + esc(scan.chainName) + '</a>'
    )).join('') + '</div>'
    : '<p class="hint">No Ethereum, BSC, Base, or Solana contract on the CoinGecko record, so CipherPot does not have a direct scan link.</p>';
  const img = coin.image ? '<img src="' + esc(coin.image) + '" alt="" width="48" height="48" style="border-radius:50%;border:1px solid #243050">' : '';
  const structured = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    url: SITE + pagePath,
    description,
    isPartOf: { '@type': 'WebSite', name: 'CIPHER', url: SITE + '/' },
    about: { '@type': 'Thing', name: coin.name, alternateName: coin.symbol },
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'CIPHER', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Top Movers', item: SITE + '/movers' },
        { '@type': 'ListItem', position: 3, name: coin.name, item: SITE + pagePath },
      ],
    },
  };
  const body = [
    '<p class="hint"><a href="/movers">top movers</a> / ' + esc(coin.name) + '</p>',
    '<article class="card">',
    '<div class="actions" style="align-items:center">' + img + '<button type="button" class="ghost" data-watch="' + esc(coin.id) + '">☆ watch</button>',
    '<a class="ghost" href="' + esc(tweetHref(shareText)) + '" target="_blank" rel="noopener">share on X</a></div>',
    '<div class="stats">',
    '<div class="stat"><b>price</b><span>' + esc(fmtPrice(coin.price)) + '</span></div>',
    '<div class="stat"><b>24h</b><span class="' + changeClass + '">' + esc(fmtPct(coin.change24h)) + '</span></div>',
    '<div class="stat"><b>market cap</b><span>' + esc(fmtMoney(coin.marketCap)) + '</span></div>',
    '<div class="stat"><b>24h volume</b><span>' + esc(fmtMoney(coin.volume)) + '</span></div>',
    '<div class="stat"><b>rank</b><span>' + esc(coin.rank ? '#' + coin.rank : 'n/a') + '</span></div>',
    '</div>',
    '<p class="lede">' + esc(blurb) + '</p>',
    '<h2 style="font-family:Orbitron,monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#00e5ff;margin:1rem 0 .4rem">contract scan</h2>',
    scans,
    '</article>',
    '<section class="card"><h2>price alert</h2><p class="hint">Store an email for this coin. CIPHER does not send the alert email yet.</p>' + alertFormHtml({ coinId: coin.id, coins: [{ id: coin.id, symbol: coin.symbol }] }) + '</section>',
    whereToBuyHtml(),
  ].join('');
  const html = shell({
    title,
    heading: coin.symbol + ' · ' + coin.name,
    description,
    path: pagePath,
    image: SITE + '/og/coin/' + coin.id + '.png',
    active: 'movers',
    shareText,
    lede: 'Market snapshot for ' + esc(coin.name) + '. The watch star is saved in this browser, same list as the scanner.',
    extraHead: jsonLdScript(structured),
    body,
  });
  return { status: 200, html, cacheControl: 'public, max-age=60, s-maxage=120' };
}

async function renderCoinPage(id) {
  return renderCoinHtml(await loadCoin(id));
}

module.exports = { validCoinId, loadCoin, renderCoinPage, scanLinks };
