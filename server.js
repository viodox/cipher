'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { proxyCoinGecko } = require('./lib/coingecko');
const { scanToken } = require('./lib/security');
const { getRadar } = require('./lib/radar');
const { renderCard, renderMoversCard, renderCoinCard, renderApeCard, renderSmartMoneyCard, renderFortuneCard } = require('./lib/og');
const { checkToken, listRecent, loadRasterLogo } = require('./lib/ape');
const { noteApeLookup } = require('./lib/ape-traffic');
const { renderApeRoute } = require('./lib/ape-page');
const { APP_ROUTES, renderAppRoute, renderScanPage, renderScanError } = require('./lib/pages');
const { loadMovers, renderMoversPage, coinSitemapXml } = require('./lib/movers');
const { loadCoin, renderCoinPage } = require('./lib/coin');
const { updatesPayload, renderUpdatesPage } = require('./lib/updates');
const { handleAlertHttp, handleRun, handleUnsubscribe, renderAlertsPage } = require('./lib/alerts');
const { loadCanon } = require('./lib/canon');
const { loadBootBounded, renderHomeHtml, publicBoot } = require('./lib/boot');
const { loadSmartMoney, renderSmartMoneyPage } = require('./lib/smart-money');
const { loadFortune, loadFortuneBounded, renderFortunePage, cookieReveals } = require('./lib/fortune');
const { loadGradedBoard } = require('./lib/board');
const { renderComparePage } = require('./lib/compare');
const { renderDigestPage, createDigestSignup, digestInputFromRequest, unsubscribeDigest } = require('./lib/digest');
const { emailConfigured, storageMode } = require('./lib/alerts-ready');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'X-Content-Type-Options': 'nosniff' }, headers || {}));
  res.end(body);
}

function sendJson(res, status, payload, cacheControl) {
  send(res, status, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl || 'no-store',
  });
}

function queryOf(url) {
  const params = {};
  url.searchParams.forEach((value, key) => { params[key] = value; });
  return params;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/coingecko' || pathname.startsWith('/api/coingecko/')) {
    const cgPath = pathname.replace(/^\/api\/coingecko\/?/, '');
    const result = await proxyCoinGecko(cgPath, queryOf(url));
    send(res, result.status, result.body, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': result.ok ? (result.cacheControl || 'public, max-age=60') : 'no-store',
    });
    return;
  }

  if (pathname === '/api/security') {
    const report = await scanToken(url.searchParams.get('chain'), url.searchParams.get('address'));
    sendJson(res, report.status || (report.ok ? 200 : 502), report, report.ok ? 'public, max-age=60' : 'no-store');
    return;
  }

  if (pathname === '/api/ape-view') {
    await noteApeLookup(req, 'view');
    send(res, 204, '', { 'Cache-Control': 'no-store' });
    return;
  }

  if (pathname === '/api/check' || pathname.startsWith('/api/check/')) {
    const parts = pathname.split('/');
    const chain = parts[3] || url.searchParams.get('chain');
    const address = parts[4] || url.searchParams.get('address');
    if (chain && address) await noteApeLookup(req, 'api');
    if (!chain || !address) {
      const recent = await listRecent();
      sendJson(res, 200, { ok: true, recent }, 'public, max-age=30');
      return;
    }
    const report = await checkToken(chain, address);
    sendJson(res, report.status || (report.ok ? 200 : 502), report, report.ok ? 'public, max-age=60' : 'no-store');
    return;
  }

  if (pathname === '/api/radar') {
    const radar = await getRadar();
    sendJson(res, radar.ok ? 200 : 502, radar, radar.ok ? 'public, max-age=120' : 'no-store');
    return;
  }

  if (pathname === '/api/movers') {
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
    sendJson(res, data.ok ? 200 : (data.status || 502), body, data.ok ? 'public, max-age=120' : 'no-store');
    return;
  }

  if (pathname === '/api/updates') {
    sendJson(res, 200, updatesPayload(), 'public, max-age=300');
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    const boot = await loadBootBounded();
    const html = renderHomeHtml(boot);
    const warm = boot && boot.coins && boot.coins.length;
    send(res, 200, html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': warm ? 'public, max-age=60, s-maxage=180, stale-while-revalidate=600' : 'public, max-age=0, s-maxage=30',
    });
    return;
  }

  if (pathname === '/api/boot') {
    const { loadBoot } = require('./lib/boot');
    const boot = publicBoot(await loadBoot({ refreshDex: true }));
    sendJson(res, 200, boot || { ok: false, coins: [], board: [] }, boot && boot.coins && boot.coins.length ? 'public, max-age=60' : 'no-store');
    return;
  }

  if (pathname === '/api/board') {
    const board = await loadGradedBoard();
    sendJson(res, 200, board, 'public, max-age=60');
    return;
  }

  if (pathname === '/api/smart-money') {
    const feed = await loadSmartMoney({ fill: 3 });
    sendJson(res, 200, feed, 'public, max-age=30');
    return;
  }

  if (pathname === '/smart-money') {
    const feed = await loadSmartMoney({ fill: 3 });
    const result = renderSmartMoneyPage(feed);
    send(res, result.status || 200, result.html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': result.cacheControl || 'no-store',
    });
    return;
  }

  if (pathname === '/cipher-fortune') {
    const model = await loadFortuneBounded({ grade: 1 });
    const result = renderFortunePage(model, { revealed: cookieReveals(req.headers && req.headers.cookie, model) });
    send(res, result.status || 200, result.html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': result.cacheControl || 'no-store',
    });
    return;
  }

  if (pathname === '/compare') {
    const result = await renderComparePage(queryOf(url));
    send(res, result.status || 200, result.html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': result.cacheControl || 'no-store',
    });
    return;
  }

  if (pathname === '/digest') {
    const result = renderDigestPage({ email: emailConfigured(), storage: storageMode() });
    send(res, 200, result.html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': result.cacheControl || 'no-store',
    });
    return;
  }

  if (pathname === '/api/digest') {
    const dry = url.searchParams.get('dry') === '1';
    const gate = await handleRun(Object.assign({}, req, { query: { action: 'digest', dry: dry ? '1' : '' } }), { digestOnly: true, dry });
    sendJson(res, gate.status || 500, gate.body, 'no-store');
    return;
  }

  if (pathname === '/api/alerts/run') {
    const result = await handleRun(req);
    sendJson(res, result.status || 500, result.body, 'no-store');
    return;
  }

  if (pathname === '/api/alerts/unsubscribe' && url.searchParams.get('list') === 'digest') {
    const token = url.searchParams.get('token');
    const confirm = url.searchParams.get('confirm') === '1' || String(req.method || '').toUpperCase() === 'POST';
    if (!confirm) {
      send(res, 200, '<!DOCTYPE html><html lang="en"><body style="background:#060810;color:#e4eef8;font-family:monospace;padding:2rem"><form method="post" action="/api/alerts/unsubscribe?list=digest&amp;confirm=1&amp;token=' + encodeURIComponent(token || '') + '"><button>unsubscribe</button></form></body></html>', {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return;
    }
    const result = await unsubscribeDigest(token);
    const message = result.ok ? 'You are off the daily digest.' : 'That unsubscribe link is not valid.';
    send(res, result.status || 200, '<!DOCTYPE html><html lang="en"><body style="background:#060810;color:#e4eef8;font-family:monospace;padding:2rem"><p>' + message + '</p></body></html>', {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return;
  }

  if (pathname === '/api/alerts/unsubscribe') {
    const result = await handleUnsubscribe(req, url.searchParams.get('token'), url.searchParams.get('confirm') === '1');
    send(res, result.status || 200, result.html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return;
  }

  if (pathname === '/api/alerts' && url.searchParams.get('action') === 'digest-signup') {
    const input = await digestInputFromRequest(req);
    const result = await createDigestSignup(input);
    sendJson(res, result.status || 500, result.body, 'no-store');
    return;
  }

  if (pathname === '/api/alerts' && url.searchParams.get('action') === 'digest') {
    const dry = url.searchParams.get('dry') === '1';
    const result = await handleRun(req, { digestOnly: true, dry });
    sendJson(res, result.status || 500, result.body, 'no-store');
    return;
  }

  if (pathname === '/api/alerts') {
    const result = await handleAlertHttp(req);
    sendJson(res, result.status || 500, result.body, 'no-store');
    return;
  }

  if (pathname === '/api/canon') {
    const canon = await loadCanon();
    sendJson(res, 200, { symbols: canon.symbols, names: canon.names, ids: Object.keys(canon.ids) }, 'public, max-age=300');
    return;
  }

  if (pathname === '/sitemap-coins.xml') {
    const data = await loadMovers();
    const xml = coinSitemapXml(data);
    if (!xml) {
      send(res, 503, '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return;
    }
    send(res, 200, xml, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    });
    return;
  }

  if (pathname === '/check' || pathname === '/hall' || pathname === '/shame') {
    const result = await renderApeRoute(pathname.slice(1), queryOf(url));
    if (result.redirect) {
      send(res, 302, '', { Location: result.redirect });
      return;
    }
    send(res, result.status || 200, result.html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': result.cacheControl || 'no-store',
    });
    return;
  }

  const apeMatch = pathname.match(/^\/check\/([a-zA-Z0-9]+)\/([^/]+)$/);
  if (apeMatch) {
    await noteApeLookup(req, 'page');
    const result = await renderApeRoute('ape', { chain: apeMatch[1], address: apeMatch[2] });
    send(res, result.status || 200, result.html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': result.cacheControl || 'no-store',
    });
    return;
  }

  if (pathname === '/movers' || pathname === '/updates' || pathname === '/alerts') {
    const result = pathname === '/movers'
      ? await renderMoversPage()
      : pathname === '/updates'
        ? renderUpdatesPage()
        : await renderAlertsPage();
    send(res, result.status || 200, result.html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': result.cacheControl || 'no-store',
    });
    return;
  }

  const coinMatch = pathname.match(/^\/coin\/([^/]+)$/);
  if (coinMatch) {
    const result = await renderCoinPage(coinMatch[1]);
    send(res, result.status || 200, result.html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': result.cacheControl || 'no-store',
    });
    return;
  }

  const scanMatch = pathname.match(/^\/scan\/([a-zA-Z0-9]+)\/([^/]+)$/);
  if (scanMatch || (pathname === '/api/scan' && url.searchParams.get('chain'))) {
    const chain = scanMatch ? scanMatch[1] : url.searchParams.get('chain');
    const address = scanMatch ? scanMatch[2] : url.searchParams.get('address');
    const report = await scanToken(chain, address);
    if (!report.ok && report.status === 400) {
      send(res, 400, renderScanError(report.error || 'bad scan'), { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }
    if (!report.ok) {
      send(res, 502, renderScanError('scanners are unavailable — try again in a minute'), { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }
    send(res, 200, renderScanPage(report), {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    });
    return;
  }

  if (pathname === '/og/smart-money.png' || (pathname === '/api/og' && url.searchParams.get('kind') === 'smart-money')) {
    let feed = { buys: [] };
    try { feed = await loadSmartMoney({ fill: 0, refresh: false }); } catch (err) { feed = { buys: [] }; }
    const png = renderSmartMoneyCard(feed);
    send(res, 200, png, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' });
    return;
  }

  if (pathname === '/og/cipher-fortune.png' || (pathname === '/api/og' && url.searchParams.get('kind') === 'fortune')) {
    let model = null;
    try { model = await loadFortune({ skipDetail: true, grade: 0 }); }
    catch (err) { model = null; }
    const png = renderFortuneCard(model);
    send(res, 200, png, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' });
    return;
  }

  if (pathname === '/og/movers.png' || (pathname === '/api/og' && url.searchParams.get('kind') === 'movers')) {
    const data = await loadMovers();
    const png = renderMoversCard(data.ok ? data : { ok: false, gainers: [], losers: [] });
    send(res, data.ok ? 200 : (data.status || 502), png, {
      'Content-Type': 'image/png',
      'Cache-Control': data.ok ? 'public, max-age=120' : 'no-store',
    });
    return;
  }

  const coinOgMatch = pathname.match(/^\/og\/coin\/([^/]+)\.png$/);
  if (coinOgMatch || (pathname === '/api/og' && url.searchParams.get('kind') === 'coin')) {
    const id = coinOgMatch ? coinOgMatch[1] : url.searchParams.get('id');
    const loaded = await loadCoin(id);
    const png = renderCoinCard(loaded.ok ? loaded.coin : { symbol: '???', name: loaded.error || 'Unavailable', id: '' });
    send(res, loaded.ok ? 200 : (loaded.status || 502), png, {
      'Content-Type': 'image/png',
      'Cache-Control': loaded.ok ? 'public, max-age=120' : 'no-store',
    });
    return;
  }

  const apeOgMatch = pathname.match(/^\/og\/check\/([a-zA-Z0-9]+)\/([^/]+)\.png$/);
  if (apeOgMatch || (pathname === '/api/og' && url.searchParams.get('kind') === 'ape')) {
    const chain = apeOgMatch ? apeOgMatch[1] : url.searchParams.get('chain');
    const address = apeOgMatch ? apeOgMatch[2] : url.searchParams.get('address');
    const report = await checkToken(chain, address);
    const logo = report.ok ? await loadRasterLogo(report.logo) : '';
    const png = renderApeCard(report.ok ? report : {
      letter: '?',
      symbol: '???',
      name: report.error || 'Unavailable',
      verdicts: [report.error || 'Check unavailable'],
      checks: [],
    }, logo);
    send(res, 200, png, {
      'Content-Type': 'image/png',
      'Cache-Control': report.ok ? 'public, max-age=300, s-maxage=21600' : 'no-store',
    });
    return;
  }

  const ogMatch = pathname.match(/^\/og\/scan\/([a-zA-Z0-9]+)\/([^/]+)\.png$/);
  if (ogMatch || pathname === '/api/og') {
    const chain = ogMatch ? ogMatch[1] : url.searchParams.get('chain');
    const address = ogMatch ? ogMatch[2] : url.searchParams.get('address');
    const report = await scanToken(chain, address);
    const png = renderCard(report.ok ? report : { stamp: 'CAUTION', symbol: '???', chainName: '', name: report.error || 'Scan unavailable', reasons: [report.error || 'Scan unavailable'] });
    send(res, report.ok ? 200 : (report.status || 502), png, {
      'Content-Type': 'image/png',
      'Cache-Control': report.ok ? 'public, max-age=60' : 'no-store',
    });
    return;
  }

  if (APP_ROUTES[pathname.replace(/^\//, '')]) {
    const html = renderAppRoute(pathname.replace(/^\//, ''));
    send(res, 200, html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    });
    return;
  }

  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) {
    send(res, 400, 'bad path');
    return;
  }
  let target = filePath;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    const ext = path.extname(target).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.html') headers['Cache-Control'] = 'no-cache';
    send(res, 200, fs.readFileSync(target), headers);
    return;
  }

  const missing = fs.readFileSync(path.join(ROOT, '404.html'));
  send(res, 404, missing, { 'Content-Type': 'text/html; charset=utf-8' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, 'server error');
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('CIPHER dev server http://127.0.0.1:' + PORT);
  });
}

module.exports = { server };
