'use strict';

const { renderCoinPage } = require('../lib/coin');

module.exports = async function handler(req, res) {
  const result = await renderCoinPage(req.query.id);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', result.cacheControl || 'no-store');
  res.status(result.status || 200).send(result.html);
};
