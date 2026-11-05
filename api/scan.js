'use strict';

const { scanToken } = require('../lib/security');
const { renderScanPage, renderScanError } = require('../lib/pages');
const { getRadar } = require('../lib/radar');
const { renderCard, renderMoversCard, renderCoinCard, renderApeCard, renderSmartMoneyCard } = require('../lib/og');
const { loadSmartMoney } = require('../lib/smart-money');
const { checkToken, listRecent, loadRasterLogo } = require('../lib/ape');
const { noteApeLookup } = require('../lib/ape-traffic');
const { loadMovers } = require('../lib/movers');
const { loadCoin } = require('../lib/coin');

module.exports = async function handler(req, res) {
  const mode = String((req.query && req.query.mode) || 'scan');

  if (mode === 'security') {
    const report = await scanToken(req.query.chain, req.query.address);
    res.setHeader('Cache-Control', report.ok ? 'public, s-maxage=60, stale-while-revalidate=120' : 'no-store');
    res.status(report.status || (report.ok ? 200 : 502)).json(report);
    return;
  }

  if (mode === 'radar') {
    const radar = await getRadar();
    res.setHeader('Cache-Control', radar.ok ? 'public, s-maxage=120, stale-while-revalidate=300' : 'no-store');
    res.status(radar.ok ? 200 : 502).json(radar);
    return;
  }

  if (mode === 'check') {
    if (req.query.chain && req.query.address) await noteApeLookup(req, 'api');
    if (!req.query.chain || !req.query.address) {
      const recent = await listRecent();
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
      res.status(200).json({ ok: true, recent });
      return;
    }
    const report = await checkToken(req.query.chain, req.query.address);
    res.setHeader('Cache-Control', report.ok ? 'public, s-maxage=300, stale-while-revalidate=600' : 'no-store');
    res.status(report.status || (report.ok ? 200 : 502)).json(report);
    return;
  }

  if (mode === 'og') {
    const kind = String(req.query.kind || 'scan');
    if (kind === 'ape') {
      const report = await checkToken(req.query.chain, req.query.address);
      const logo = report.ok ? await loadRasterLogo(report.logo) : '';
      const png = renderApeCard(report.ok ? report : {
        letter: '?',
        symbol: '???',
        name: report.error || 'Unavailable',
        verdicts: [report.error || 'Check unavailable'],
        checks: [],
      }, logo);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', report.ok ? 'public, s-maxage=21600, stale-while-revalidate=600' : 'no-store');
      res.status(200).send(png);
      return;
    }
    if (kind === 'smart-money') {
      let feed = { buys: [] };
      try { feed = await loadSmartMoney({ fill: 0, refresh: false }); }
      catch (err) { feed = { buys: [] }; }
      const png = renderSmartMoneyCard(feed);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      res.status(200).send(png);
      return;
    }
    if (kind === 'movers') {
      const data = await loadMovers();
      const png = renderMoversCard(data.ok ? data : { ok: false, gainers: [], losers: [] });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', data.ok ? 'public, s-maxage=120, stale-while-revalidate=300' : 'no-store');
      res.status(data.ok ? 200 : (data.status || 502)).send(png);
      return;
    }
    if (kind === 'coin') {
      const loaded = await loadCoin(req.query.id);
      const png = renderCoinCard(loaded.ok ? loaded.coin : { symbol: '???', name: loaded.error || 'Unavailable', id: '' });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', loaded.ok ? 'public, s-maxage=120, stale-while-revalidate=300' : 'no-store');
      res.status(loaded.ok ? 200 : (loaded.status || 502)).send(png);
      return;
    }
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
    return;
  }

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
