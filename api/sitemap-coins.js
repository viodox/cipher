'use strict';

const { loadMovers, coinSitemapXml } = require('../lib/movers');

module.exports = async function handler(req, res) {
  const data = await loadMovers();
  const xml = coinSitemapXml(data);
  if (!xml) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    return;
  }
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).send(xml);
};
