'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { gradeFacts, isBuyGrade, isSkipGrade } = require('../lib/grade');

const clean = {
  honeypot: false,
  mintable: false,
  ownerRenounced: true,
  buyTax: 0,
  sellTax: 0,
  liquidityUsd: 5e6,
  lpLockedOrBurned: true,
  top10Pct: 20,
  ageHours: 400,
  change24h: -2,
};

test('a honeypot is an automatic F', () => {
  const grade = gradeFacts(Object.assign({}, clean, { honeypot: true }), 'eth|0xabc');
  assert.equal(grade.letter, 'F');
  assert.equal(grade.autoF, true);
  assert.equal(grade.score, 0);
  assert.ok(grade.verdicts[0].toLowerCase().indexOf('scam') === -1);
});

test('a clean blue chip stays at A+', () => {
  const grade = gradeFacts(clean, 'eth|pepe');
  assert.equal(grade.letter, 'A+');
  assert.equal(grade.score, 100);
  assert.equal(isBuyGrade(grade.letter), true);
});

test('missing fields stay unknown and are not deducted', () => {
  const grade = gradeFacts({
    honeypot: false,
    mintable: null,
    ownerRenounced: null,
    buyTax: null,
    sellTax: null,
    liquidityUsd: null,
    lpLockedOrBurned: null,
    top10Pct: null,
    ageHours: null,
    change24h: null,
  }, 'seed');
  assert.equal(grade.score, 100);
  assert.equal(grade.letter, 'A+');
  const unknown = grade.checks.filter((row) => row.status === 'unknown');
  assert.equal(unknown.length, 8);
  unknown.forEach((row) => assert.ok(row.detail));
});

test('tax, thin liquidity, and a dump move the letter', () => {
  const grade = gradeFacts(Object.assign({}, clean, {
    buyTax: 12,
    liquidityUsd: 1000,
    change24h: -60,
  }), 'seed-2');
  assert.equal(grade.score, 50);
  assert.equal(grade.letter, 'F');
  assert.equal(isSkipGrade(grade.letter), true);
  assert.equal(grade.verdicts.length, 3);
});

test('the same seed always picks the same verdict line', () => {
  const a = gradeFacts(Object.assign({}, clean, { mintable: true }), 'same');
  const b = gradeFacts(Object.assign({}, clean, { mintable: true }), 'same');
  assert.equal(a.verdicts[0], b.verdicts[0]);
});
