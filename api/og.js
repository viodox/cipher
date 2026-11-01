'use strict';

const { scanToken } = require('../lib/security');
const { renderCard } = require('../lib/og');

module.exports = async function handler(req, res) {
  const report = await scanToken(req.query.chain, req.query.address);
  const png = renderCard(report.ok ? report : {
    stamp: 'CAUTION',
    symbol: '???',
    chainName: '',
    name: report.error || 'Scan unavailable',
    reasons: [report.error || 'Scan unavailable'],
  });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', report.ok ? 'public, s-maxage=60, stale-while-revalidate=300' : 'no-store');
  res.status(report.ok ? 200 : (report.status || 502)).send(png);
};
