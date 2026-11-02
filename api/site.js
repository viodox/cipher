'use strict';

const { renderAppRoute } = require('../lib/pages');
const { renderMoversPage, loadMovers, coinSitemapXml } = require('../lib/movers');
const { renderUpdatesPage, updatesPayload } = require('../lib/updates');
const { renderAlertsPage } = require('../lib/alerts');
const { renderCoinPage } = require('../lib/coin');
const { loadCanon } = require('../lib/canon');
const { renderApeRoute } = require('../lib/ape-page');

const APP_PAGES = new Set(['ai-decrypt', 'profile', 'cipherpot', 'on-chain-stocks', 'rug-radar']);

function sendHtml(res, status, html, cacheControl) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl || 'no-store');
  res.status(status || 200).send(html);
}

module.exports = async function handler(req, res) {
  const page = String((req.query && (req.query.page || req.query.route)) || '');

  if (page === 'updates-json') {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).json(updatesPayload());
    return;
  }

  if (page === 'movers-json') {
    const data = await loadMovers();
    const body = data.ok ? {
      ok: true,
      source: data.source,
      updatedAt: data.updatedAt,
      note: data.note,
      universe: data.universe,
      gainers: data.gainers,
      losers: data.losers,
      volumeSpikes: data.volumeSpikes,
    } : { ok: false, error: data.error || 'unavailable' };
    res.setHeader('Cache-Control', data.ok ? 'public, s-maxage=120, stale-while-revalidate=300' : 'no-store');
    res.status(data.ok ? 200 : (data.status || 502)).json(body);
    return;
  }

  if (page === 'canon') {
    const canon = await loadCanon();
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=21600, stale-while-revalidate=600');
    res.status(200).json({
      symbols: canon.symbols,
      names: canon.names,
      ids: Object.keys(canon.ids),
    });
    return;
  }

  if (page === 'sitemap') {
    const data = await loadMovers();
    const xml = coinSitemapXml(data);
    if (!xml) {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
      return;
    }
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).send(xml);
    return;
  }

  if (page === 'coin') {
    const result = await renderCoinPage(req.query.id);
    sendHtml(res, result.status, result.html, result.cacheControl);
    return;
  }

  if (page === 'check' || page === 'hall' || page === 'shame' || page === 'ape') {
    const result = await renderApeRoute(page, req.query || {});
    if (result.redirect) {
      res.setHeader('Location', result.redirect);
      res.status(302).end();
      return;
    }
    sendHtml(res, result.status, result.html, result.cacheControl);
    return;
  }

  if (page === 'movers' || page === 'updates' || page === 'alerts') {
    const result = page === 'movers'
      ? await renderMoversPage()
      : page === 'updates'
        ? renderUpdatesPage()
        : await renderAlertsPage();
    sendHtml(res, result.status, result.html, result.cacheControl);
    return;
  }

  if (APP_PAGES.has(page)) {
    const html = renderAppRoute(page);
    if (!html) {
      res.status(404).send('Not found');
      return;
    }
    sendHtml(res, 200, html, 'public, s-maxage=300, stale-while-revalidate=600');
    return;
  }

  res.status(404).send('Not found');
};
