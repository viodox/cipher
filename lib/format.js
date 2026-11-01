'use strict';

function fmtMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return 'n/a';
  const value = Number(n);
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return sign + '$' + (abs / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
  return sign + '$' + Math.round(abs).toLocaleString('en-US');
}

function fmtPrice(p) {
  if (p == null || !Number.isFinite(Number(p))) return 'n/a';
  const n = Number(p);
  if (n === 0) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1) return (n < 0 ? '-$' : '$') + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (abs >= 0.01) return (n < 0 ? '-$' : '$') + abs.toFixed(4);
  if (abs >= 0.0001) return (n < 0 ? '-$' : '$') + abs.toFixed(6);
  if (abs >= 0.00000001) return (n < 0 ? '-$' : '$') + abs.toFixed(10).replace(/0+$/, '');
  return (n < 0 ? '-$' : '$') + abs.toExponential(2);
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return 'n/a';
  const value = Number(n);
  const sign = value > 0 ? '+' : '';
  return sign + value.toFixed(1) + '%';
}

function fmtRatio(n) {
  if (n == null || !Number.isFinite(Number(n))) return 'n/a';
  const value = Number(n);
  if (value >= 10) return value.toFixed(0) + '× cap';
  return value.toFixed(2) + '× cap';
}

function safeImage(url) {
  const value = String(url || '');
  if (/^https:\/\/([a-z0-9-]+\.)*coingecko\.com\//i.test(value)) return value;
  return '';
}

function clip(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trim() + '…';
}

function plainText(html, max) {
  const text = String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
  return clip(text, max || 280);
}

function jsonLdScript(data) {
  return '<script type="application/ld+json">' + JSON.stringify(data).replace(/</g, '\\u003c') + '</script>';
}

function tweetHref(text) {
  return 'https://x.com/intent/tweet?text=' + encodeURIComponent(text);
}

module.exports = {
  fmtMoney,
  fmtPrice,
  fmtPct,
  fmtRatio,
  safeImage,
  clip,
  plainText,
  jsonLdScript,
  tweetHref,
};
