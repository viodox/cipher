'use strict';

const { renderMoversPage } = require('../lib/movers');
const { renderUpdatesPage } = require('../lib/updates');
const { renderAlertsPage } = require('../lib/alerts');

module.exports = async function handler(req, res) {
  const page = String(req.query.page || '');
  let result = null;
  if (page === 'movers') result = await renderMoversPage();
  else if (page === 'updates') result = renderUpdatesPage();
  else if (page === 'alerts') result = await renderAlertsPage();
  if (!result) {
    res.status(404).send('Not found');
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', result.cacheControl || 'no-store');
  res.status(result.status || 200).send(result.html);
};
