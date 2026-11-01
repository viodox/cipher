'use strict';

const { handleAlertHttp, handleRun, handleUnsubscribe } = require('../lib/alerts');

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
