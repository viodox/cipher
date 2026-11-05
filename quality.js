'use strict';

// Shared by the server and the browser. Spotlight surfaces (coin of the day,
// rekt of the day, daily prediction, the ticker, top movers) drop impostors
// that reuse a top-coin name or ticker.

const MAJORS = [
  ['bitcoin', 'btc', 'bitcoin'],
  ['ethereum', 'eth', 'ethereum'],
  ['tether', 'usdt', 'tether'],
  ['ripple', 'xrp', 'xrp'],
  ['binancecoin', 'bnb', 'bnb'],
  ['solana', 'sol', 'solana'],
  ['usd-coin', 'usdc', 'usd coin'],
  ['dogecoin', 'doge', 'dogecoin'],
  ['cardano', 'ada', 'cardano'],
  ['tron', 'trx', 'tron'],
  ['staked-ether', 'steth', 'lido staked ether'],
  ['wrapped-bitcoin', 'wbtc', 'wrapped bitcoin'],
  ['avalanche-2', 'avax', 'avalanche'],
  ['chainlink', 'link', 'chainlink'],
  ['shiba-inu', 'shib', 'shiba inu'],
  ['bitcoin-cash', 'bch', 'bitcoin cash'],
  ['polkadot', 'dot', 'polkadot'],
  ['sui', 'sui', 'sui'],
  ['pepe', 'pepe', 'pepe'],
  ['uniswap', 'uni', 'uniswap'],
  ['litecoin', 'ltc', 'litecoin'],
  ['near', 'near', 'near protocol'],
  ['aptos', 'apt', 'aptos'],
  ['internet-computer', 'icp', 'internet computer'],
  ['ethereum-classic', 'etc', 'ethereum classic'],
  ['kaspa', 'kas', 'kaspa'],
  ['filecoin', 'fil', 'filecoin'],
  ['cosmos', 'atom', 'cosmos hub'],
  ['stellar', 'xlm', 'stellar'],
  ['monero', 'xmr', 'monero'],
  ['hedera-hashgraph', 'hbar', 'hedera'],
  ['mantle', 'mnt', 'mantle'],
  ['cronos', 'cro', 'cronos'],
  ['arbitrum', 'arb', 'arbitrum'],
  ['optimism', 'op', 'optimism'],
  ['bonk', 'bonk', 'bonk'],
  ['dogwifcoin', 'wif', 'dogwifhat'],
  ['floki', 'floki', 'floki'],
  ['the-open-network', 'ton', 'toncoin'],
  ['binance-peg-bitcoin', 'btcb', 'binance bitcoin'],
];

const SPOTLIGHT_MIN_MCAP = 500000;
const SPOTLIGHT_MIN_VOLUME = 50000;

function normalizeSymbol(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function emptyCanon() {
  return { symbols: Object.create(null), names: Object.create(null), ids: Object.create(null) };
}

function addCanon(canon, id, symbol, name) {
  const coinId = String(id || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(coinId)) return;
  canon.ids[coinId] = 1;
  const sym = normalizeSymbol(symbol);
  const label = normalizeName(name);
  if (sym && !canon.symbols[sym]) canon.symbols[sym] = coinId;
  if (label && !canon.names[label]) canon.names[label] = coinId;
}

function staticCanon() {
  const canon = emptyCanon();
  MAJORS.forEach((row) => addCanon(canon, row[0], row[1], row[2]));
  return canon;
}

function canonFromMarkets(rows) {
  const canon = staticCanon();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    addCanon(canon, row && row.id, row && row.symbol, row && row.name);
  });
  return canon;
}

function hexBlobSymbol(symbol) {
  const sym = normalizeSymbol(symbol);
  return sym.length >= 5 && /^[0-9A-F]+$/.test(sym) && /\d/.test(sym);
}

function num(coin, primary, fallback) {
  const value = coin && (coin[primary] != null ? coin[primary] : coin[fallback]);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function realId(coin) {
  const id = String((coin && coin.id) || '').trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ? id : '';
}

function isImpostor(coin, canon) {
  const book = canon || staticCanon();
  const id = realId(coin);
  if (!id) return true;
  const sym = normalizeSymbol(coin && (coin.symbol || coin.sym));
  const name = normalizeName(coin && coin.name);
  if (sym && book.symbols[sym] && book.symbols[sym] !== id) return true;
  if (name && book.names[name] && book.names[name] !== id) return true;
  return false;
}

function isUnlisted(coin) {
  // Raw DEX rows are not CoinGecko listings. Spotlight surfaces (coin of the
  // day, rekt, ticker, movers ranks) ignore them. Keep in sync with isDexRow.
  if (!coin) return false;
  if (coin.listed === false) return true;
  const source = String(coin.source || '').toLowerCase();
  if (source === 'geckoterminal' || source === 'dexscreener' || source === 'dex') return true;
  return /^dex-(eth|bsc|base|arb|sol)-/i.test(String(coin.id || ''));
}

function spotlightOk(coin, canon) {
  // Scanner can show a listed coin at $100 of volume. Spotlight (coin of the
  // day, rekt, ticker, prediction) still requires the floors below, and it
  // never takes an unlisted DEX row.
  if (!coin || isUnlisted(coin) || isImpostor(coin, canon)) return false;
  if (hexBlobSymbol(coin.symbol || coin.sym)) return false;
  const sym = normalizeSymbol(coin.symbol || coin.sym);
  if (sym.length < 2 || sym.length > 12) return false;
  const price = num(coin, 'current_price', 'price');
  const mcap = num(coin, 'market_cap', 'marketCap');
  const volume = num(coin, 'total_volume', 'volume');
  if (price == null || price <= 0) return false;
  if (mcap == null || mcap < SPOTLIGHT_MIN_MCAP) return false;
  if (volume == null || volume < SPOTLIGHT_MIN_VOLUME) return false;
  return true;
}

const api = {
  MAJORS,
  SPOTLIGHT_MIN_MCAP,
  SPOTLIGHT_MIN_VOLUME,
  normalizeSymbol,
  normalizeName,
  staticCanon,
  canonFromMarkets,
  isImpostor,
  isUnlisted,
  hexBlobSymbol,
  spotlightOk,
};

if (typeof module === 'object' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.CipherQuality = api;
