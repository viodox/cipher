'use strict';

const { handleRun } = require('../../lib/alerts');

module.exports = async function handler(req, res) {
  const result = await handleRun(req);
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.status || 500).json(result.body);
};
