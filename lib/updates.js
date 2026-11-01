'use strict';

const { esc } = require('./http-util');
const { shell, SITE } = require('./chrome');
const updatesFile = require('../data/updates.json');

function listUpdates() {
  const rows = Array.isArray(updatesFile.updates) ? updatesFile.updates.slice() : [];
  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return rows.map((row) => ({
    id: String(row.id || ''),
    date: String(row.date || ''),
    title: String(row.title || ''),
    summary: String(row.summary || ''),
    href: String(row.href || '/'),
    url: SITE + String(row.href || '/'),
  }));
}

function updatesPayload() {
  const updates = listUpdates();
  return {
    ok: true,
    updated: updates[0] ? updates[0].date : null,
    latest: updates[0] || null,
    updates,
  };
}

function renderUpdatesPage() {
  const payload = updatesPayload();
  const items = payload.updates.map((row) => (
    '<a class="update" href="' + esc(row.href) + '">' +
      '<div class="update-date">' + esc(row.date) + '</div>' +
      '<div class="update-title">' + esc(row.title) + '</div>' +
      '<p>' + esc(row.summary) + '</p>' +
    '</a>'
  )).join('') || '<p class="hint">No entries yet.</p>';
  const latest = payload.latest;
  const shareText = latest
    ? latest.title + ' — CIPHER\n\n' + latest.summary + '\n\nvia @ciphersignal_\n' + SITE + '/updates'
    : 'What\'s new on CIPHER\n\nvia @ciphersignal_\n' + SITE + '/updates';
  const html = shell({
    title: "What's new — CIPHER",
    heading: "what's new",
    description: 'Changelog for CIPHER: Rug Radar, shareable scan links, Signal Score, Top Movers, coin pages, and price alert signup.',
    path: '/updates',
    image: SITE + '/og-image.png',
    active: 'updates',
    shareText,
    lede: 'Newest entries are this release. Earlier tools are listed so an automation can read the full set from <a href="/api/updates">/api/updates</a>. Dates are the changelog entry.',
    body: '<div class="card">' + items + '</div>',
  });
  return {
    status: 200,
    html,
    cacheControl: 'public, max-age=300, s-maxage=300',
  };
}

module.exports = { listUpdates, updatesPayload, renderUpdatesPage };
