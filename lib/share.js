'use strict';

const SITE = 'https://www.ciphersignal.xyz';
const X_HANDLE = '@ciphersignal_';

function postHref(text) {
  return 'https://x.com/intent/post?text=' + encodeURIComponent(String(text || ''));
}

function creditShare(text, url) {
  let body = String(text || '').replace(/\s+$/g, '');
  const page = String(url || '').trim();
  if (!body.includes(X_HANDLE)) body += (body ? '\n\n' : '') + 'via ' + X_HANDLE;
  if (page && !body.includes(page)) body += '\n' + page;
  return body;
}

function gradePostText(report) {
  const symbol = String((report && report.symbol) || 'TOKEN').replace(/^\$/, '').slice(0, 16);
  const letter = String((report && report.letter) || '?').slice(0, 3);
  const chain = report && report.chain ? String(report.chain) : '';
  const address = report && report.address ? String(report.address) : '';
  const url = SITE + '/check/' + chain + '/' + address;
  return creditShare('$' + symbol + ' · Ape Check ' + letter + '\nPublic checks only. Not a call.', url);
}

function comparePostText(rows, line, url) {
  const bits = (rows || [])
    .filter((row) => row && row.ok && row.symbol && row.letter)
    .map((row) => '$' + String(row.symbol).replace(/^\$/, '') + ' ' + row.letter);
  const head = bits.length ? bits.join(' vs ') : 'Ape Check compare';
  const note = String(line || 'Public checks only. Not a call.').replace(/\s+/g, ' ').trim();
  return creditShare(head + '\n' + note, url);
}

module.exports = { SITE, X_HANDLE, postHref, creditShare, gradePostText, comparePostText };
