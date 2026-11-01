'use strict';

const { loadCanon } = require('../lib/canon');

module.exports = async function handler(req, res) {
  const canon = await loadCanon();
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=21600, stale-while-revalidate=600');
  res.status(200).json({
    symbols: canon.symbols,
    names: canon.names,
    ids: Object.keys(canon.ids),
  });
};
