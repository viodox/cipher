'use strict';

const { loadMovers } = require('../lib/movers');

module.exports = async function handler(req, res) {
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
};
