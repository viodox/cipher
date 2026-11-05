'use strict';

const { esc } = require('./http-util');
const { normalizeChain, canonicalAddress, validAddress, CHAIN_LIST } = require('./chains');
const { checkToken } = require('./ape');
const { isBuyGrade, isSkipGrade } = require('./grade');
const { shell, buyButtonsHtml, buySoftNoteHtml, SITE } = require('./chrome');
const { alertsReady } = require('./alerts-ready');
const { fmtMoney } = require('./format');
const { postHref, comparePostText } = require('./share');

function parseSlot(chainInput, addressInput) {
  let chainRaw = chainInput;
  let address = addressInput;
  const packed = String(chainInput || '').trim();
  if ((!address || !String(address).trim()) && packed) {
    const match = packed.match(/^(eth|bsc|base|sol|arb|ethereum|solana|binance|bnb)\s*[:/\s]\s*(\S+)$/i);
    if (match) {
      chainRaw = match[1];
      address = match[2];
    }
  }
  const chain = normalizeChain(chainRaw);
  if (!chain) return null;
  const canonical = canonicalAddress(chain, String(address || '').trim());
  if (!validAddress(chain, canonical)) return null;
  return { chain: chain.slug, chainName: chain.name, address: canonical };
}

function slotsFromQuery(query) {
  const q = query || {};
  const packed = ['a', 'b', 'c'].map((key) => parseSlot(q[key], ''));
  const formed = [1, 2, 3].map((index) => parseSlot(q['chain' + index] || q['c' + index], q['addr' + index] || q['address' + index]));
  const slots = [];
  packed.concat(formed).forEach((slot) => {
    if (!slot) return;
    const id = slot.chain + ':' + slot.address;
    if (slots.some((item) => item.chain + ':' + item.address === id)) return;
    slots.push(slot);
  });
  return slots.slice(0, 3);
}

function bullet(report) {
  const lines = [];
  (report.checks || []).forEach((row) => {
    if (lines.length >= 4) return;
    if (row.status === 'fail' || row.status === 'pass') lines.push(row.label + ': ' + row.detail);
  });
  if (!lines.length && report.verdicts && report.verdicts[0]) lines.push(report.verdicts[0]);
  if (report.liquidityUsd != null) lines.push('Liquidity ' + fmtMoney(report.liquidityUsd));
  return lines.slice(0, 4);
}

function judge(reports) {
  const ranked = (reports || []).filter((row) => row && row.ok && Number.isFinite(Number(row.score)));
  ranked.sort((a, b) => Number(b.score) - Number(a.score));
  if (ranked.length < 2) {
    return {
      tone: 'incomplete',
      leader: null,
      line: 'Need two grades before this page can point at a higher receipt.',
    };
  }
  const top = ranked[0];
  const next = ranked[1];
  const gap = Number(top.score) - Number(next.score);
  if (gap < 3) {
    return {
      tone: 'close',
      leader: null,
      line: 'Close on the automated score (' + top.letter + ' vs ' + next.letter + '). The letters are public checks, not a pick.',
    };
  }
  return {
    tone: 'lead',
    leader: top,
    line: '$' + top.symbol + ' has the higher automated grade (' + top.letter + ' vs ' + next.letter + '). That is the receipt, not a recommendation.',
  };
}

function chainOptions(selected) {
  return CHAIN_LIST.filter((chain) => chain.slug !== 'arb').map((chain) => (
    '<option value="' + esc(chain.slug) + '"' + (chain.slug === selected ? ' selected' : '') + '>' + esc(chain.name) + '</option>'
  )).join('');
}

function formHtml(slots) {
  const fields = [0, 1, 2].map((index) => {
    const slot = slots[index] || { chain: index === 1 ? 'sol' : 'eth', address: '' };
    const label = index === 2 ? 'Third contract, optional' : (index === 0 ? 'First contract' : 'Second contract');
    return '<label class="cmp-field">' + esc(label) +
      '<span><select name="chain' + (index + 1) + '" aria-label="' + esc(label) + ' chain">' + chainOptions(slot.chain) + '</select>' +
      '<input name="addr' + (index + 1) + '" value="' + esc(slot.address || '') + '" placeholder="paste a contract" autocomplete="off" spellcheck="false"></span></label>';
  }).join('');
  return '<form class="cmp-form" action="/compare" method="get">' + fields + '<button type="submit">compare grades</button></form>';
}

function columnHtml(slot) {
  if (!slot) return '';
  if (!slot.report || !slot.report.ok) {
    return '<article class="cmp-col"><h2>' + esc(slot.chainName || slot.chain) + '</h2><p class="hint">' + esc((slot.report && slot.report.error) || 'This contract could not be graded.') + '</p></article>';
  }
  const report = slot.report;
  const lines = bullet(report).map((line) => '<li>' + esc(line) + '</li>').join('');
  return '<article class="cmp-col"><p class="hint">' + esc(report.chainName || slot.chain) + '</p>' +
    '<div class="cmp-letter grade-' + esc(String(report.letter || 'F').charAt(0).toLowerCase()) + '">' + esc(report.letter) + '</div>' +
    '<h2>$' + esc(report.symbol) + '</h2><p>' + esc(report.name || '') + '</p>' +
    '<p class="hint">score ' + esc(String(report.score)) + '/100</p>' +
    '<ul>' + lines + '</ul>' +
    '<p><a href="/check/' + esc(report.chain) + '/' + esc(report.address) + '">full receipt</a></p></article>';
}

async function renderComparePage(query, deps) {
  const grade = (deps && deps.grade) || checkToken;
  const slots = slotsFromQuery(query);
  const reports = await Promise.all(slots.map(async (slot) => {
    try {
      const report = await grade(slot.chain, slot.address);
      return Object.assign({}, slot, { report });
    } catch (err) {
      return Object.assign({}, slot, { report: { ok: false, error: 'Grade unavailable.' } });
    }
  }));
  const okReports = reports.map((slot) => slot.report).filter((row) => row && row.ok);
  const verdict = slots.length ? judge(okReports) : { tone: 'empty', leader: null, line: 'Paste two contracts. The higher letter is only the higher automated receipt.' };
  const params = new URLSearchParams();
  reports.forEach((slot, index) => params.set(index === 0 ? 'a' : index === 1 ? 'b' : 'c', slot.chain + ':' + slot.address));
  const path = reports.length ? '/compare?' + params.toString() : '/compare';
  const shareUrl = SITE + path;
  const shareText = comparePostText(okReports, verdict.line, shareUrl);
  let cta = '';
  if (verdict.leader && isBuyGrade(verdict.leader.letter)) {
    cta = buyButtonsHtml({ heading: 'Higher grade on the receipt. Buy on…', note: 'A higher letter is not a reason to buy.' });
  } else if (verdict.leader && isSkipGrade(verdict.leader.letter)) {
    cta = buySoftNoteHtml('The higher letter is still a weak receipt. No buy button on that column.');
  } else if (okReports.length) {
    cta = buyButtonsHtml({ heading: 'Compare finished. Buy on…', note: 'Venues are referral links, not a winner.' });
  }
  const css = `<style>
.cmp-form{display:grid;gap:8px;margin:0 0 1rem}
.cmp-field{display:grid;gap:4px;color:var(--muted);font-size:13px;letter-spacing:.08em;text-transform:uppercase}
.cmp-field span{display:flex;gap:8px;flex-wrap:wrap}
.cmp-field select,.cmp-field input{background:var(--bg);border:1px solid var(--border2);color:var(--ink);font-family:'Share Tech Mono',monospace;font-size:16px;padding:10px 12px;border-radius:4px}
.cmp-field input{flex:1;min-width:220px}
.cmp-form button{justify-self:start;font-family:Orbitron,monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;background:var(--accent);color:var(--on-accent);border:none;border-radius:4px;padding:10px 16px;cursor:pointer;font-weight:700}
.cmp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.cmp-col{background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:12px}
.cmp-letter{font-family:Orbitron,monospace;font-weight:900;font-size:72px;line-height:.9}
.cmp-col ul{margin:.6rem 0 0 1.1rem;color:var(--secondary);line-height:1.55}
.cmp-call{border-left:3px solid var(--accent);padding:8px 12px;margin:0 0 1rem;color:var(--ink);font-size:16.5px;line-height:1.6}
</style>`;
  const body = [
    formHtml(reports.length ? reports : []),
    reports.length ? '<p class="cmp-call">' + esc(verdict.line) + '</p>' : '',
    reports.length ? '<div class="cmp-grid">' + reports.map(columnHtml).join('') + '</div>' : '',
    cta,
    reports.length ? '<p class="hint">Share this compare: <a href="' + esc(path) + '">' + esc(shareUrl) + '</a></p>' : '',
  ].join('');
  const html = shell({
    title: 'Compare Ape Checks — CipherSignal',
    heading: 'compare',
    description: 'Put two or three contracts side by side. The higher letter is the higher automated Ape Check receipt, not a recommendation.',
    path: '/compare',
    active: 'check',
    alertsReady: alertsReady(),
    shareText: reports.length ? shareText : '',
    shareLabel: 'Post this compare on X',
    shareIntent: 'post',
    lede: 'Same public checks, two contracts, one screen. The page says which receipt scored higher. It does not tell you what to do with that.',
    extraHead: css,
    body,
  });
  return {
    status: 200,
    html,
    cacheControl: reports.length ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' : 'public, max-age=60, s-maxage=120',
    verdict,
    path,
  };
}

module.exports = { parseSlot, slotsFromQuery, judge, bullet, renderComparePage, comparePostText, postHref };
