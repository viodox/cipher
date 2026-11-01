'use strict';

const { renderAppRoute } = require('../lib/pages');

module.exports = function handler(req, res) {
  const html = renderAppRoute(String(req.query.route || ''));
  if (!html) {
    res.status(404).send('Not found');
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).send(html);
};
