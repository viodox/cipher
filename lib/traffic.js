'use strict';

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { kvConfig } = require('./alerts-ready');

// Adjust these without touching the matcher. A guarded route is
// /coin, /check/{chain}/{address}, /scan, /og, and /api/coingecko.
// Over the limit, the request still renders, but only from cache.
const RATE_LIMIT_MAX = 60;
const RATE_WINDOW_SEC = 10 * 60;
const SUSPICIOUS_COUNTRIES = new Set(['CN', 'SG', 'HK']);

const slot = new AsyncLocalStorage();

const ALLOW_BOT = /googlebot|adsbot-google|mediapartners-google|google-inspectiontool|storebot-google|bingbot|bingpreview|duckduckbot|slurp|twitterbot|facebookexternalhit|facebot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|pinterestbot|redditbot|applebot|iframely|embedly|vkshare/i;

const DENY_UA = /headless|phantomjs|puppeteer|playwright|selenium|slimerjs|cypress|python-requests|python-urllib|aiohttp|scrapy|wget\/|curl\/|libwww|go-http-client|okhttp|apache-httpclient|java\/|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|amazonbot|dataforseo|blexbot|serpstat|seekport|zgrab|masscan|sqlmap|nikto/i;

const MOBILE_OR_APP = /Mobile|Android|iPhone|iPad|iPod|IEMobile|webOS|BlackBerry|Twitter|Instagram|FBAN|FBAV|Snapchat|Line\/|MicroMessenger/i;

const OPEN = { deny: false, allowUpstream: true, guarded: false };

function header(req, name) {
  const headers = req && req.headers;
  if (!headers) return '';
  const value = headers[name] || headers[name.toLowerCase()] || '';
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function kindFromPath(pathname) {
  const path = String(pathname || '');
  if (path === '/api/coingecko' || path.startsWith('/api/coingecko/')) return 'coingecko';
  if (path.startsWith('/coin/')) return 'coin';
  if (path.startsWith('/check/')) return 'check';
  if (path.startsWith('/scan/')) return 'scan';
  if (path.startsWith('/og/')) return 'og';
  return '';
}

function kindFromQuery(query) {
  const page = String((query && (query.page || query.route)) || '');
  const mode = String((query && query.mode) || '');
  if (page === 'coin') return 'coin';
  if (page === 'ape') return 'check';
  if (mode === 'og') return 'og';
  if (mode === 'check') return 'check';
  if (mode === 'scan') return 'scan';
  return '';
}

function clientIp(req) {
  const forwarded = header(req, 'x-forwarded-for') || header(req, 'x-vercel-forwarded-for');
  const first = forwarded.split(',')[0].trim();
  return first || header(req, 'x-real-ip').trim();
}

function referrerHost(req) {
  const raw = header(req, 'referer') || header(req, 'referrer');
  if (!raw) return '';
  try { return new URL(raw).hostname.toLowerCase(); }
  catch (err) { return ''; }
}

function classify(req, kind) {
  if (!kind) return OPEN;
  if (!req || !req.headers) return Object.assign({}, OPEN, { guarded: true });
  const ua = header(req, 'user-agent').trim();
  if (ALLOW_BOT.test(ua)) return { deny: false, allowUpstream: true, guarded: true, bot: true };
  if (!ua || DENY_UA.test(ua)) {
    return { deny: true, allowUpstream: false, guarded: true, reason: 'ua' };
  }
  if (MOBILE_OR_APP.test(ua)) return { deny: false, allowUpstream: true, guarded: true };
  const country = header(req, 'x-vercel-ip-country').trim().toUpperCase();
  const host = referrerHost(req);
  const fetchSite = header(req, 'sec-fetch-site').trim().toLowerCase();
  const hot = SUSPICIOUS_COUNTRIES.has(country);
  // A referrer means the visit came from a page, including Google and this site.
  // The bot wave had no referrer at all.
  if (host) return { deny: false, allowUpstream: true, guarded: true };
  if (!hot && fetchSite) return { deny: false, allowUpstream: true, guarded: true };
  return { deny: false, allowUpstream: false, guarded: true, suspicious: true };
}

async function redisPipeline(commands) {
  const cfg = kvConfig();
  if (!cfg) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(cfg.url.replace(/\/$/, '') + '/pipeline', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        authorization: 'Bearer ' + cfg.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json)) return null;
    return json.map((row) => (row && Object.prototype.hasOwnProperty.call(row, 'result') ? row.result : null));
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function rateLimit(ip) {
  if (!ip || !kvConfig()) return { ok: false, limited: false };
  const id = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 20);
  const key = 'rl:v1:' + id;
  const rows = await redisPipeline([['INCR', key]]);
  const count = rows && Number(rows[0]);
  if (!Number.isFinite(count)) return { ok: false, limited: false };
  // TTL is set once per window. Refreshing it on every hit would never reset the counter.
  if (count === 1) await redisPipeline([['EXPIRE', key, String(RATE_WINDOW_SEC)]]);
  return { ok: true, count: count, limited: count > RATE_LIMIT_MAX };
}

async function decide(req, kind) {
  const decision = classify(req, kind);
  if (!decision.guarded || decision.deny || decision.bot || decision.allowUpstream === false) return decision;
  const limit = await rateLimit(clientIp(req));
  if (limit.limited) return Object.assign({}, decision, { allowUpstream: false, limited: true });
  return decision;
}

function sendDenied(res) {
  if (res && typeof res.status === 'function') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.status(403).send('Forbidden');
    return;
  }
  res.writeHead(403, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end('Forbidden');
}

function runWithTraffic(decision, fn) {
  return slot.run(decision || OPEN, fn);
}

function cacheOnly() {
  const current = slot.getStore();
  return !!(current && current.allowUpstream === false);
}

module.exports = {
  RATE_LIMIT_MAX,
  RATE_WINDOW_SEC,
  SUSPICIOUS_COUNTRIES,
  kindFromPath,
  kindFromQuery,
  classify,
  decide,
  sendDenied,
  runWithTraffic,
  cacheOnly,
  clientIp,
};
