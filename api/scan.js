'use strict';

const { scanToken } = require('../lib/security');
const { renderScanPage, renderScanError } = require('../lib/pages');

module.exports = async function handler(req, res) {
  const report = await scanToken(req.query.chain, req.query.address);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!report.ok && report.status === 400) {
    res.status(400).send(renderScanError(report.error || 'bad scan'));
    return;
  }
  if (!report.ok) {
    res.status(502).send(renderScanError('scanners are unavailable — try again in a minute'));
    return;
  }
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  res.status(200).send(renderScanPage(report));
};
