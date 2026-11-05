'use strict';

const { handleAlertHttp, handleRun, handleUnsubscribe } = require('../lib/alerts');
const { createDigestSignup, digestInputFromRequest, unsubscribeDigest } = require('../lib/digest');

function actionOf(req) {
  const queryAction = req.query && req.query.action;
  if (queryAction) return String(queryAction);
  const path = String((req.url || '').split('?')[0]);
  if (path.endsWith('/run')) return 'run';
  if (path.endsWith('/unsubscribe')) return 'unsubscribe';
  return '';
}

module.exports = async function handler(req, res) {
  const action = actionOf(req);
  if (action === 'run') {
    const result = await handleRun(req);
    res.setHeader('Cache-Control', 'no-store');
    res.status(result.status || 500).json(result.body);
    return;
  }
  if (action === 'digest-signup') {
    const input = await digestInputFromRequest(req);
    const result = await createDigestSignup(input);
    res.setHeader('Cache-Control', 'no-store');
    res.status(result.status || 500).json(result.body);
    return;
  }
  if (action === 'digest') {
    const result = await handleRun(req, { digestOnly: true, dry: req.query && String(req.query.dry) === '1' });
    res.setHeader('Cache-Control', 'no-store');
    res.status(result.status || 500).json(result.body);
    return;
  }
  if (action === 'digest-unsubscribe' || (action === 'unsubscribe' && req.query && req.query.list === 'digest')) {
    const token = req.query && req.query.token;
    const confirm = req.query && String(req.query.confirm) === '1';
    if (!confirm && String(req.method || '').toUpperCase() !== 'POST') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Unsubscribe — CIPHER</title><meta name="robots" content="noindex"></head><body style="background:#060810;color:#e4eef8;font-family:ui-monospace,monospace;padding:2rem"><form method="post" action="/api/alerts/unsubscribe?list=digest&amp;confirm=1&amp;token=' + encodeURIComponent(String(token || '')) + '"><p>Stop the CIPHER daily digest.</p><button type="submit">unsubscribe</button></form></body></html>');
      return;
    }
    const result = await unsubscribeDigest(token);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const message = result.ok ? 'You are off the daily digest.' : 'That unsubscribe link is not valid.';
    res.status(result.status || 200).send('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Unsubscribe — CIPHER</title><meta name="robots" content="noindex"></head><body style="background:#060810;color:#e4eef8;font-family:ui-monospace,monospace;padding:2rem"><p>' + message + '</p><p><a href="/digest" style="color:#00e5ff">digest</a></p></body></html>');
    return;
  }
  if (action === 'unsubscribe') {
    const token = req.query && req.query.token;
    const confirm = req.query && String(req.query.confirm) === '1';
    const result = await handleUnsubscribe(req, token, confirm);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(result.status || 200).send(result.html);
    return;
  }
  const result = await handleAlertHttp(req);
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.status || 500).json(result.body);
};
