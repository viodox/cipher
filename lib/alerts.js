'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { esc } = require('./http-util');
const { proxyCoinGeckoJson } = require('./coingecko');
const { validCoinId } = require('./coin');
const { shell, alertFormHtml, whereToBuyHtml, SITE } = require('./chrome');
const { loadMovers } = require('./movers');

// TODO(alerts-delivery): Signups are stored only. Nothing sends email.
// To deliver later:
// 1. Provision free Upstash Redis (or Vercel KV) and set KV_REST_API_URL + KV_REST_API_TOKEN
//    (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN also work).
// 2. Set ALERTS_ADMIN_TOKEN so the owner can export pending rows from GET /api/alerts.
// 3. Add a mail provider (for example Resend's free tier) and a scheduled job that
//    reads pending alerts, compares CoinGecko USD price to the threshold, sends mail,
//    and marks the row. Do not claim alerts are sent until that job exists.

const HASH_KEY = 'cipher:alerts';
const DEDUPE_PREFIX = 'cipher:alert:dedupe:';
const MAX_ALERTS = 5000;
const FILE = process.env.ALERTS_FILE || path.join(__dirname, '..', 'data', 'alerts.json');
const hits = new Map();

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

function storageMode() {
  if (kvConfig()) return 'upstash';
  if (!process.env.VERCEL) return 'file';
  return 'unconfigured';
}

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
    return { status: 503, body: { ok: false, stored: false, error: 'Alert storage is not configured on this server. Nothing was saved. The owner needs a free Upstash Redis or Vercel KV database.' } };
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
    return { status: 200, body: { ok: true, stored: true, id: row.id, message: 'Saved. CIPHER is not sending email yet — this signup waits until a delivery job is connected.' } };
  }
  const rows = await fileRead();
  if (rows.some((item) => item.dedupe === dedupe)) {
    return { status: 200, body: { ok: true, stored: false, error: 'That email, coin, direction, and threshold is already saved.' } };
  }
  rows.push(row);
  await fileWrite(rows);
  return { status: 200, body: { ok: true, stored: true, id: row.id, message: 'Saved. CIPHER is not sending email yet — this signup waits until a delivery job is connected.' } };
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
    return { status: 400, body: { ok: false, stored: false, error: 'Send JSON with email, coinId, direction, and threshold.' } };
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
    direction,
    threshold,
    createdAt: new Date().toISOString(),
    status: 'pending',
    dedupe,
  };
  try {
    return await saveAlert(row, dedupe);
  } catch (err) {
    console.error('alert store failed', err.status || err.message);
    return { status: 502, body: { ok: false, stored: false, error: 'Storage failed. Nothing was saved.' } };
  }
}

async function readAlerts(authHeader) {
  const mode = storageMode();
  const token = process.env.ALERTS_ADMIN_TOKEN || '';
  const provided = bearer(authHeader);
  if (!token || !safeEqual(provided, token)) {
    return {
      status: 200,
      body: {
        ok: true,
        storage: mode,
        delivery: false,
        message: 'POST an email, coinId, direction (above or below), and threshold. Signups are stored only. Delivery is not enabled.',
      },
    };
  }
  try {
    const rows = (await listStored()).map(publicAlert).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return {
      status: 200,
      body: {
        ok: true,
        storage: mode,
        delivery: false,
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

async function renderAlertsPage() {
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
  } catch (err) { /* form still renders */ }
  const mode = storageMode();
  const storageNote = mode === 'unconfigured'
    ? 'This deploy has no Upstash or Vercel KV credentials yet, so a signup cannot be stored until the owner adds them.'
    : 'Signups are stored on the server. They are not emailed.';
  const html = shell({
    title: 'Price alerts — CIPHER',
    heading: 'price alerts',
    description: 'Save an email, a coin, and a USD price threshold on CIPHER. Signup only — alert email is not sent yet.',
    path: '/alerts',
    active: 'alerts',
    shareText: 'Set a meme coin price alert on CIPHER\n\nvia @ciphersignal_\n' + SITE + '/alerts',
    lede: 'Pick a CoinGecko id and a USD price. ' + esc(storageNote),
    body: '<section class="card">' + alertFormHtml({ coins }) + '</section>' + whereToBuyHtml(),
  });
  return { status: 200, html, cacheControl: 'public, max-age=120, s-maxage=300' };
}

module.exports = {
  handleAlertHttp,
  renderAlertsPage,
  storageMode,
  normalizeEmail,
  normalizeThreshold,
  createAlert,
};
