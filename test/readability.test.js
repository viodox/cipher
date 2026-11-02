'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

function lin(channel) {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function contrast(hex, bg) {
  function lum(value) {
    const n = parseInt(value.slice(1), 16);
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  }
  const hi = Math.max(lum(hex), lum(bg));
  const lo = Math.min(lum(hex), lum(bg));
  return (hi + 0.05) / (lo + 0.05);
}

test('body, secondary, and muted text clear WCAG AA on the dark surfaces', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const chrome = fs.readFileSync(path.join(__dirname, '..', 'lib', 'chrome.js'), 'utf8');
  assert.match(index, /font-size:16\.5px;line-height:1\.6/);
  assert.match(chrome, /font-size:16\.5px;line-height:1\.6/);
  assert.match(index, /font-variant-numeric:tabular-nums/);
  assert.match(chrome, /font-variant-numeric:tabular-nums/);
  assert.equal(index.includes('#6a7a9a'), false);
  assert.equal(chrome.includes('#6a7a9a'), false);
  const colors = ['#e4eef8', '#e8eef8', '#c9d4e6', '#a8b8d4'];
  const surfaces = ['#060810', '#0b0e1a', '#111625'];
  colors.forEach((color) => {
    surfaces.forEach((surface) => {
      assert.ok(contrast(color, surface) >= 4.5, color + ' on ' + surface);
    });
  });
});
