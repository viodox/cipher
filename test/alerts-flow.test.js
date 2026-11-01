'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, before, after } = require('node:test');

const file = path.join(os.tmpdir(), 'cipher-alerts-' + process.pid + '.json');
process.env.ALERTS_FILE = file;
process.env.RESEND_API_KEY = 'test-key';
process.env.RESEND_FROM = 'CIPHER <alerts@example.com>';
process.env.RESEND_API_URL = 'https://resend.test/emails';
process.env.CRON_SECRET = 'cron-test-secret';
delete process.env.VERCEL;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const alerts = require('../lib/alerts');
const { clearProxyCache } = require('../lib/coingecko');

let priceUsd = 0.2;
const sent = [];

before(() => {
  global.fetch = async (url, opts) => {
    const href = String(url);
    if (href.includes('api.coingecko.com')) {
      if (href.includes('simple/price')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ dogecoin: { usd: priceUsd } }) };
      }
      return { ok: true, status: 200, text: async () => '{"id":"dogecoin","symbol":"doge"}' };
    }
    sent.push(JSON.parse(opts.body));
    return { ok: true, status: 200, text: async () => '{"id":"email_1"}' };
  };
});

after(() => {
  delete global.fetch;
  fs.rmSync(file, { force: true });
});

test('signup sends one confirmation and the daily run sends once', async () => {
  assert.equal(alerts.alertsReady(), true);
  const created = await alerts.createAlert({
    email: 'person@example.com',
    coinId: 'dogecoin',
    direction: 'above',
    threshold: '0.5',
    company: '',
  });
  assert.equal(created.body.stored, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Unsubscribe/);
  assert.match(sent[0].subject, /DOGE/);

  priceUsd = 0.2;
  const quiet = await alerts.runAlerts();
  assert.equal(quiet.sent, 0);
  assert.equal(sent.length, 1);

  priceUsd = 0.8;
  clearProxyCache();
  const hit = await alerts.runAlerts();
  assert.equal(hit.sent, 1);
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /will not email again/);

  const again = await alerts.runAlerts();
  assert.equal(again.sent, 0);
  assert.equal(sent.length, 2);

  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(rows[0].status, 'sent');
  const token = rows[0].unsubToken;
  const page = await alerts.handleUnsubscribe({ method: 'GET' }, token, true);
  assert.equal(page.status, 200);
  assert.match(page.html, /unsubscribed/i);
});

test('a rejected confirmation still keeps the signup and does not mark it sent', async () => {
  const { clearProxyCache } = require('../lib/coingecko');
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('coingecko')) return realFetch(url, opts);
    return { ok: false, status: 403, text: async () => '{"message":"The domain is not verified"}' };
  };
  const created = await alerts.createAlert({
    email: 'other@example.com',
    coinId: 'dogecoin',
    direction: 'below',
    threshold: '0.01',
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.stored, true);
  assert.equal(created.body.emailed, false);
  assert.match(created.body.message, /not be sent yet/);
  priceUsd = 0.001;
  clearProxyCache();
  const run = await alerts.runAlerts();
  assert.equal(run.sent, 0);
  assert.ok(run.failed >= 1);
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const row = rows.find((item) => item.email === 'other@example.com');
  assert.ok(row);
  assert.equal(row.status, 'pending');
  assert.equal(row.confirmError, 'domain');
  global.fetch = realFetch;
});

test('the run endpoint rejects a missing cron secret and waits for Resend', async () => {
  const denied = await alerts.handleRun({ headers: {} });
  assert.equal(denied.status, 401);
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  const waiting = await alerts.handleRun({ headers: { authorization: 'Bearer cron-test-secret' } });
  process.env.RESEND_API_KEY = key;
  process.env.RESEND_FROM = from;
  assert.equal(waiting.status, 200);
  assert.equal(waiting.body.sent, 0);
  assert.deepEqual(waiting.body.waiting, ['RESEND_API_KEY', 'RESEND_FROM']);
  const ok = await alerts.handleRun({ headers: { authorization: 'Bearer cron-test-secret' } });
  assert.equal(ok.status, 200);
  assert.equal(typeof ok.body.sent, 'number');
});
