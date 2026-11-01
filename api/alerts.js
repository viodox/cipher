'use strict';

const { handleAlertHttp } = require('../lib/alerts');

module.exports = async function handler(req, res) {
  const result = await handleAlertHttp(req);
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.status || 500).json(result.body);
};
