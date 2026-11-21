'use strict';

// No-key sources used only after the demo key is refused and the public
// CoinGecko endpoint misses too. Results are mapped into the CoinGecko shapes
// the rest of the site already reads. Callers cache the JSON.

const PLATFORM = {
  ethereum: 'ethereum',
  eth: 'ethereum',
  bsc: 'binance-smart-chain',
  base: 'base',
  arbitrum: 'arbitrum-one',
  solana: 'solana',
  sol: 'solana',
};

const GT_NETWORK = {
  ethereum: 'eth',
  'binance-smart-chain': 'bsc',
  base: 'base',
  'arbitrum-one': 'arbitrum',
  solana: 'solana',
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 6000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'CipherSignal/1.0 (+https://www.ciphersignal.xyz)',
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.length > 700000) return null;
    return JSON.parse(text);
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function bestPair(pairs, hint) {
  const list = Array.isArray(pairs) ? pairs : [];
  const wanted = String(hint || '').toLowerCase();
  let best = null;
  let bestLiq = -1;
  list.forEach((pair) => {
    const base = pair && pair.baseToken;
    if (!base) return;
    const symbol = String(base.symbol || '').toLowerCase();
    const name = String(base.name || '').toLowerCase();
    if (wanted && symbol !== wanted && name !== wanted && !name.includes(wanted) && !symbol.includes(wanted)) return;
    const liq = num(pair.liquidity && pair.liquidity.usd) || 0;
    if (liq >= bestLiq) {
      best = pair;
      bestLiq = liq;
    }
  });
  return best || list[0] || null;
}

function coinFromPair(id, pair) {
  if (!pair) return null;
  const base = pair.baseToken || {};
  const platform = PLATFORM[String(pair.chainId || '').toLowerCase()];
  const platforms = {};
  if (platform && base.address) platforms[platform] = base.address;
  const price = num(pair.priceUsd);
  const change = num(pair.priceChange && pair.priceChange.h24);
  const cap = num(pair.marketCap != null ? pair.marketCap : pair.fdv);
  const volume = num(pair.volume && pair.volume.h24);
  const image = pair.info && pair.info.imageUrl ? String(pair.info.imageUrl) : '';
  return {
    id: id || String(base.symbol || 'token').toLowerCase(),
    symbol: base.symbol || id || 'token',
    name: base.name || base.symbol || id || 'Token',
    image: image ? { thumb: image, small: image, large: image } : {},
    description: { en: '' },
    market_data: {
      current_price: { usd: price },
      price_change_percentage_24h: change,
      market_cap: { usd: cap },
      total_volume: { usd: volume },
      market_cap_rank: null,
    },
    platforms,
  };
}

function marketFromPair(pair, index) {
  const coin = coinFromPair('', pair);
  if (!coin) return null;
  const slug = String(coin.symbol || 'token').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('token-' + index);
  return {
    id: slug,
    symbol: coin.symbol,
    name: coin.name,
    image: coin.image && coin.image.large || '',
    current_price: coin.market_data.current_price.usd,
    market_cap: coin.market_data.market_cap.usd,
    total_volume: coin.market_data.total_volume.usd,
    price_change_percentage_24h: coin.market_data.price_change_percentage_24h,
    price_change_percentage_7d_in_currency: null,
    market_cap_rank: index + 1,
  };
}

function marketFromPaprika(row) {
  const quote = row && row.quotes && row.quotes.USD;
  if (!row || !row.id || !quote) return null;
  return {
    id: String(row.id),
    symbol: row.symbol || '',
    name: row.name || row.id,
    image: '',
    current_price: num(quote.price),
    market_cap: num(quote.market_cap),
    total_volume: num(quote.volume_24h),
    price_change_percentage_24h: num(quote.percent_change_24h),
    price_change_percentage_7d_in_currency: num(quote.percent_change_7d),
    market_cap_rank: row.rank || null,
  };
}

async function dexSearch(query) {
  const json = await fetchJson('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(query), 6000);
  return json && Array.isArray(json.pairs) ? json.pairs : [];
}

async function coinById(id) {
  const pairs = await dexSearch(id);
  const pair = bestPair(pairs, id);
  const coin = coinFromPair(id, pair);
  if (coin && num(coin.market_data.current_price.usd) != null) return coin;
  if (id.indexOf('-') !== -1) {
    const ticker = await fetchJson('https://api.coinpaprika.com/v1/tickers/' + encodeURIComponent(id) + '?quotes=USD', 6000);
    const row = marketFromPaprika(ticker);
    if (!row) return coin;
    return {
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      image: {},
      description: { en: '' },
      market_data: {
        current_price: { usd: row.current_price },
        price_change_percentage_24h: row.price_change_percentage_24h,
        market_cap: { usd: row.market_cap },
        total_volume: { usd: row.total_volume },
        market_cap_rank: row.market_cap_rank,
      },
      platforms: {},
    };
  }
  return coin;
}

async function coinByContract(platform, address) {
  const json = await fetchJson('https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(address), 6000);
  const pairs = json && Array.isArray(json.pairs) ? json.pairs : [];
  const pair = bestPair(pairs, '');
  const coin = coinFromPair(pair && pair.baseToken && String(pair.baseToken.symbol || '').toLowerCase(), pair);
  if (!coin) {
    const network = GT_NETWORK[platform];
    if (!network) return null;
    const token = await fetchJson('https://api.geckoterminal.com/api/v2/networks/' + network + '/tokens/' + encodeURIComponent(address), 6000);
    const attrs = token && token.data && token.data.attributes;
    if (!attrs) return null;
    return {
      id: String(attrs.symbol || address).toLowerCase(),
      symbol: attrs.symbol || 'TOKEN',
      name: attrs.name || attrs.symbol || 'Token',
      image: {},
      description: { en: '' },
      market_data: {
        current_price: { usd: num(attrs.price_usd) },
        price_change_percentage_24h: num(attrs.price_change_percentage && attrs.price_change_percentage.h24),
        market_cap: { usd: num(attrs.market_cap_usd || attrs.fdv_usd) },
        total_volume: { usd: num(attrs.volume_usd && attrs.volume_usd.h24) },
        market_cap_rank: null,
      },
      platforms: { [platform]: address },
    };
  }
  if (platform && address) coin.platforms[platform] = address;
  return coin;
}

async function marketsFromPaprika() {
  const rows = await fetchJson('https://api.coinpaprika.com/v1/tickers?quotes=USD', 7000);
  if (!Array.isArray(rows)) return null;
  const mapped = rows.slice(0, 100).map(marketFromPaprika).filter(Boolean);
  return mapped.length ? mapped : null;
}

async function marketsFromDex() {
  const pairs = await dexSearch('meme');
  const mapped = [];
  const seen = new Set();
  pairs.forEach((pair) => {
    const row = marketFromPair(pair, mapped.length);
    if (!row || seen.has(row.id) || !(num(row.total_volume) > 0)) return;
    seen.add(row.id);
    mapped.push(row);
  });
  return mapped.length ? mapped : null;
}

async function trendingFromGt() {
  const json = await fetchJson('https://api.geckoterminal.com/api/v2/networks/trending_pools?page=1', 6000);
  const rows = json && Array.isArray(json.data) ? json.data : [];
  const coins = [];
  rows.slice(0, 15).forEach((row) => {
    const name = row && row.attributes && row.attributes.name;
    const symbol = String(name || '').split('/')[0].trim();
    if (!symbol) return;
    const id = symbol.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!id) return;
    coins.push({ item: { id: id, name: symbol, symbol: symbol, market_cap_rank: null } });
  });
  return coins.length ? { coins: coins } : null;
}

async function searchFromDex(query) {
  const pairs = await dexSearch(query);
  const coins = [];
  const seen = new Set();
  pairs.forEach((pair) => {
    const base = pair && pair.baseToken;
    if (!base || !base.symbol) return;
    const id = String(base.symbol).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!id || seen.has(id)) return;
    seen.add(id);
    coins.push({ id: id, name: base.name || base.symbol, symbol: base.symbol, market_cap_rank: null });
  });
  return coins.length ? { coins: coins } : null;
}

async function secondaryFallback(path, params) {
  const query = params || {};
  const contract = String(path || '').match(/^coins\/([^/]+)\/contract\/([^/]+)$/);
  if (contract) return coinByContract(contract[1], contract[2]);
  const chart = String(path || '').match(/^coins\/([^/]+)\/market_chart$/);
  if (chart) return null;
  const coin = String(path || '').match(/^coins\/([^/]+)$/);
  if (coin) return coinById(coin[1]);
  if (path === 'coins/markets') {
    const paprika = await marketsFromPaprika();
    if (paprika) return paprika;
    return marketsFromDex();
  }
  if (path === 'search/trending') return trendingFromGt();
  if (path === 'search') return searchFromDex(query.query || query.q || '');
  if (path === 'simple/price') {
    const ids = String(query.ids || '').split(',').map((id) => id.trim()).filter(Boolean).slice(0, 8);
    const out = {};
    for (const id of ids) {
      const found = await coinById(id);
      const price = found && found.market_data && found.market_data.current_price && num(found.market_data.current_price.usd);
      if (price != null) out[id] = { usd: price };
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

module.exports = { secondaryFallback, coinFromPair, marketFromPaprika };
