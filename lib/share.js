'use strict';

const SITE = 'https://www.ciphersignal.xyz';

function postHref(text) {
  return 'https://x.com/intent/post?text=' + encodeURIComponent(String(text || ''));
}

function gradePostText(report) {
  const symbol = String((report && report.symbol) || 'TOKEN').replace(/^\$/, '').slice(0, 16);
  const letter = String((report && report.letter) || '?').slice(0, 3);
  const chain = report && report.chain ? String(report.chain) : '';
  const address = report && report.address ? String(report.address) : '';
  const url = SITE + '/check/' + chain + '/' + address;
  return '$' + symbol + ' · Ape Check ' + letter + '\nPublic checks only. Not a call.\n' + url;
}

function comparePostText(rows, line, url) {
  const bits = (rows || [])
    .filter((row) => row && row.ok && row.symbol && row.letter)
    .map((row) => '$' + String(row.symbol).replace(/^\$/, '') + ' ' + row.letter);
  const head = bits.length ? bits.join(' vs ') : 'Ape Check compare';
  const note = String(line || 'Public checks only. Not a call.').replace(/\s+/g, ' ').trim();
  return head + '\n' + note + '\n' + url;
}

module.exports = { SITE, postHref, gradePostText, comparePostText };
