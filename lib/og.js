'use strict';

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const FONT_DIR = path.join(__dirname, '..', 'fonts');
const FONT_FILES = [
  path.join(FONT_DIR, 'Orbitron.ttf'),
  path.join(FONT_DIR, 'ShareTechMono-Regular.ttf'),
];

const STAMP_COLOR = {
  HONEYPOT: '#ff3355',
  RUGGED: '#ff3355',
  CAUTION: '#ffb400',
  CLEAN: '#00ff99',
  UNKNOWN: '#a8b8d4',
};

function xml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch])).replace(/[^\x09\x0A\x0D\x20-\uFFFF]/g, '');
}

function money(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function tax(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return (Math.round(n * 10) / 10) + '%';
}

function cardSvg(report) {
  const stamp = report.stamp || 'CAUTION';
  const color = STAMP_COLOR[stamp] || STAMP_COLOR.CAUTION;
  const symbol = xml((report.symbol || 'TOKEN').toString().slice(0, 16));
  const name = xml((report.name || '').toString().slice(0, 42));
  const chain = xml(report.chainName || '');
  const score = report.riskScore == null ? 'n/a' : String(report.riskScore);
  const reason = xml((report.reasons && report.reasons[0]) || 'Open the scan for the full flag list');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#060810"/>
  <rect x="28" y="28" width="1144" height="574" rx="16" fill="#0b0e1a" stroke="#243050"/>
  <rect x="28" y="28" width="1144" height="8" fill="${color}"/>
  <text x="64" y="108" fill="#00e5ff" font-family="Orbitron" font-size="22" font-weight="700">CIPHER // TOKEN SCAN</text>
  <text x="64" y="250" fill="${color}" font-family="Orbitron" font-size="92" font-weight="700">${xml(stamp)}</text>
  <text x="64" y="318" fill="#e8eef8" font-family="Share Tech Mono" font-size="34">${symbol}  ·  ${chain}</text>
  <text x="64" y="362" fill="#a8b8d4" font-family="Share Tech Mono" font-size="22">${name}</text>
  <rect x="64" y="400" width="250" height="108" rx="8" fill="#060810" stroke="#243050"/>
  <rect x="334" y="400" width="250" height="108" rx="8" fill="#060810" stroke="#243050"/>
  <rect x="604" y="400" width="250" height="108" rx="8" fill="#060810" stroke="#243050"/>
  <rect x="874" y="400" width="250" height="108" rx="8" fill="#060810" stroke="#243050"/>
  <text x="84" y="438" fill="#a8b8d4" font-family="Share Tech Mono" font-size="16">BUY TAX</text>
  <text x="84" y="482" fill="#e8eef8" font-family="Orbitron" font-size="32" font-weight="700">${xml(tax(report.buyTax))}</text>
  <text x="354" y="438" fill="#a8b8d4" font-family="Share Tech Mono" font-size="16">SELL TAX</text>
  <text x="354" y="482" fill="#e8eef8" font-family="Orbitron" font-size="32" font-weight="700">${xml(tax(report.sellTax))}</text>
  <text x="624" y="438" fill="#a8b8d4" font-family="Share Tech Mono" font-size="16">LIQUIDITY</text>
  <text x="624" y="482" fill="#e8eef8" font-family="Orbitron" font-size="32" font-weight="700">${xml(money(report.liquidityUsd))}</text>
  <text x="894" y="438" fill="#a8b8d4" font-family="Share Tech Mono" font-size="16">RISK</text>
  <text x="894" y="482" fill="${color}" font-family="Orbitron" font-size="32" font-weight="700">${xml(score)}</text>
  <text x="64" y="552" fill="#c9d4e6" font-family="Share Tech Mono" font-size="18">${reason}</text>
  <text x="64" y="584" fill="#a8b8d4" font-family="Share Tech Mono" font-size="16">ciphersignal.xyz  ·  not financial advice</text>
</svg>`;
}

function renderPng(svg) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      fontFiles: FONT_FILES.filter((file) => fs.existsSync(file)),
      loadSystemFonts: false,
      defaultFontFamily: 'Share Tech Mono',
    },
  });
  return resvg.render().asPng();
}

function renderCard(report) {
  return renderPng(cardSvg(report || { stamp: 'CAUTION', symbol: '???', chainName: '', reasons: ['Scan unavailable'] }));
}

function linePct(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'n/a';
  const n = Number(value);
  return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
}

function moversSvg(data) {
  const gainers = (data && data.gainers ? data.gainers : []).slice(0, 4);
  const losers = (data && data.losers ? data.losers : []).slice(0, 4);
  function lines(rows, y0, color, xLabel, xValue) {
    if (!rows.length) {
      return `<text x="${xLabel}" y="${y0}" fill="#a8b8d4" font-family="Share Tech Mono" font-size="24">no rows</text>`;
    }
    return rows.map((row, index) => {
      const y = y0 + index * 42;
      const label = xml((row.symbol || '').slice(0, 10));
      return `<text x="${xLabel}" y="${y}" fill="${color}" font-family="Orbitron" font-size="28" font-weight="700">${label}</text>
  <text x="${xValue}" y="${y}" fill="#e8eef8" font-family="Share Tech Mono" font-size="26">${xml(linePct(row.change24h))}</text>`;
    }).join('');
  }
  const stamp = data && data.ok ? '24H BOARD' : 'UNAVAILABLE';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#060810"/>
  <rect x="28" y="28" width="1144" height="574" rx="16" fill="#0b0e1a" stroke="#243050"/>
  <rect x="28" y="28" width="1144" height="8" fill="#00e5ff"/>
  <text x="64" y="100" fill="#00e5ff" font-family="Orbitron" font-size="22" font-weight="700">CIPHER // TOP MOVERS</text>
  <text x="64" y="168" fill="#e8eef8" font-family="Orbitron" font-size="54" font-weight="700">${xml(stamp)}</text>
  <text x="64" y="230" fill="#a8b8d4" font-family="Share Tech Mono" font-size="18">GAINERS</text>
  <text x="640" y="230" fill="#a8b8d4" font-family="Share Tech Mono" font-size="18">LOSERS</text>
  ${lines(gainers, 280, '#00ff99', 64, 300)}
  ${lines(losers, 280, '#ff3355', 640, 900)}
  <text x="64" y="560" fill="#a8b8d4" font-family="Share Tech Mono" font-size="18">ciphersignal.xyz/movers  ·  not financial advice</text>
</svg>`;
}

function coinSvg(coin) {
  const symbol = xml('$' + ((coin && coin.symbol) || 'TOKEN').toString().slice(0, 14));
  const name = xml(((coin && coin.name) || 'Coin').toString().slice(0, 42));
  const change = coin && coin.change24h;
  const color = change == null ? '#a8b8d4' : (change >= 0 ? '#00ff99' : '#ff3355');
  const price = coin && coin.price != null && Number.isFinite(Number(coin.price)) ? coin.price : null;
  let priceText = 'n/a';
  if (price != null) {
    const abs = Math.abs(price);
    priceText = abs >= 1 ? '$' + abs.toLocaleString('en-US', { maximumFractionDigits: 2 }) : (abs >= 0.0001 ? '$' + abs.toFixed(6) : '$' + abs.toExponential(2));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#060810"/>
  <rect x="28" y="28" width="1144" height="574" rx="16" fill="#0b0e1a" stroke="#243050"/>
  <rect x="28" y="28" width="1144" height="8" fill="${color}"/>
  <text x="64" y="108" fill="#00e5ff" font-family="Orbitron" font-size="22" font-weight="700">CIPHER // COIN</text>
  <text x="64" y="240" fill="#e8eef8" font-family="Orbitron" font-size="84" font-weight="700">${symbol}</text>
  <text x="64" y="300" fill="#a8b8d4" font-family="Share Tech Mono" font-size="28">${name}</text>
  <text x="64" y="420" fill="#e8eef8" font-family="Orbitron" font-size="64" font-weight="700">${xml(priceText)}</text>
  <text x="64" y="490" fill="${color}" font-family="Share Tech Mono" font-size="36">${xml(linePct(change))}  24H</text>
  <text x="64" y="560" fill="#a8b8d4" font-family="Share Tech Mono" font-size="18">ciphersignal.xyz/coin/${xml((coin && coin.id) || '')}  ·  not financial advice</text>
</svg>`;
}

function renderMoversCard(data) {
  return renderPng(moversSvg(data || { ok: false }));
}

function renderCoinCard(coin) {
  return renderPng(coinSvg(coin || { symbol: '???', name: 'Unavailable', id: '' }));
}

module.exports = { renderCard, renderMoversCard, renderCoinCard };
