'use strict';

const { renderAppRoute } = require('../lib/pages');
const { renderMoversPage, loadMovers, coinSitemapXml } = require('../lib/movers');
const { renderUpdatesPage, updatesPayload } = require('../lib/updates');
const { renderAlertsPage } = require('../lib/alerts');
const { renderCoinPage } = require('../lib/coin');
const { loadCanon } = require('../lib/canon');
const { renderApeRoute } = require('../lib/ape-page');
const { noteApeLookup } = require('../lib/ape-traffic');
const { loadBootBounded, renderHomeHtml, publicBoot } = require('../lib/boot');
const { loadSmartMoney, renderSmartMoneyPage } = require('../lib/smart-money');
const { loadFortuneBounded, renderFortunePage, cookieReveals } = require('../lib/fortune');
const { loadGradedBoard } = require('../lib/board');
const { renderComparePage } = require('../lib/compare');
const { renderDigestPage } = require('../lib/digest');
const { emailConfigured, storageMode } = require('../lib/alerts-ready');

const APP_PAGES = new Set(['ai-decrypt', 'profile', 'cipherpot', 'on-chain-stocks', 'rug-radar']);

function sendHtml(res, status, html, cacheControl) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl || 'no-store');
  res.status(status || 200).send(html);
}

module.exports = async function handler(req, res) {
  const page = String((req.query && (req.query.page || req.query.route)) || '');

  if (page === 'home') {
    const boot = await loadBootBounded();
    const html = renderHomeHtml(boot);
    const warm = boot && boot.coins && boot.coins.length;
    sendHtml(res, 200, html, warm ? 'public, max-age=60, s-maxage=180, stale-while-revalidate=600' : 'public, max-age=0, s-maxage=30');
    return;
  }

  if (page === 'boot') {
    const { loadBoot } = require('../lib/boot');
    const boot = publicBoot(await loadBoot({ refreshDex: true }));
    res.setHeader('Cache-Control', boot && boot.coins && boot.coins.length ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' : 'no-store');
    res.status(200).json(boot || { ok: false, coins: [], board: [] });
    return;
  }

  if (page === 'board') {
    const board = await loadGradedBoard();
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.status(200).json(board);
    return;
  }

  if (page === 'smart-money-json') {
    const feed = await loadSmartMoney({ fill: 3 });
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
    res.status(200).json(feed);
    return;
  }

  if (page === 'smart-money') {
    const feed = await loadSmartMoney({ fill: 3 });
    const result = renderSmartMoneyPage(feed);
    sendHtml(res, result.status, result.html, result.cacheControl);
    return;
  }

  if (page === 'cipher-fortune') {
    const model = await loadFortuneBounded({ grade: 1 });
    const header = req.headers && (req.headers.cookie || req.headers.Cookie);
    const result = renderFortunePage(model, {
      revealed: cookieReveals(header, model),
      query: req.query || {},
    });
    sendHtml(res, result.status, result.html, result.cacheControl);
    return;
  }

  if (page === 'compare') {
    const result = await renderComparePage(req.query || {});
    sendHtml(res, result.status, result.html, result.cacheControl);
    return;
  }

  if (page === 'digest') {
    const result = renderDigestPage({ email: emailConfigured(), storage: storageMode() });
    sendHtml(res, result.status, result.html, result.cacheControl);
    return;
  }

  if (page === 'ape-view') {
    await noteApeLookup(req, 'view');
    res.setHeader('Cache-Control', 'no-store');
    res.status(204).end();
    return;
  }

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
      fresh: data.fresh || [],
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
    if (page === 'ape') await noteApeLookup(req, 'page');
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
