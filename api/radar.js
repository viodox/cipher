'use strict';

const { getRadar } = require('../lib/radar');

module.exports = async function handler(req, res) {
  const radar = await getRadar();
  res.setHeader('Cache-Control', radar.ok ? 'public, s-maxage=120, stale-while-revalidate=300' : 'no-store');
  res.status(radar.ok ? 200 : 502).json(radar);
};
