'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { esc } = require('./http-util');
const { proxyCoinGeckoJson } = require('./coingecko');
const { validCoinId } = require('./coin');
const { shell, alertFormHtml, whereToBuyHtml, SITE } = require('./chrome');
const { loadMovers } = require('./movers');
const { kvConfig, storageMode, alertsReady, emailConfigured, alertStatus } = require('./alerts-ready');
const { ANALYTICS_SNIPPET } = require('./web-analytics');
const { sendMail, confirmationText, alertText, unsubUrl } = require('./mail');

const HASH_KEY = 'cipher:alerts';
const DEDUPE_PREFIX = 'cipher:alert:dedupe:';
const UNSUB_PREFIX = 'cipher:alert:unsub:';
const MAX_ALERTS = 5000;
const FILE = process.env.ALERTS_FILE || path.join(__dirname, '..', 'data', 'alerts.json');
const hits = new Map();

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

function bearer(header) {
  const match = String(header || '').match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : '';
}

function limited(key) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const prev = (hits.get(key) || []).filter((stamp) => now - stamp < windowMs);
  if (prev.length >= 8) {
    hits.set(key, prev);
    return true;
  }
  prev.push(now);
  hits.set(key, prev);
  return false;
}

function clientKey(req) {
  const forwarded = req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim().slice(0, 80);
  return (req.socket && req.socket.remoteAddress) || 'local';
}

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body)); }
    catch (err) { return Promise.resolve({ _invalid: true }); }
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 10000) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) { resolve({ _invalid: true }); }
    });
    req.on('error', reject);
  });
}

function normalizeThreshold(value) {
  const number = typeof value === 'number' ? value : Number(String(value || '').trim());
  if (!Number.isFinite(number) || number <= 0 || number >= 1e9) return null;
  const rounded = Math.round(number * 1e12) / 1e12;
  if (rounded <= 0) return null;
  return rounded;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function publicAlert(row) {
  return {
    id: row.id,
    email: row.email,
    coinId: row.coinId,
    direction: row.direction,
    threshold: row.threshold,
    createdAt: row.createdAt,
    status: row.status || 'pending',
  };
}

async function kvCommand(command) {
  const cfg = kvConfig();
  if (!cfg) throw Object.assign(new Error('storage is not configured'), { status: 503 });
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + cfg.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (err) { json = null; }
  if (!res.ok || !json || json.error) {
    const error = new Error('storage request failed');
    error.status = 502;
    throw error;
  }
  return json.result;
}

async function fileRead() {
  try {
    const raw = await fs.promises.readFile(FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function fileWrite(rows) {
  await fs.promises.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  await fs.promises.writeFile(tmp, JSON.stringify(rows, null, 2));
  await fs.promises.rename(tmp, FILE);
}

async function countAlerts() {
  if (storageMode() === 'upstash') {
    const count = await kvCommand(['HLEN', HASH_KEY]);
    return Number(count) || 0;
  }
  if (storageMode() === 'file') return (await fileRead()).length;
  return 0;
}

async function saveAlert(row, dedupe) {
  const mode = storageMode();
  if (mode === 'unconfigured') {
    return { status: 503, body: { ok: false, stored: false, error: 'Alerts are not available right now. Nothing was saved.' } };
  }
  if (await countAlerts() >= MAX_ALERTS) {
    return { status: 429, body: { ok: false, stored: false, error: 'The alert list is full. Nothing was saved.' } };
  }
  if (mode === 'upstash') {
    const set = await kvCommand(['SET', DEDUPE_PREFIX + dedupe, row.id, 'NX']);
    if (set !== 'OK') {
      return { status: 200, body: { ok: true, stored: false, error: 'That email, coin, direction, and threshold is already saved.' } };
    }
    try {
      await kvCommand(['HSET', HASH_KEY, row.id, JSON.stringify(row)]);
    } catch (err) {
      try { await kvCommand(['DEL', DEDUPE_PREFIX + dedupe]); } catch (ignore) { /* keep the original error */ }
      throw err;
    }
    await kvCommand(['SET', UNSUB_PREFIX + row.unsubToken, row.id]);
    return { status: 200, body: savedBody(row) };
  }
  const rows = await fileRead();
  if (rows.some((item) => item.dedupe === dedupe)) {
    return { status: 200, body: { ok: true, stored: false, error: 'That email, coin, direction, and threshold is already saved.' } };
  }
  rows.push(row);
  await fileWrite(rows);
  return { status: 200, body: savedBody(row) };
}

function savedBody(row) {
  return {
    ok: true,
    stored: true,
    emailed: true,
    id: row.id,
    message: 'Saved. A confirmation email is on its way. The price is checked once a day on the free plan.',
  };
}

function deferredBody(row) {
  return {
    ok: true,
    stored: true,
    emailed: false,
    id: row.id,
    message: 'Saved. The confirmation email could not be sent yet — the sending domain may still be verifying. Your alert is stored and was not marked sent. The daily check will try the email again.',
  };
}

function mailReason(result) {
  if (result && (result.status === 403 || result.status === 422)) return 'domain';
  return 'rejected';
}

async function replaceRow(row) {
  if (storageMode() === 'upstash') {
    await kvCommand(['HSET', HASH_KEY, row.id, JSON.stringify(row)]);
    return;
  }
  const rows = await fileRead();
  const next = rows.map((item) => (item.id === row.id ? row : item));
  await fileWrite(next);
}

async function removeRow(row) {
  if (storageMode() === 'upstash') {
    await kvCommand(['HDEL', HASH_KEY, row.id]);
    await kvCommand(['DEL', DEDUPE_PREFIX + row.dedupe]);
    await kvCommand(['DEL', UNSUB_PREFIX + row.unsubToken]);
    return;
  }
  const rows = await fileRead();
  await fileWrite(rows.filter((item) => item.id !== row.id));
}

async function listStored() {
  if (storageMode() === 'upstash') {
    const flat = await kvCommand(['HGETALL', HASH_KEY]);
    const rows = [];
    const list = Array.isArray(flat) ? flat : [];
    for (let i = 0; i < list.length; i += 2) {
      try { rows.push(JSON.parse(list[i + 1])); } catch (err) { /* skip bad row */ }
    }
    return rows;
  }
  if (storageMode() === 'file') return fileRead();
  return [];
}

async function createAlert(input) {
  if (!input || input._invalid) {
    return { status: 400, body: { ok: false, stored: false, error: 'Enter an email, a coin, and a USD price.' } };
  }
  if (String(input.company || '').trim()) {
    return { status: 400, body: { ok: false, stored: false, error: 'Bad request.' } };
  }
  const email = normalizeEmail(input.email);
  const coinId = validCoinId(input.coinId);
  const direction = input.direction === 'below' ? 'below' : (input.direction === 'above' ? 'above' : '');
  const threshold = normalizeThreshold(input.threshold);
  if (!email) return { status: 400, body: { ok: false, stored: false, error: 'Enter a valid email.' } };
  if (!coinId) return { status: 400, body: { ok: false, stored: false, error: 'Enter a CoinGecko coin id, like dogecoin.' } };
  if (!direction) return { status: 400, body: { ok: false, stored: false, error: 'Direction must be above or below.' } };
  if (threshold == null) return { status: 400, body: { ok: false, stored: false, error: 'Enter a USD price above 0.' } };
  if (!alertsReady()) {
    return { status: 503, body: { ok: false, stored: false, ready: false, error: 'Price alerts are coming soon. Nothing was saved.' } };
  }

  const check = await proxyCoinGeckoJson('coins/' + coinId, {
    localization: 'false',
    tickers: 'false',
    market_data: 'false',
    community_data: 'false',
    developer_data: 'false',
    sparkline: 'false',
  });
  if (check.status === 404) {
    return { status: 400, body: { ok: false, stored: false, error: 'CoinGecko has no coin with that id.' } };
  }
  if (!check.ok) {
    return { status: 502, body: { ok: false, stored: false, error: 'Could not verify that coin right now. Nothing was saved.' } };
  }

  const dedupe = crypto.createHash('sha256').update([email, coinId, direction, String(threshold)].join('|')).digest('hex');
  const row = {
    id: 'alert_' + crypto.randomBytes(8).toString('hex'),
    email,
    coinId,
    coinSymbol: String((check.json && check.json.symbol) || coinId).toUpperCase().slice(0, 16),
    direction,
    threshold,
    createdAt: new Date().toISOString(),
    status: 'pending',
    unsubToken: crypto.randomBytes(16).toString('hex'),
    dedupe,
  };
  let saved;
  try {
    saved = await saveAlert(row, dedupe);
  } catch (err) {
    console.error('alert store failed', err.status || err.message);
    return { status: 502, body: { ok: false, stored: false, error: 'Storage failed. Nothing was saved.' } };
  }
  if (!saved.body.stored) return saved;
  const mailed = await sendMail({
    to: row.email,
    subject: 'CIPHER alert saved for ' + row.coinSymbol,
    text: confirmationText(row),
    unsub: unsubUrl(row.unsubToken),
  });
  if (!mailed.ok) {
    row.confirmStatus = 'deferred';
    row.confirmError = mailReason(mailed);
    try { await replaceRow(row); } catch (err) { console.error('alert confirm status was not saved'); }
    return { status: 200, body: deferredBody(row) };
  }
  row.confirmSentAt = new Date().toISOString();
  try { await replaceRow(row); } catch (err) { /* the row exists; confirmation already went out */ }
  return saved;
}

async function readAlerts(authHeader) {
  const token = process.env.ALERTS_ADMIN_TOKEN || '';
  const provided = bearer(authHeader);
  if (!token || !safeEqual(provided, token)) {
    return {
      status: 200,
      body: {
        ok: true,
        ...alertStatus(),
        delivery: alertsReady() ? 'daily' : false,
        message: alertsReady()
          ? 'POST an email, coinId, direction (above or below), and threshold. A confirmation email is sent. Prices are checked on the daily cron.'
          : 'Price alerts are coming soon.',
      },
    };
  }
  try {
    const rows = (await listStored()).map(publicAlert).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return {
      status: 200,
      body: {
        ok: true,
        ...alertStatus(),
        delivery: alertsReady() ? 'daily' : false,
        count: rows.length,
        alerts: rows.slice(0, 1000),
        truncated: rows.length > 1000,
      },
    };
  } catch (err) {
    console.error('alert read failed', err.status || err.message);
    return { status: 502, body: { ok: false, error: 'Could not read stored alerts.' } };
  }
}

async function handleAlertHttp(req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET') return readAlerts(req.headers && (req.headers.authorization || req.headers.Authorization));
  if (method !== 'POST') return { status: 405, body: { ok: false, error: 'Method not allowed.' } };
  if (limited(clientKey(req))) {
    return { status: 429, body: { ok: false, stored: false, error: 'Too many signups from this network. Try again later.' } };
  }
  let input;
  try { input = await readJsonBody(req); }
  catch (err) { return { status: err.status || 400, body: { ok: false, stored: false, error: 'Could not read that request.' } }; }
  return createAlert(input);
}

function comingSoonHtml() {
  return '<section class="card"><h2>coming soon</h2>' +
    '<p class="hint">Price alerts are almost ready. The form stays hidden until email delivery is on, so nothing is saved by mistake.</p>' +
    '<p class="hint">When it opens, you get a confirmation and one email if your price is hit, plus a link to stop the emails. New tools show up first on <a href="/updates">what\'s new</a>.</p>' +
    '</section>';
}

async function renderAlertsPage() {
  const ready = alertsReady();
  let body = comingSoonHtml();
  let description = 'CIPHER price alerts are coming soon. The form stays hidden until email delivery is on.';
  let lede = 'Price alerts are <strong>coming soon</strong>. The signup form stays off until the emails can actually go out.';
  if (ready) {
    let coins = [
      { id: 'dogecoin', symbol: 'DOGE' },
      { id: 'pepe', symbol: 'PEPE' },
      { id: 'shiba-inu', symbol: 'SHIB' },
      { id: 'bonk', symbol: 'BONK' },
      { id: 'floki', symbol: 'FLOKI' },
      { id: 'dogwifcoin', symbol: 'WIF' },
    ];
    try {
      const movers = await loadMovers();
      if (movers.ok) {
        const extra = [].concat(movers.gainers, movers.losers, movers.volumeSpikes);
        extra.forEach((row) => {
          if (!coins.some((coin) => coin.id === row.id)) coins.push({ id: row.id, symbol: row.symbol });
        });
        coins = coins.slice(0, 40);
      }
    } catch (err) { /* suggestions are optional */ }
    description = 'Email when a coin crosses a USD price. CIPHER sends a confirmation, then one alert, with a one-click unsubscribe.';
    lede = 'Enter an email, a coin, and a USD price. We try to send a confirmation right away. If it does not arrive, the alert is still saved.';
    body = '<section class="card">' + alertFormHtml({ coins }) + '</section>';
  }
  const html = shell({
    title: ready ? 'Price alerts — CIPHER' : 'Price alerts coming soon — CIPHER',
    heading: 'price alerts',
    description,
    path: '/alerts',
    active: 'alerts',
    alertsReady: ready,
    shareText: 'Set a meme coin price alert on CIPHER\n\nvia @ciphersignal_\n' + SITE + '/alerts',
    lede,
    body: body + whereToBuyHtml(),
  });
  return { status: 200, html, cacheControl: 'public, max-age=60, s-maxage=120' };
}

function crossed(row, price) {
  if (row.direction === 'above') return price >= row.threshold;
  if (row.direction === 'below') return price <= row.threshold;
  return false;
}

async function fetchPrices(ids) {
  const prices = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (!chunk.length) continue;
    const result = await proxyCoinGeckoJson('simple/price', {
      ids: chunk.join(','),
      vs_currencies: 'usd',
    });
    if (!result.ok || !result.json) continue;
    Object.keys(result.json).forEach((id) => {
      const usd = result.json[id] && result.json[id].usd;
      if (Number.isFinite(Number(usd))) prices[id] = Number(usd);
    });
  }
  return prices;
}

async function runAlerts() {
  const rows = await listStored();
  const now = Date.now();
  const pending = rows.filter((row) => {
    if (row.status === 'pending') return true;
    if (row.status === 'sending') return now - Date.parse(row.sendingAt || 0) > 15 * 60 * 1000;
    return false;
  });
  const ids = [];
  pending.forEach((row) => { if (ids.indexOf(row.coinId) === -1) ids.push(row.coinId); });
  const prices = ids.length ? await fetchPrices(ids) : {};
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of pending) {
    if (!row.confirmSentAt) {
      const confirm = await sendMail({
        to: row.email,
        subject: 'CIPHER alert saved for ' + (row.coinSymbol || row.coinId),
        text: confirmationText(row),
        unsub: unsubUrl(row.unsubToken),
      });
      if (!confirm.ok) {
        row.confirmStatus = 'deferred';
        row.confirmError = mailReason(confirm);
        row.status = 'pending';
        await replaceRow(row);
        failed += 1;
        continue;
      }
      row.confirmSentAt = new Date().toISOString();
      row.confirmStatus = 'sent';
      row.confirmError = '';
      await replaceRow(row);
    }
    const price = prices[row.coinId];
    if (price == null || !crossed(row, price)) {
      skipped += 1;
      continue;
    }
    row.status = 'sending';
    row.sendingAt = new Date().toISOString();
    await replaceRow(row);
    const mailed = await sendMail({
      to: row.email,
      subject: 'CIPHER alert: ' + (row.coinSymbol || row.coinId) + ' is ' + row.direction + ' $' + row.threshold,
      text: alertText(row, price),
      unsub: unsubUrl(row.unsubToken),
    });
    if (!mailed.ok) {
      row.status = 'pending';
      row.confirmError = mailReason(mailed);
      await replaceRow(row);
      failed += 1;
      continue;
    }
    row.status = 'sent';
    row.sentAt = new Date().toISOString();
    row.sentPrice = price;
    await replaceRow(row);
    sent += 1;
  }
  return { ok: true, checked: pending.length, sent, skipped, failed };
}

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  const header = req.headers && (req.headers.authorization || req.headers.Authorization || '');
  const token = bearer(header);
  if (token && safeEqual(token, secret)) return true;
  const alt = req.headers && (req.headers['x-cron-secret'] || req.headers['X-Cron-Secret'] || '');
  return Boolean(alt && safeEqual(String(alt), secret));
}

async function handleRun(req) {
  if (!cronAuthorized(req)) {
    return { status: 401, body: { ok: false, error: 'Unauthorized. Set CRON_SECRET and send it as a bearer token.' } };
  }
  if (!emailConfigured()) {
    return {
      status: 200,
      body: {
        ok: true,
        sent: 0,
        waiting: ['RESEND_API_KEY', 'RESEND_FROM'].filter((name) => !process.env[name]),
        storage: storageMode(),
        message: 'Authorized with CRON_SECRET. No email was sent because Resend is not configured yet.',
      },
    };
  }
  if (storageMode() === 'unconfigured') {
    return { status: 503, body: { ok: false, error: 'Upstash is not configured, so the run did nothing.' } };
  }
  try {
    return { status: 200, body: await runAlerts() };
  } catch (err) {
    console.error('alert run failed', err.status || err.message);
    return { status: 502, body: { ok: false, error: 'The alert run failed.' } };
  }
}

function unsubPage(message) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Unsubscribe — CIPHER</title>' +
    '<link rel="icon" href="/favicon.ico"><meta name="robots" content="noindex">' +
    '<style>body{margin:0;min-height:100vh;background:#060810;color:#e4eef8;font-family:ui-monospace,monospace;font-size:16.5px;line-height:1.6;display:flex;align-items:center;justify-content:center}a{color:#00e5ff}</style>' +
    ANALYTICS_SNIPPET + '</head>' +
    '<body><div style="max-width:480px;padding:2rem"><h1 style="font-family:Orbitron,sans-serif;color:#00e5ff;font-size:20px;letter-spacing:.08em">CIPHER</h1><p>' +
    esc(message) + '</p><p><a href="/alerts">price alerts</a></p></div></body></html>';
}

async function unsubscribeToken(token) {
  const value = String(token || '');
  if (!/^[a-f0-9]{32}$/.test(value)) return { status: 400, html: unsubPage('That unsubscribe link is not valid.') };
  const rows = await listStored();
  const row = rows.find((item) => item.unsubToken === value);
  if (!row) return { status: 404, html: unsubPage('That alert is already gone.') };
  if (row.status !== 'unsubscribed') {
    row.status = 'unsubscribed';
    row.unsubscribedAt = new Date().toISOString();
    await replaceRow(row);
  }
  return { status: 200, html: unsubPage('You are unsubscribed. This alert will not email again.') };
}

async function handleUnsubscribe(req, token, confirm) {
  const go = confirm || String(req.method || '').toUpperCase() === 'POST';
  if (!go) {
    const safe = encodeURIComponent(String(token || ''));
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Unsubscribe — CIPHER</title><meta name="robots" content="noindex">' +
      '<style>body{margin:0;min-height:100vh;background:#060810;color:#e4eef8;font-family:ui-monospace,monospace;font-size:16.5px;line-height:1.6;display:flex;align-items:center;justify-content:center}button{font-family:Orbitron,sans-serif;background:#00e5ff;color:#041018;border:0;padding:8px 14px;border-radius:4px;cursor:pointer}</style>' +
      ANALYTICS_SNIPPET + '</head>' +
      '<body><form method="post" action="/api/alerts/unsubscribe?token=' + safe + '&confirm=1"><p>Stop emails for this CIPHER price alert.</p><button type="submit">unsubscribe</button></form></body></html>';
    return { status: 200, html };
  }
  try {
    return await unsubscribeToken(token);
  } catch (err) {
    return { status: 502, html: unsubPage('Could not update that alert. Try again in a minute.') };
  }
}

module.exports = {
  handleAlertHttp,
  handleRun,
  handleUnsubscribe,
  renderAlertsPage,
  storageMode,
  alertsReady,
  normalizeEmail,
  normalizeThreshold,
  createAlert,
  runAlerts,
};
