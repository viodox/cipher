'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { esc } = require('./http-util');
const { shell, whereToBuyHtml, SITE, AFFILIATES, affiliateHref } = require('./chrome');
const { alertsReady, storageMode, emailConfigured } = require('./alerts-ready');
const { sendMail } = require('./mail');
const { loadMovers } = require('./movers');
const { loadBoard } = require('./ape');
const { redisCmd } = require('./store');
const { fmtPct } = require('./format');

const HASH_KEY = 'cipher:digest:subs';
const DAY_KEY = 'cipher:digest:sent:';
function digestFile() {
  return process.env.DIGEST_FILE || path.join(__dirname, '..', 'data', 'digest.json');
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function dayKey(now) {
  return new Date(now || Date.now()).toISOString().slice(0, 10);
}

async function readRows() {
  if (storageMode() === 'upstash') {
    const res = await redisCmd(['HGETALL', HASH_KEY]);
    if (!res.ok || !res.result) return [];
    const flat = res.result;
    const rows = [];
    for (let i = 0; i < flat.length; i += 2) {
      try { rows.push(JSON.parse(flat[i + 1])); } catch (err) { /* skip bad row */ }
    }
    return rows;
  }
  if (storageMode() === 'file') {
    try {
      const raw = await fs.promises.readFile(digestFile(), 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }
  return [];
}

async function writeRows(rows) {
  if (storageMode() === 'file') {
    const file = digestFile();
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(rows, null, 2));
    await fs.promises.rename(tmp, file);
    return;
  }
  if (storageMode() !== 'upstash') {
    const error = new Error('storage is not configured');
    error.status = 503;
    throw error;
  }
}

async function saveRow(row) {
  if (storageMode() === 'upstash') {
    await redisCmd(['HSET', HASH_KEY, row.email, JSON.stringify(row)]);
    return;
  }
  const rows = await readRows();
  const next = rows.filter((item) => item.email !== row.email);
  next.push(row);
  await writeRows(next);
}

async function fetchFear(fetchImpl) {
  const fn = fetchImpl || fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fn('https://api.alternative.me/fng/?limit=1', { signal: ctrl.signal, headers: { accept: 'application/json' } });
    const json = await res.json();
    const row = json && json.data && json.data[0];
    if (!row || !row.value) return null;
    return { value: String(row.value), label: String(row.value_classification || '') };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pickHall(board) {
  const rows = (board || []).filter((row) => row && row.letter && Number.isFinite(Number(row.score)));
  if (!rows.length) return { hall: null, shame: null };
  const sorted = rows.slice().sort((a, b) => Number(b.score) - Number(a.score));
  return { hall: sorted[0], shame: sorted[sorted.length - 1] };
}

function composeDigest(input) {
  const data = input || {};
  const movers = (data.movers || []).slice(0, 5);
  const hall = data.hall;
  const shame = data.shame;
  const fear = data.fear;
  const unsub = data.unsub || (SITE + '/digest');
  const moverLines = movers.length
    ? movers.map((row, index) => (index + 1) + '. $' + row.symbol + ' ' + fmtPct(row.change24h) + ' — ' + SITE + '/coin/' + row.id)
    : ['No mover cleared the filter in this snapshot.'];
  const hallLine = hall
    ? '$' + (hall.symbol || 'TOKEN') + ' ' + hall.letter + ' on ' + (hall.chain || '') + ' — ' + SITE + '/check/' + hall.chain + '/' + hall.address
    : 'No hall grade yet. ' + SITE + '/hall';
  const shameLine = shame
    ? '$' + (shame.symbol || 'TOKEN') + ' ' + shame.letter + ' on ' + (shame.chain || '') + ' — ' + SITE + '/check/' + shame.chain + '/' + shame.address
    : 'No shame grade yet. ' + SITE + '/shame';
  const fearLine = fear ? fear.value + ' ' + fear.label : 'Fear & Greed was not available.';
  const venues = AFFILIATES.map((item) => item.name + ': ' + SITE + affiliateHref(item));
  const text = [
    'CIPHER daily digest',
    '',
    'Top movers',
    ...moverLines,
    '',
    'Hall highlight',
    hallLine,
    '',
    'Shame highlight',
    shameLine,
    '',
    'Fear & Greed: ' + fearLine,
    '',
    'Smart Money Watch: ' + SITE + '/smart-money',
    'Compare two contracts: ' + SITE + '/compare',
    '',
    'Where to buy (referral links, we may earn a commission):',
    ...venues,
    '',
    'Unsubscribe: ' + unsub,
    '',
    'Grades are automated public checks. Not a recommendation. Not financial advice.',
  ].join('\n');
  const moverHtml = movers.length
    ? '<ol>' + movers.map((row) => '<li><a href="' + SITE + '/coin/' + encodeURIComponent(row.id) + '">$' + esc(row.symbol) + '</a> ' + esc(fmtPct(row.change24h)) + '</li>').join('') + '</ol>'
    : '<p>No mover cleared the filter in this snapshot.</p>';
  const html = '<div style="background:#060810;color:#e4eef8;font-family:ui-monospace,monospace;padding:24px">' +
    '<h1 style="color:#00e5ff;font-size:20px">CIPHER daily digest</h1>' +
    '<h2 style="color:#00e5ff;font-size:16px">Top movers</h2>' + moverHtml +
    '<h2 style="color:#00e5ff;font-size:16px">Hall highlight</h2><p>' + esc(hallLine) + '</p>' +
    '<h2 style="color:#00e5ff;font-size:16px">Shame highlight</h2><p>' + esc(shameLine) + '</p>' +
    '<p>Fear &amp; Greed: ' + esc(fearLine) + '</p>' +
    '<p><a href="' + SITE + '/smart-money" style="color:#041018;background:#00e5ff;padding:8px 12px;text-decoration:none;font-weight:700">Smart Money Watch</a></p>' +
    '<p>Where to buy — referral links, we may earn a commission.</p><ul>' +
    AFFILIATES.map((item) => '<li><a href="' + esc(SITE + affiliateHref(item)) + '" rel="sponsored nofollow noopener">' + esc(item.name) + '</a></li>').join('') +
    '</ul><p><a href="' + esc(unsub) + '">Unsubscribe</a></p>' +
    '<p>Grades are automated public checks. Not a recommendation. Not financial advice.</p></div>';
  return {
    subject: 'CIPHER digest — ' + (movers[0] ? '$' + movers[0].symbol + ' leads the movers' : 'today\'s public checks'),
    text,
    html,
  };
}

async function buildDigestContent(deps) {
  const load = (deps && deps.loadMovers) || loadMovers;
  const boardFn = (deps && deps.loadBoard) || loadBoard;
  const fearFn = (deps && deps.fetchFear) || fetchFear;
  let movers = [];
  try {
    const data = await load();
    if (data && data.ok) movers = data.gainers || [];
  } catch (err) { movers = []; }
  let picked = { hall: null, shame: null };
  try { picked = pickHall(await boardFn()); } catch (err) { picked = { hall: null, shame: null }; }
  const fear = await fearFn(deps && deps.fetchImpl);
  return { movers, hall: picked.hall, shame: picked.shame, fear };
}

function unsubLink(token) {
  return SITE + '/api/alerts/unsubscribe?token=' + encodeURIComponent(token) + '&list=digest&confirm=1';
}

function digestInputFromRequest(req) {
  if (req && req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (req && typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body)); }
    catch (err) { return Promise.resolve({}); }
  }
  if (!req || typeof req.on !== 'function') return Promise.resolve({});
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

async function createDigestSignup(input) {
  const email = normalizeEmail(input && input.email);
  if (!email) return { status: 400, body: { ok: false, stored: false, error: 'That email does not look usable.' } };
  if (input && input.company) return { status: 200, body: { ok: true, stored: false } };
  if (storageMode() === 'unconfigured') {
    return { status: 503, body: { ok: false, stored: false, error: 'The digest list is not available right now. Nothing was saved.' } };
  }
  const rows = await readRows();
  const existing = rows.find((row) => row.email === email && row.status !== 'unsubscribed');
  if (existing) {
    return { status: 200, body: { ok: true, stored: false, message: 'That email is already on the digest list.' } };
  }
  const row = {
    email,
    unsubToken: crypto.randomBytes(16).toString('hex'),
    status: 'active',
    createdAt: new Date().toISOString(),
    lastSentOn: '',
  };
  await saveRow(row);
  let emailed = false;
  if (emailConfigured()) {
    const mail = await sendMail({
      to: email,
      subject: 'CIPHER daily digest is on',
      text: 'You are on the CIPHER daily digest.\n\nSmart Money Watch: ' + SITE + '/smart-money\n\nUnsubscribe: ' + unsubLink(row.unsubToken) + '\n\nNot financial advice.',
      html: '<p>You are on the CIPHER daily digest.</p><p><a href="' + SITE + '/smart-money">Smart Money Watch</a></p><p><a href="' + unsubLink(row.unsubToken) + '">Unsubscribe</a></p>',
      unsub: unsubLink(row.unsubToken),
    });
    emailed = Boolean(mail.ok);
  }
  return {
    status: 200,
    body: {
      ok: true,
      stored: true,
      emailed,
      message: emailed
        ? 'Saved. A confirmation email is on its way. The digest goes out with the daily run.'
        : 'Saved. Resend is not delivering yet, so the confirmation waits. The row stays on the list and the daily run retries. This page does not mark the sending domain verified.',
    },
  };
}

async function unsubscribeDigest(token) {
  const value = String(token || '');
  if (!/^[a-f0-9]{32}$/.test(value)) return { ok: false, status: 400 };
  const rows = await readRows();
  const row = rows.find((item) => item.unsubToken === value);
  if (!row) return { ok: false, status: 404 };
  row.status = 'unsubscribed';
  row.unsubscribedAt = new Date().toISOString();
  await saveRow(row);
  return { ok: true, status: 200 };
}

async function runDigest(opts) {
  const options = opts || {};
  const now = options.now || Date.now();
  const today = dayKey(now);
  const content = await buildDigestContent(options);
  const preview = composeDigest(Object.assign({}, content, { unsub: SITE + '/digest' }));
  if (options.dry) {
    const rows = storageMode() === 'unconfigured' ? [] : await readRows();
    return {
      ok: true,
      dry: true,
      subject: preview.subject,
      text: preview.text,
      html: preview.html,
      recipients: rows.filter((row) => row.status === 'active').length,
      sent: 0,
    };
  }
  if (!emailConfigured()) {
    return { ok: true, sent: 0, skipped: true, reason: 'resend-not-configured', subject: preview.subject };
  }
  if (storageMode() === 'unconfigured') {
    return { ok: false, sent: 0, error: 'storage is not configured' };
  }
  let gateHeld = false;
  if (storageMode() === 'upstash') {
    const gate = await redisCmd(['SET', DAY_KEY + today, '1', 'NX', 'EX', String(3 * 24 * 60 * 60)]);
    if (gate.ok && gate.result !== 'OK') return { ok: true, sent: 0, skipped: true, reason: 'already-sent-today' };
    gateHeld = Boolean(gate.ok && gate.result === 'OK');
  }
  const rows = await readRows();
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row || row.status !== 'active') continue;
    if (row.lastSentOn === today) continue;
    const message = composeDigest(Object.assign({}, content, { unsub: unsubLink(row.unsubToken) }));
    const mail = await sendMail({
      to: row.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
      unsub: unsubLink(row.unsubToken),
    });
    if (!mail.ok) {
      failed += 1;
      continue;
    }
    row.lastSentOn = today;
    await saveRow(row);
    sent += 1;
  }
  if (gateHeld && sent === 0 && failed > 0) await redisCmd(['DEL', DAY_KEY + today]);
  return { ok: true, sent, failed, subject: preview.subject };
}

function renderDigestPage(status) {
  const ready = storageMode() !== 'unconfigured';
  const form = ready
    ? `<form id="digest-form" class="alert-form" action="/api/alerts?action=digest-signup" method="post">
        <div class="hp" aria-hidden="true"><label>company <input type="text" name="company" tabindex="-1" autocomplete="off"></label></div>
        <label class="alert-field">email <input type="email" name="email" required maxlength="254" placeholder="you@email.com" autocomplete="email"></label>
        <button type="submit">send me the digest</button>
        <p class="form-note">One email a day: five movers, one hall grade, one shame grade, Fear &amp; Greed when the free index answers, and a link to Smart Money Watch. Unsubscribe in one click. The sender is the Resend address already used for alerts. This page does not mark that domain verified. If Resend rejects the send, the signup is kept and the daily run retries.</p>
        <p id="digest-msg" role="status"></p>
      </form>
      <script>
      document.getElementById('digest-form').addEventListener('submit', function(ev){
        ev.preventDefault();
        var form=this; var msg=document.getElementById('digest-msg'); var button=form.querySelector('button');
        button.disabled=true;
        fetch('/api/alerts?action=digest-signup', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({email: form.email.value, company: form.company ? form.company.value : ''})})
          .then(function(r){ return r.json().then(function(data){ return data || {}; }).catch(function(){ return {}; }); })
          .then(function(data){
            msg.style.color = data.stored ? (data.emailed ? 'var(--pos)' : 'var(--warn)') : 'var(--neg)';
            msg.textContent = data.message || data.error || 'Could not save that signup.';
          })
          .catch(function(){ msg.style.color='var(--neg)'; msg.textContent='Network error. Try again.'; })
          .then(function(){ button.disabled=false; });
      });
      </script>`
    : '<p class="hint">The digest list needs the same Upstash database as price alerts. Nothing is saved until that is set.</p>';
  const note = status && status.email === false
    ? '<p class="hint">Resend is not fully delivering yet. Signups can still be stored. Do not treat the domain as verified.</p>'
    : '';
  const html = shell({
    title: 'Daily digest — CipherSignal',
    heading: 'daily digest',
    description: 'One daily email: top movers, a hall grade, a shame grade, Fear and Greed, and Smart Money Watch.',
    path: '/digest',
    active: 'alerts',
    alertsReady: alertsReady(),
    shareText: 'CIPHER daily digest — movers, grades, and Smart Money Watch\n\nvia @ciphersignal_\n' + SITE + '/digest',
    lede: 'The same free email list idea as price alerts, once a day. No paid data. Grades stay automated public checks.',
    body: '<section class="card"><h2>get the digest</h2>' + note + form + '</section>' + whereToBuyHtml({ heading: 'where to buy', noteHtml: 'These referral links are also in the email.' }),
  });
  return { status: 200, html, cacheControl: 'public, max-age=60, s-maxage=120' };
}

module.exports = {
  normalizeEmail,
  composeDigest,
  digestInputFromRequest,
  createDigestSignup,
  unsubscribeDigest,
  runDigest,
  renderDigestPage,
  buildDigestContent,
  pickHall,
  dayKey,
  unsubLink,
};
