'use strict';

const { esc } = require('./http-util');
const { CHAIN_LIST } = require('./chains');
const { shell, buyButtonsHtml, buySoftNoteHtml, SITE } = require('./chrome');
const { alertsReady } = require('./alerts-ready');
const { isBuyGrade, isSkipGrade, letterColor } = require('./grade');
const { checkToken, listRecent, loadBoard } = require('./ape');
const { loadCoin } = require('./coin');
const { fmtPrice, tweetHref } = require('./format');

const FOOTER = 'Contract safety grade, not price prediction. Not financial advice. Public on-chain data.';

function pageCss() {
  return `<style>
.ape-form{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 1rem}
.ape-form select,.ape-form input{background:#060810;border:1px solid #243050;color:#e8eef8;font-family:'Share Tech Mono',monospace;font-size:16.5px;padding:10px 12px;border-radius:4px}
.ape-form input{flex:1;min-width:220px}
.ape-form button{font-family:Orbitron,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;background:#00e5ff;color:#041018;border:none;border-radius:4px;padding:10px 16px;cursor:pointer;font-weight:700}
.grade-hero{display:flex;align-items:center;gap:18px;margin:0 0 1rem}
.grade-letter{font-family:Orbitron,monospace;font-weight:900;font-size:108px;line-height:.85;letter-spacing:-.04em}
.grade-sym{font-family:Orbitron,monospace;font-size:28px;color:#e8eef8;letter-spacing:.06em}
.grade-meta{color:#c9d4e6;font-size:16px;margin-top:6px;line-height:1.6}
.grade-logo{width:64px;height:64px;border-radius:50%;border:1px solid #243050;background:#060810}
.receipt{list-style:none;display:grid;gap:6px;margin:0}
.receipt li{display:grid;grid-template-columns:minmax(140px,190px) 84px 1fr;gap:8px;align-items:baseline;background:#060810;border:1px solid #1a2035;border-radius:6px;padding:8px 10px;font-size:16px;line-height:1.6}
.receipt b{font-weight:400;letter-spacing:.08em;text-transform:uppercase;font-size:11px}
.receipt .pass b{color:#00ff99}.receipt .fail b{color:#ff3355}.receipt .unknown b{color:#ffb400}
.receipt em{font-style:normal;color:#c9d4e6}
.verdict{border-left:3px solid #00e5ff;padding:8px 12px;margin:0 0 8px;color:#e8eef8;font-size:16.5px;line-height:1.6}
.board a.row{display:grid;grid-template-columns:72px 1fr auto;gap:10px;align-items:center;text-decoration:none;color:inherit;padding:10px 4px;border-bottom:1px solid #1a2035}
.board a.row:hover{color:#00e5ff}
.board .letter{font-family:Orbitron,monospace;font-size:22px;font-weight:700}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 1rem}
.chips a{font-family:Orbitron,monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;border:1px solid #243050;color:#c9d4e6;padding:7px 10px;border-radius:4px}
.chips a:hover{color:#00e5ff;border-color:rgba(0,229,255,.4)}
.ape-foot{margin-top:1rem;font-size:12px;color:#6a7a9a;line-height:1.6}
@media(max-width:700px){.grade-letter{font-size:76px}.receipt li{grid-template-columns:1fr;gap:2px}}
</style>`;
}

function chainOptions(selected) {
  return CHAIN_LIST.map((chain) => (
    '<option value="' + esc(chain.slug) + '"' + (chain.slug === selected ? ' selected' : '') + '>' + esc(chain.name) + '</option>'
  )).join('');
}

function viewPingScript() {
  return '<script>(function(){try{fetch(\'/api/ape-view\',{method:\'POST\',headers:{\'x-cipher-view\':\'1\'},keepalive:true,credentials:\'same-origin\'});}catch(e){}})();</script>';
}

function formHtml(prefill) {
  const chain = prefill && prefill.chain ? prefill.chain : 'eth';
  const address = prefill && prefill.address ? prefill.address : '';
  return `<form class="ape-form" id="ape-form" action="/check" method="get">
    <select name="chain" aria-label="chain">${chainOptions(chain)}</select>
    <input name="address" aria-label="contract address" placeholder="paste a contract address" value="${esc(address)}" autocomplete="off" spellcheck="false">
    <button type="submit">grade it</button>
  </form>
  <script>
  document.getElementById('ape-form').addEventListener('submit', function(ev){
    ev.preventDefault();
    var chain=this.chain.value;
    var address=String(this.address.value||'').trim();
    if(!address){ this.address.focus(); return; }
    location.href='/check/'+encodeURIComponent(chain)+'/'+encodeURIComponent(address);
  });
  </script>`;
}

function recentHtml(rows) {
  if (!rows.length) {
    return '<p class="hint">No grades yet today. Paste a contract and this strip fills in.</p>';
  }
  return '<div class="board">' + rows.map((row) => {
    const href = '/check/' + row.chain + '/' + row.address;
    const color = letterColor(row.letter);
    return '<a class="row" href="' + esc(href) + '"><span class="letter" style="color:' + color + '">' + esc(row.letter) + '</span><span><b>' + esc(row.symbol || 'TOKEN') + '</b><span class="sub" style="display:block;color:#6a7a9a">' + esc(row.name || row.chain) + '</span></span><span style="color:#6a7a9a">' + esc(row.chain) + '</span></a>';
  }).join('') + '</div>';
}

function receiptHtml(checks) {
  return '<ul class="receipt">' + checks.map((row) => (
    '<li class="' + esc(row.status) + '"><span>' + esc(row.label) + '</span><b>' + esc(row.status) + '</b><em>' + esc(row.detail) + '</em></li>'
  )).join('') + '</ul>';
}

function gradeCta(report) {
  if (isSkipGrade(report.letter)) {
    return buySoftNoteHtml('Low grade. This receipt is a reason to pause, not a buy button. The letter is contract data, not a shopping prompt.');
  }
  const buy = isBuyGrade(report.letter);
  const matched = report.exchanges && report.exchanges.length ? report.exchanges : null;
  return buyButtonsHtml({
    heading: buy ? 'Looks good? Buy on…' : 'Grade is mixed. Buy on…',
    names: buy ? matched : null,
    note: buy && !matched
      ? 'No matching referral desk in the CoinGecko ticker feed, so these are the signup links. A grade is not a reason to buy.'
      : 'A grade is not a reason to buy.',
  });
}

function gradeTitle(report) {
  const letter = report.letter || 'F';
  const article = /^[AF]/.test(letter) ? 'an' : 'a';
  return '$' + report.symbol + ' gets ' + article + ' ' + letter + ' on CipherSignal Ape Check';
}

function renderGrade(report) {
  const path = '/check/' + report.chain + '/' + report.address;
  const title = gradeTitle(report);
  const verdict = (report.verdicts && report.verdicts[0]) || 'Public contract data only.';
  const description = verdict + ' ' + FOOTER;
  const shareText = title + '\n\nvia @ciphersignal_\n' + SITE + path;
  const logo = report.logo
    ? '<img class="grade-logo" src="' + esc(report.logo) + '" alt="">'
    : '';
  const price = report.priceUsd != null ? ' · ' + fmtPrice(report.priceUsd) : '';
  const body = [
    '<p class="hint"><a href="/check">ape check</a> / ' + esc(report.chain) + '</p>',
    '<article class="card">',
    '<div class="grade-hero">' + logo + '<div class="grade-letter" style="color:' + letterColor(report.letter) + '">' + esc(report.letter) + '</div>',
    '<div><div class="grade-sym">$' + esc(report.symbol) + '</div>',
    '<div class="grade-meta">' + esc(report.name) + '<br>' + esc(report.chainName) + ' · score ' + esc(String(report.score)) + '/100' + esc(price) + '</div></div></div>',
    gradeCta(report),
    report.verdicts.map((line) => '<p class="verdict">' + esc(line) + '</p>').join(''),
    '<h2>receipt</h2>',
    receiptHtml(report.checks || []),
    '<p class="ape-foot">' + esc(FOOTER) + '</p>',
    '</article>',
  ].join('');
  const html = shell({
    title,
    heading: '$' + report.symbol + ' · ' + report.letter,
    description,
    path,
    image: SITE + '/og/check/' + report.chain + '/' + report.address + '.png',
    active: 'check',
    alertsReady: alertsReady(),
    shareText,
    extraActions: '<button type="button" class="btn" id="copy-link">copy link</button>',
    lede: esc(report.chainName) + ' contract ' + esc(report.address),
    extraHead: pageCss() + '<meta name="twitter:image:alt" content="' + esc(title) + '">',
    body: body + `<script>
document.getElementById('copy-link').addEventListener('click', function(){
  var btn=this;
  var done=function(){ btn.textContent='copied'; setTimeout(function(){ btn.textContent='copy link'; }, 1400); };
  if(navigator.clipboard) navigator.clipboard.writeText(location.href).then(done).catch(done);
  else done();
});
</script>` + viewPingScript(),
  });
  return {
    status: 200,
    html,
    cacheControl: 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  };
}

function renderMessage(status, message, prefill) {
  const html = shell({
    title: status === 429 ? 'Ape Check is busy — CIPHER' : 'Ape Check — CIPHER',
    heading: 'ape check',
    description: 'Paste a token contract for an A+ to F safety grade from public on-chain data.',
    path: '/check',
    active: 'check',
    alertsReady: alertsReady(),
    lede: 'Paste any token contract. The grade is a receipt of public data, from A+ down to F.',
    extraHead: pageCss(),
    body: '<p class="err">// ' + esc(message) + '</p>' + formHtml(prefill) + '<p class="ape-foot">' + esc(FOOTER) + '</p>' + viewPingScript(),
  });
  return { status, html, cacheControl: 'no-store' };
}

async function renderHome(query) {
  const coinId = String((query && query.coin) || '').trim().toLowerCase();
  if (coinId) {
    const loaded = await loadCoin(coinId);
    if (loaded.ok && loaded.coin.scans.length === 1) {
      const scan = loaded.coin.scans[0];
      return { redirect: '/check/' + scan.chain + '/' + scan.address };
    }
    if (loaded.ok && loaded.coin.scans.length > 1) {
      const links = loaded.coin.scans.map((scan) => (
        '<a class="btn" href="/check/' + esc(scan.chain) + '/' + esc(scan.address) + '">grade on ' + esc(scan.chainName) + '</a>'
      )).join('');
      const html = shell({
        title: loaded.coin.symbol + ' — Ape Check — CIPHER',
        heading: 'grade $' + loaded.coin.symbol,
        description: 'Pick the chain for this Ape Check.',
        path: '/check',
        active: 'check',
        alertsReady: alertsReady(),
        lede: esc(loaded.coin.name) + ' has more than one contract on file. Pick the chain.',
        extraHead: pageCss(),
        body: '<div class="actions">' + links + '</div>' + formHtml() + '<p class="ape-foot">' + esc(FOOTER) + '</p>',
      });
      return { status: 200, html, cacheControl: 'public, max-age=60, s-maxage=120' };
    }
  }
  const recent = await listRecent();
  const note = coinId && !recent ? '' : '';
  const missing = coinId
    ? '<p class="err">// no Ethereum, BSC, Base, Arbitrum, or Solana contract on that coin yet</p>'
    : '';
  const html = shell({
    title: 'Ape Check — CIPHER',
    heading: 'ape check',
    description: 'Paste a token contract. CipherSignal grades public safety data from A+ to F, with a shareable receipt.',
    path: '/check',
    active: 'check',
    alertsReady: alertsReady(),
    lede: 'Paste a contract on Ethereum, BSC, Base, Arbitrum, or Solana. The letter is a receipt of public data. It is not a price call.',
    extraHead: pageCss(),
    body: [
      missing,
      formHtml(),
      '<div class="chips"><a href="/hall">hall of grades</a><a href="/shame">hall of shame</a></div>',
      '<section class="card"><h2>recent grades</h2>',
      recentHtml(recent),
      '</section>',
      '<p class="ape-foot">' + esc(FOOTER) + '</p>',
    ].join(''),
  });
  return { status: 200, html, cacheControl: 'public, max-age=0, s-maxage=60' };
}

async function renderPermalink(chain, address) {
  const report = await checkToken(chain, address);
  if (!report.ok && report.status === 400) return renderMessage(400, report.error || 'That contract is not valid.', { chain, address });
  if (!report.ok && report.busy) return renderMessage(429, 'busy try again', { chain, address });
  if (!report.ok) return renderMessage(report.status || 502, report.error || 'scanners are unavailable — try again in a minute', { chain, address });
  return renderGrade(report);
}

function boardHtml(rows) {
  if (!rows.length) return '<p class="hint">Nothing on the board yet. Grades from today and yesterday show up after the first check.</p>';
  return '<div class="board">' + rows.map((row) => {
    const href = '/check/' + row.chain + '/' + row.address;
    return '<a class="row" href="' + esc(href) + '"><span class="letter" style="color:' + letterColor(row.letter) + '">' + esc(row.letter || '—') + '</span><span><b>$' + esc(row.symbol || '???') + '</b><span class="sub" style="display:block;color:#6a7ab8">' + esc(row.name || '') + ' · ' + esc(row.chain) + '</span></span><span style="color:#6a7a9a">' + esc(String(row.score)) + '</span></a>';
  }).join('') + '</div>';
}

async function renderBoard(kind) {
  const shame = kind === 'shame';
  const all = await loadBoard();
  const rows = all
    .slice()
    .sort((a, b) => shame ? a.score - b.score : b.score - a.score)
    .slice(0, 25);
  const path = shame ? '/shame' : '/hall';
  const title = shame ? 'Hall of Shame — Ape Check — CIPHER' : 'Hall of Grades — Ape Check — CIPHER';
  const heading = shame ? 'hall of shame' : 'hall of grades';
  const lede = shame
    ? 'The lowest Ape Check scores from today and yesterday. A low letter is contract data, not a price call.'
    : 'The highest Ape Check scores from today and yesterday. A high letter is a clean receipt, not a reason to buy.';
  const html = shell({
    title,
    heading,
    description: lede,
    path,
    active: 'check',
    alertsReady: alertsReady(),
    lede,
    extraHead: pageCss(),
    body: [
      '<div class="chips"><a href="/check">new check</a><a href="/hall">hall</a><a href="/shame">shame</a></div>',
      '<section class="card">',
      boardHtml(rows),
      '</section>',
      '<p class="ape-foot">' + esc(FOOTER) + '</p>',
    ].join(''),
  });
  return { status: 200, html, cacheControl: 'public, max-age=0, s-maxage=60' };
}

async function renderApeRoute(page, query) {
  if (page === 'hall' || page === 'shame') return renderBoard(page);
  if (page === 'ape') return renderPermalink(query && query.chain, query && query.address);
  return renderHome(query || {});
}

module.exports = { renderApeRoute, renderGrade, gradeTitle, FOOTER };
