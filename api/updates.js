'use strict';

const { updatesPayload } = require('../lib/updates');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).json(updatesPayload());
};
