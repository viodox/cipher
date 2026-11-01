'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { proxyCoinGecko } = require('./lib/coingecko');
const { scanToken } = require('./lib/security');
const { getRadar } = require('./lib/radar');
const { renderCard } = require('./lib/og');
const { APP_ROUTES, renderAppRoute, renderScanPage, renderScanError } = require('./lib/pages');

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
      'Cache-Control': result.ok ? 'public, max-age=60' : 'no-store',
    });
    return;
  }

  if (pathname === '/api/security') {
    const report = await scanToken(url.searchParams.get('chain'), url.searchParams.get('address'));
    sendJson(res, report.status || (report.ok ? 200 : 502), report, report.ok ? 'public, max-age=60' : 'no-store');
    return;
  }

  if (pathname === '/api/radar') {
    const radar = await getRadar();
    sendJson(res, radar.ok ? 200 : 502, radar, radar.ok ? 'public, max-age=120' : 'no-store');
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
    send(res, 200, fs.readFileSync(target), { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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
