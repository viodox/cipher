'use strict';

const { scanToken } = require('../lib/security');

module.exports = async function handler(req, res) {
  const report = await scanToken(req.query.chain, req.query.address);
  res.setHeader('Cache-Control', report.ok ? 'public, s-maxage=60, stale-while-revalidate=120' : 'no-store');
  res.status(report.status || (report.ok ? 200 : 502)).json(report);
};
