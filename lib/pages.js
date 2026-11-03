'use strict';

const fs = require('fs');
const path = require('path');
const { esc } = require('./http-util');
const { whereToBuyHtml, buyButtonsHtml, buySoftNoteHtml, referralClickScript } = require('./chrome');
const { ANALYTICS_SNIPPET } = require('./web-analytics');

const SITE = 'https://www.ciphersignal.xyz';
const INDEX_PATH = path.join(__dirname, '..', 'index.html');

const APP_ROUTES = {
  'ai-decrypt': {
    path: '/ai-decrypt',
    tab: 'report',
    title: 'Signal Score — CIPHER',
    description: 'Signal Score is a formula over CoinGecko price, volume, and market cap. It is not an AI model. Free meme-coin read from CIPHER.',
  },
  profile: {
    path: '/profile',
    tab: 'quiz',
    title: 'Degen Profile — CIPHER',
    description: 'A short meme-coin personality quiz on CIPHER. For fun only — not a trading signal and not financial advice.',
  },
  cipherpot: {
    path: '/cipherpot',
    tab: 'cipherpot',
    title: 'CipherPot — Honeypot and Rug Detector',
    description: 'Paste a contract on Ethereum, BSC, Base, or Solana. CipherPot checks honeypot.is, RugCheck, and GoPlus.',
  },
  'on-chain-stocks': {
    path: '/on-chain-stocks',
    tab: 'rwa',
    title: 'On-Chain Stocks — CIPHER',
    description: 'Live CoinGecko prices for Robinhood Chain tokenized stocks. Those stock tokens are not available to US persons. Not investment advice.',
  },
  'rug-radar': {
    path: '/rug-radar',
    tab: 'radar',
    title: 'Rug Radar — CIPHER',
    description: 'Tokens drawing DexScreener attention, checked with the free GoPlus security API. Open any row for a full CipherPot scan.',
  },
};

let cachedHtml = null;
let cachedMtime = 0;

function readIndex() {
  const stat = fs.statSync(INDEX_PATH);
  if (!cachedHtml || stat.mtimeMs !== cachedMtime) {
    cachedHtml = fs.readFileSync(INDEX_PATH, 'utf8');
    cachedMtime = stat.mtimeMs;
  }
  return cachedHtml;
}

function metaBlock(route) {
  const url = SITE + route.path;
  const image = SITE + '/og-image.png';
  const title = esc(route.title);
  const description = esc(route.description);
  return `<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@ciphersignal_">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${image}">`;
}

function renderAppRoute(name) {
  const route = APP_ROUTES[name];
  if (!route) return null;
  let html = readIndex();
  html = html.replace(/<!-- route-meta:start -->[\s\S]*?<!-- route-meta:end -->/, '<!-- route-meta:start -->\n' + metaBlock(route) + '\n<!-- route-meta:end -->');
  html = html.replace('class="tab active"', 'class="tab"');
  html = html.replace(`class="tab" data-tab="${route.tab}"`, `class="tab active" data-tab="${route.tab}"`);
  html = html.replace('id="tab-scanner" class="tab-panel active"', 'id="tab-scanner" class="tab-panel"');
  html = html.replace(`id="tab-${route.tab}" class="tab-panel"`, `id="tab-${route.tab}" class="tab-panel active"`);
  return html;
}

const STAMP_COLOR = {
  HONEYPOT: '#ff3355',
  RUGGED: '#ff3355',
  CAUTION: '#ffb400',
  CLEAN: '#00ff99',
};

function fmtTax(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return (Math.round(n * 10) / 10) + '%';
}

function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function normalizeCipherpotChain(input) {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'eth' || value === 'ethereum' || value === '1') return '1';
  if (value === 'bsc' || value === '56' || value === 'binance-smart-chain') return '56';
  if (value === 'base' || value === '8453') return '8453';
  if (value === 'sol' || value === 'solana') return 'sol';
  return '';
}

function cipherpotHref(chain, address, symbol) {
  const params = new URLSearchParams();
  params.set('chain', normalizeCipherpotChain(chain) || String(chain || '').trim());
  params.set('address', String(address || '').trim());
  const ticker = String(symbol || '').trim();
  if (ticker) params.set('symbol', ticker);
  return '/cipherpot?' + params.toString();
}

function shareText(report) {
  const taxBits = 'Buy ' + fmtTax(report.buyTax) + ' · Sell ' + fmtTax(report.sellTax);
  const url = SITE + '/scan/' + report.chain + '/' + report.address;
  return report.stamp + ' — $' + (report.symbol || 'TOKEN') + ' on ' + report.chainName + '\n' + taxBits + '\n\nvia @ciphersignal_\n' + url;
}

function renderScanPage(report) {
  const stamp = report.stamp || 'CAUTION';
  const color = STAMP_COLOR[stamp] || STAMP_COLOR.CAUTION;
  const path = '/scan/' + report.chain + '/' + report.address;
  const pageUrl = SITE + path;
  const image = SITE + '/og/scan/' + report.chain + '/' + report.address + '.png';
  const title = stamp + ' — $' + (report.symbol || 'token') + ' on ' + (report.chainName || 'chain') + ' — CIPHER';
  const description = [
    report.name || 'Token',
    'buy tax ' + fmtTax(report.buyTax),
    'sell tax ' + fmtTax(report.sellTax),
    'liquidity ' + fmtMoney(report.liquidityUsd),
    'risk ' + (report.riskScore == null ? 'n/a' : report.riskScore + '/100'),
  ].join(' · ');
  const tweet = 'https://x.com/intent/tweet?text=' + encodeURIComponent(shareText(report));
  const warned = stamp === 'HONEYPOT' || stamp === 'RUGGED';
  const cta = warned
    ? buySoftNoteHtml('This stamp is a warning. There is no buy button on a honeypot or rugged result.')
    : buyButtonsHtml({ heading: stamp === 'CLEAN' ? 'Looks clear? Buy on…' : 'Scan finished. Buy on…' });
  const reasons = (report.reasons || []).map((r) => '<li>' + esc(r) + '</li>').join('') || '<li>No extra flags on this pass.</li>';
  const sources = (report.sources || []).map(esc).join(' · ') || 'none';
  const checks = report.checks || {};
  const pills = [
    ['mintable', checks.mintable],
    ['proxy', checks.proxy],
    ['blacklist fn', checks.blacklist],
    ['owner changes balances', checks.ownerChangeBalance],
    ['freeze authority', checks.freezable],
    ['honeypot flag', checks.honeypot],
  ].map(([label, on]) => {
    const col = on ? '#ffb400' : '#00ff99';
    return '<span style="font-size:15px;border:1px solid ' + col + ';color:' + col + ';padding:4px 8px;border-radius:3px">' + esc(label) + ': ' + (on ? 'yes' : 'no') + '</span>';
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${pageUrl}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@ciphersignal_">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${image}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&amp;family=Orbitron:wght@500;700;900&amp;display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;background:#060810;color:#e4eef8;font-family:'Share Tech Mono',monospace;font-size:16.5px;line-height:1.6}
a{color:#00e5ff}
.app{max-width:880px;margin:0 auto;padding:1.5rem 1rem 3rem}
.top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:1.25rem}
.logo{font-family:Orbitron,monospace;font-weight:900;letter-spacing:.14em;color:#00e5ff;text-decoration:none;font-size:20px}
.card{background:#0b0e1a;border:1px solid #243050;border-radius:8px;padding:1.25rem 1.35rem;position:relative;overflow:hidden}
.stamp{font-family:Orbitron,monospace;font-size:34px;font-weight:900;letter-spacing:.08em;color:${color}}
.sub{margin-top:6px;color:#e8eef8}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:1rem 0}
.box{background:#060810;border:1px solid #1a2035;border-radius:6px;padding:10px 12px}
.lbl{font-size:13px;color:#a8b8d4;letter-spacing:.12em;text-transform:uppercase}
.val{font-family:Orbitron,monospace;font-size:18px;margin-top:4px;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
ul{margin:8px 0 0 1.1rem;line-height:1.6}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:1rem}
.btn{font-family:Orbitron,monospace;font-size:13px;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;border:1px solid rgba(0,229,255,.35);color:#00e5ff;padding:8px 14px;border-radius:4px}
.note{margin-top:1rem;font-size:15px;color:#a8b8d4;line-height:1.6}
</style>
${ANALYTICS_SNIPPET}
</head>
<body>
<div class="app">
  <div class="top">
    <a class="logo" href="/">CIPHER</a>
    <a href="https://x.com/ciphersignal_" target="_blank" rel="noopener">@ciphersignal_</a>
  </div>
  <article class="card" id="scan-verdict">
    <div class="stamp">${esc(stamp)}</div>
    <div class="sub">${esc(report.symbol || '')} · ${esc(report.name || '')} · ${esc(report.chainName || '')}</div>
    ${cta}
    <div class="grid">
      <div class="box"><div class="lbl">buy tax</div><div class="val">${esc(fmtTax(report.buyTax))}</div></div>
      <div class="box"><div class="lbl">sell tax</div><div class="val">${esc(fmtTax(report.sellTax))}</div></div>
      <div class="box"><div class="lbl">liquidity</div><div class="val">${esc(fmtMoney(report.liquidityUsd))}</div></div>
      <div class="box"><div class="lbl">risk</div><div class="val" style="color:${color}">${report.riskScore == null ? 'n/a' : esc(String(report.riskScore))}</div></div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${pills}</div>
    <div class="lbl" style="margin-top:1rem">flags</div>
    <ul>${reasons}</ul>
    <div class="actions">
      <a class="btn" id="share-x" href="${esc(tweet)}" target="_blank" rel="noopener">share on X</a>
      <a class="btn" id="open-cipherpot" href="${esc(cipherpotHref(report.chain, report.address, report.symbol))}">open cipherpot</a>
      ${checks.dexUrl ? '<a class="btn" href="' + esc(checks.dexUrl) + '" target="_blank" rel="noopener">dexscreener</a>' : ''}
    </div>
    <p class="note">Scanned ${esc(report.updatedAt || '')} UTC. Sources: ${sources}. Scores and stamps are automated checks, not an audit and not financial advice. Permalink: ${esc(pageUrl)}</p>
  </article>
  ${warned ? '' : whereToBuyHtml()}
</div>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-CQVB0E2CMB"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-CQVB0E2CMB');</script>
${referralClickScript()}
</body>
</html>`;
}

function renderScanError(message) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Scan — CIPHER</title>
<link rel="icon" href="/favicon.ico"><meta name="robots" content="noindex">${ANALYTICS_SNIPPET}</head>
<body style="background:#060810;color:#e4eef8;font-family:monospace;padding:2rem">
<p>// ${esc(message)}</p><p><a href="/cipherpot" style="color:#00e5ff">back to cipherpot</a></p>
</body></html>`;
}

module.exports = {
  APP_ROUTES,
  renderAppRoute,
  renderScanPage,
  renderScanError,
  SITE,
  normalizeCipherpotChain,
  cipherpotHref,
};
