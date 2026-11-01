'use strict';

const { handleUnsubscribe } = require('../../lib/alerts');

module.exports = async function handler(req, res) {
  const token = req.query && req.query.token;
  const confirm = req.query && String(req.query.confirm) === '1';
  const result = await handleUnsubscribe(req, token, confirm);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.status || 200).send(result.html);
};
