'use strict';

const { proxyCoinGecko } = require('../lib/coingecko');

// Plain Vercel functions only match one `[segment]`. A file named
// `[...path].js` is not a catch-all here — production treats it as a single
// segment named "...path", so /ping hits this code with an empty path (400)
// and /search/trending is a platform 404. vercel.json rewrites
// /api/coingecko/:path+ onto this file and appends ?path=$1.
function requestPath(req) {
  const parts = req.query && req.query.path;
  if (Array.isArray(parts)) {
    const joined = parts
      .map((part) => String(part || '').replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/');
    if (joined) return joined;
  } else if (parts != null && String(parts) !== '') {
    return String(parts);
  }

  const pathname = String((req && req.url) || '').split('?')[0];
  const prefix = '/api/coingecko/';
  if (!pathname.startsWith(prefix)) return '';
  try {
    return decodeURIComponent(pathname.slice(prefix.length));
  } catch (err) {
    return '';
  }
}

module.exports = async function handler(req, res) {
  const params = Object.assign({}, req.query);
  delete params.path;
  const result = await proxyCoinGecko(requestPath(req), params);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', result.ok ? (result.cacheControl || 'public, max-age=60, s-maxage=60') : 'no-store');
  res.status(result.status).send(result.body);
};
