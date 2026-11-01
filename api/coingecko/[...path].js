'use strict';

const { proxyCoinGecko } = require('../../lib/coingecko');

module.exports = async function handler(req, res) {
  const parts = req.query.path;
  const path = Array.isArray(parts) ? parts.join('/') : String(parts || '');
  const params = Object.assign({}, req.query);
  delete params.path;
  const result = await proxyCoinGecko(path, params);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', result.ok ? 'public, s-maxage=60, stale-while-revalidate=120' : 'no-store');
  res.status(result.status).send(result.body);
};
