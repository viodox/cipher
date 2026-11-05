'use strict';

const { esc } = require('./http-util');
const { ANALYTICS_SNIPPET } = require('./web-analytics');
const { themeHead, themeControlHtml, themeClientScript } = require('./theme');

const SITE = 'https://www.ciphersignal.xyz';

const AFFILIATES = [
  {
    name: 'COINBASE',
    href: 'https://coinbase.com/join/QQYSCTU?src=referral-link',
    desc: 'Sign-up bonus for new accounts where the offer applies.',
  },
  {
    name: 'BINANCE.US',
    href: 'https://www.binance.us/universal_JHHGDSKDJ/auth/registration?ref=52095831',
    desc: 'US spot exchange. Availability depends on your state.',
  },
  {
    name: 'KRAKEN',
    href: 'https://invite.kraken.com/JDNW/bkxtyuas',
    desc: 'Exchange account via referral link.',
  },
  {
    name: 'CRYPTO.COM',
    href: 'https://crypto.com/app/8hxtmyan6d',
    desc: 'App signup via referral link.',
  },
  {
    name: 'ROBINHOOD',
    href: 'https://www.ciphersignal.xyz/robinhood',
    desc: 'US brokerage for stocks and crypto. Not the same product as Robinhood Chain stock tokens, which are not offered to US persons.',
  },
];

const NAV = [
  { href: '/', label: 'scanner', id: 'home' },
  { href: '/smart-money', label: 'smart money', id: 'smart', flagship: true },
  { href: '/cipher-fortune', label: 'cipher fortune', id: 'fortune', hook: 'spin a real coin' },
  { href: '/check', label: 'ape check', id: 'check', badge: true },
  { href: '/compare', label: 'compare', id: 'compare' },
  { href: '/movers', label: 'top movers', id: 'movers' },
  { href: '/alerts', label: 'price alerts', id: 'alerts' },
  { href: '/digest', label: 'digest', id: 'digest' },
  { href: '/updates', label: "what's new", id: 'updates', badge: true },
  { href: '/rug-radar', label: 'rug radar', id: 'radar' },
  { href: '/#where-to-buy', label: 'where to buy', id: 'buy' },
];

const EXCHANGE_LABEL = {
  COINBASE: 'Coinbase',
  'BINANCE.US': 'Binance.US',
  KRAKEN: 'Kraken',
  'CRYPTO.COM': 'Crypto.com',
  ROBINHOOD: 'Robinhood',
};

const REFERRAL_DISCLOSURE = 'Referral links: we may earn a commission';

function selectAffiliates(names) {
  if (!Array.isArray(names) || !names.length) return AFFILIATES.slice();
  const wanted = new Set(names.map((name) => String(name).toUpperCase()));
  const matched = AFFILIATES.filter((item) => wanted.has(item.name));
  return matched.length ? matched : AFFILIATES.slice();
}

function exchangeLabel(name) {
  return EXCHANGE_LABEL[name] || name;
}

// These stored URLs are signup links. Pair paths on the same hosts drop the ref code.
function affiliateHref(item) {
  return item.href;
}

function referralAttrs(item) {
  return ' data-referral="1" data-exchange="' + esc(item.name) + '"';
}

const BUY_CSS = `<style>
.buy-cta{margin:.85rem 0 1rem}
.buy-cta-label{font-family:Orbitron,monospace;font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#e4eef8;margin:0 0 .55rem}
.buy-cta-note{font-size:15px;line-height:1.6;color:#e4eef8;margin:0 0 .55rem}
.buy-cta-row{display:flex;flex-wrap:wrap;gap:8px}
.buy-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;max-width:100%;padding:10px 14px;border-radius:4px;background:var(--accent);color:var(--on-accent);font-family:Orbitron,monospace;font-size:14px;font-weight:700;letter-spacing:.02em;text-decoration:none;line-height:1.25;text-align:center;white-space:normal}
.buy-btn:hover{filter:brightness(1.08);color:var(--on-accent)}
.buy-btn:focus-visible{outline:2px solid #e4eef8;outline-offset:2px}
.buy-disclosure{margin:.5rem 0 0;font-size:15px;line-height:1.5;color:#e4eef8}
.buy-soft{color:#e4eef8;font-size:16px;line-height:1.6;margin:.85rem 0;padding:.75rem .9rem;border:1px solid var(--border2);border-radius:6px;background:var(--surface)}
.buy-sticky{position:fixed;left:0;right:0;bottom:0;z-index:40;margin:0;background:var(--surface);border-top:1px solid var(--border2);padding:.6rem .75rem calc(.6rem + env(safe-area-inset-bottom));box-shadow:0 -8px 24px rgba(0,0,0,.45)}
.buy-sticky .buy-cta-row{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch}
.buy-sticky .buy-btn{flex:0 0 auto;white-space:nowrap}
body:has(.buy-sticky){padding-bottom:8.75rem}
@media(max-width:600px){
  .buy-cta:not(.buy-sticky) .buy-cta-row{display:grid;grid-template-columns:1fr}
  .buy-cta:not(.buy-sticky) .buy-btn{width:100%}
}
</style>`;

function buyButtonsHtml(opts) {
  const options = opts || {};
  const list = selectAffiliates(options.names);
  const heading = options.heading || 'Buy on an exchange';
  const buttons = list.map((item) => (
    '<a class="buy-btn" href="' + esc(affiliateHref(item)) + '" target="_blank" rel="sponsored noopener"' + referralAttrs(item) + '>Buy on ' + esc(exchangeLabel(item.name)) + '</a>'
  )).join('');
  const note = options.note ? '<p class="buy-cta-note">' + esc(options.note) + '</p>' : '';
  const sticky = options.sticky ? ' buy-sticky' : '';
  return BUY_CSS +
    '<div class="buy-cta' + sticky + '">' +
      '<p class="buy-cta-label">' + esc(heading) + '</p>' +
      note +
      '<div class="buy-cta-row">' + buttons + '</div>' +
      '<p class="buy-disclosure">' + esc(REFERRAL_DISCLOSURE) + '</p>' +
    '</div>';
}

function buySoftNoteHtml(text) {
  return BUY_CSS + '<p class="buy-soft">' + esc(text) + '</p>';
}

function referralClickScript() {
  return `<script>
(function(){
  if(window.__cipherReferralClick) return;
  window.__cipherReferralClick=true;
  document.addEventListener('click', function(ev){
    var node = ev.target && ev.target.closest ? ev.target.closest('a[data-referral]') : null;
    if(!node) return;
    var exchange = node.getAttribute('data-exchange') || '';
    var page = location.pathname || '/';
    if(typeof gtag === 'function') gtag('event', 'referral_click', { exchange: exchange, page: page });
    if(typeof window.va === 'function') window.va('event', { name: 'referral_click', data: { exchange: exchange, page: page } });
  });
})();
</script>`;
}

function whereToBuyHtml(opts) {
  const options = opts || {};
  const list = selectAffiliates(options.names);
  const cards = list.map((item) => (
    '<a class="aff-card" href="' + esc(affiliateHref(item)) + '" target="_blank" rel="sponsored noopener"' + referralAttrs(item) + '>' +
      '<div class="aff-name">' + esc(item.name) + '</div>' +
      '<div class="aff-desc">' + esc(item.desc) + '</div>' +
      '<div class="aff-link">referral ↗</div>' +
    '</a>'
  )).join('');
  const heading = options.heading || 'where to buy';
  const note = options.noteHtml || 'Affiliate links. CIPHER may earn a commission if you sign up, at no extra cost to you. A listing is not an endorsement, not available in every country, and has nothing to do with a coin\'s score. <a href="/terms">Terms and disclaimer</a>.';
  return `<style>
.buy-block{background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:1.1rem 1.15rem;margin-top:1rem}
.buy-block h2{font-family:Orbitron,monospace;font-size:16px;color:var(--accent);letter-spacing:.1em;text-transform:uppercase;margin-bottom:.55rem}
.buy-note{font-size:16px;color:var(--secondary);line-height:1.6;margin-bottom:.8rem}
.aff-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.aff-card{background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:12px;text-decoration:none;display:block}
.aff-card:hover{border-color:var(--accent)}
.aff-name{font-family:Orbitron,monospace;font-size:15px;color:var(--accent);letter-spacing:.1em;margin-bottom:3px}
.aff-desc{font-size:15px;color:var(--muted);line-height:1.5;margin-bottom:6px}
.aff-link{font-size:15px;color:var(--pos)}
.buy-block .buy-disclosure{margin:.7rem 0 0;font-size:15px;line-height:1.5;color:#e4eef8}
</style>
<section class="buy-block" id="where-to-buy">
  <h2>${esc(heading)}</h2>
  <p class="buy-note">${note}</p>
  <div class="aff-grid">${cards}</div>
  <p class="buy-disclosure">${esc(REFERRAL_DISCLOSURE)}</p>
</section>`;
}

function navHtml(active, opts) {
  const ready = opts && opts.alertsReady;
  return '<nav class="site-nav" aria-label="primary">' + NAV.map((item) => {
    const classes = [];
    if (item.id === active) classes.push('active');
    if (item.flagship) classes.push('flagship');
    if (item.id === 'fortune') classes.push('nav-fortune');
    const cls = classes.length ? ' class="' + classes.join(' ') + '"' : '';
    let badge = item.badge ? ' <span class="new-badge">new</span>' : '';
    if (item.id === 'alerts' && !ready) badge = ' <span class="soon-badge">soon</span>';
    if (item.flagship) badge = ' <span class="new-badge">live</span>';
    const hook = item.hook ? '<span class="nav-hook">' + esc(item.hook) + '</span>' : '';
    return '<a href="' + esc(item.href) + '"' + cls + '>' + esc(item.label) + hook + badge + '</a>';
  }).join('') + '</nav>';
}

function alertFormHtml(opts) {
  const coinId = opts && opts.coinId ? String(opts.coinId) : '';
  const coins = (opts && opts.coins) || [];
  const options = coins.map((coin) => {
    const id = esc(coin.id);
    const label = coin.symbol ? esc(coin.symbol) + ' — ' + id : id;
    return '<option value="' + id + '">' + label + '</option>';
  }).join('');
  const value = coinId ? ' value="' + esc(coinId) + '"' : '';
  return `<form id="alert-form" class="alert-form" action="/api/alerts" method="post">
  <div class="hp" aria-hidden="true">
    <label>company <input type="text" name="company" tabindex="-1" autocomplete="off"></label>
  </div>
  <label class="alert-field">email
    <input type="email" name="email" required maxlength="254" placeholder="you@email.com" autocomplete="email">
  </label>
  <label class="alert-field">coin
    <input type="text" name="coinId" required maxlength="80" list="alert-coins" placeholder="dogecoin"${value} autocomplete="off">
  </label>
  <datalist id="alert-coins">${options}</datalist>
  <label class="alert-field">when price
    <select name="direction">
      <option value="above">goes above</option>
      <option value="below">goes below</option>
    </select>
  </label>
  <label class="alert-field">threshold (USD)
    <input type="number" name="threshold" required min="0" step="any" inputmode="decimal" placeholder="0.10">
  </label>
  <button type="submit">save alert</button>
  <p class="form-note">We email a confirmation, then one note when the price crosses your number. If the confirmation does not arrive, the alert is still saved and we try again. <a href="/privacy.html">Privacy</a>. Not financial advice.</p>
  <p id="alert-msg" role="status"></p>
</form>`;
}

function shell(opts) {
  const title = opts.title;
  const description = opts.description;
  const path = opts.path || '/';
  const pageUrl = SITE + path;
  const image = opts.image || (SITE + '/og-image.png');
  const robots = opts.robots || 'index,follow';
  const shareKind = opts.shareIntent === 'post' ? 'post' : 'tweet';
  const shareLabel = opts.shareLabel || 'share on X';
  const share = opts.shareText
    ? '<a class="btn x" href="' + esc('https://x.com/intent/' + shareKind + '?text=' + encodeURIComponent(opts.shareText)) + '" target="_blank" rel="noopener">' + esc(shareLabel) + '</a>'
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${esc(robots)}">
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@ciphersignal_">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
${themeHead()}
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@500;700;900&display=swap" rel="stylesheet">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5329567907369860" crossorigin="anonymous"></script>
${opts.extraHead || ''}
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#060810;--surface:#0b0e1a;--surface2:#111625;--border:#1a2035;--border2:#243050;--accent:#00e5ff;--accent3:#00ff99;--accent4:#ff3355;--text:#e8eef8;--ink:#e4eef8;--secondary:#c9d4e6;--muted:#a8b8d4;--pos:#00ff99;--neg:#ff3355;--warn:#ffb400;--on-accent:#041018;--on-pos:#04140c;--on-warn:#041018;--focus:#e4eef8}
html,body{min-height:100vh;background:var(--bg);color:var(--ink);font-family:'Share Tech Mono',monospace;font-size:16.5px;line-height:1.6}
body::before{content:'';position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,229,255,.013) 2px,rgba(0,229,255,.013) 4px);pointer-events:none;z-index:9999}
a{color:var(--accent)}
.app{max-width:1100px;margin:0 auto;padding:1.5rem 1rem 3rem;position:relative;z-index:1}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:.8rem}
.logo{font-family:Orbitron,monospace;font-weight:900;letter-spacing:.14em;color:var(--accent);text-decoration:none;font-size:22px}
.logo span{display:block;font-family:'Share Tech Mono',monospace;font-size:12px;letter-spacing:.2em;color:var(--muted);font-weight:400;margin-top:2px}
.xlink{font-size:15px;color:var(--muted);text-decoration:none;border:1px solid var(--border2);padding:6px 10px;border-radius:4px}
.xlink:hover{color:var(--accent);border-color:rgba(0,229,255,.4)}
.site-nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:1.25rem}
.site-nav a{font-family:Orbitron,monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;color:var(--muted);border:1px solid var(--border2);padding:7px 10px;border-radius:4px}
.site-nav a:hover,.site-nav a.active{color:var(--accent);border-color:var(--accent);background:transparent}
.site-nav a.flagship,.site-nav a.flagship:hover{color:var(--on-accent);background:var(--accent);border-color:var(--accent)}
.site-nav a.nav-fortune{display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px;line-height:1.15;padding:8px 12px;min-height:44px}
.nav-hook{display:block;font-family:'Share Tech Mono',monospace;font-size:12px;letter-spacing:.02em;text-transform:none;color:#e4eef8;font-weight:400}
.new-badge{display:inline-block;margin-left:6px;font-family:Orbitron,monospace;font-size:12px;letter-spacing:.12em;color:var(--on-pos);background:var(--pos);padding:1px 4px;border-radius:2px;font-weight:700;vertical-align:1px}
.soon-badge{display:inline-block;margin-left:6px;font-family:Orbitron,monospace;font-size:12px;letter-spacing:.12em;color:var(--on-warn);background:var(--warn);padding:1px 4px;border-radius:2px;font-weight:700;vertical-align:1px}
h1{font-family:Orbitron,monospace;font-size:28px;font-weight:900;letter-spacing:.08em;color:var(--accent);line-height:1.25;margin-bottom:.6rem}
.lede{color:var(--secondary);font-size:16.5px;line-height:1.7;max-width:760px;margin-bottom:.9rem}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin:.4rem 0 1rem}
.btn,button.btn{font-family:Orbitron,monospace;font-size:13px;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;border:1px solid var(--border2);color:var(--accent);background:transparent;padding:8px 14px;border-radius:4px;cursor:pointer}
.btn.x{border-color:rgba(29,161,242,.5);color:#1da1f2;background:rgba(29,161,242,.08)}
.btn.warn{border-color:var(--warn);color:var(--warn);background:transparent}
.card{background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:1rem 1.1rem;margin-bottom:1rem}
.card h2{font-family:Orbitron,monospace;font-size:16px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:.35rem}
.hint{color:var(--muted);font-size:16px;line-height:1.6;margin-bottom:.7rem}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:16px}
th{font-size:13px;color:var(--muted);letter-spacing:.12em;text-transform:uppercase;text-align:left;padding:8px 8px;border-bottom:1px solid var(--border2);font-weight:400}
td{padding:9px 8px;border-bottom:1px solid var(--border);vertical-align:middle;white-space:nowrap}
.coin{display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit}
.coin img{width:24px;height:24px;border-radius:50%;border:1px solid var(--border2)}
.sym{font-family:Orbitron,monospace;font-size:16px;letter-spacing:.06em;color:var(--text)}
.sub{display:block;font-size:15px;color:var(--muted);max-width:180px;overflow:hidden;text-overflow:ellipsis}
.pos{color:var(--pos)}.neg{color:var(--neg)}
.ghost{font-family:Orbitron,monospace;font-size:12px;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;border:1px solid var(--border2);color:var(--muted);background:none;padding:6px 8px;border-radius:4px;cursor:pointer}
.ghost:hover{color:var(--text);border-color:var(--text)}
.row-links{display:flex;gap:6px;flex-wrap:wrap}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:1rem 0}
.stat{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 12px}
.stat b{display:block;font-size:13px;color:var(--muted);letter-spacing:.12em;text-transform:uppercase;font-weight:400;margin-bottom:4px}
.stat span{font-family:Orbitron,monospace;font-size:17px;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
.num,.pos,.neg{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
.buy-block{background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:1.1rem 1.15rem;margin-top:1rem}
.buy-block h2{font-family:Orbitron,monospace;font-size:16px;color:var(--accent);letter-spacing:.1em;text-transform:uppercase;margin-bottom:.55rem}
.buy-note{font-size:16px;color:var(--secondary);line-height:1.6;margin-bottom:.8rem}
.aff-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.aff-card{background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:12px;text-decoration:none;display:block}
.aff-card:hover{border-color:var(--accent)}
.aff-name{font-family:Orbitron,monospace;font-size:15px;color:var(--accent);letter-spacing:.1em;margin-bottom:3px}
.aff-desc{font-size:15px;color:var(--muted);line-height:1.5;margin-bottom:6px}
.aff-link{font-size:15px;color:var(--accent3)}
.alert-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;align-items:end}
.alert-field{display:flex;flex-direction:column;gap:4px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.alert-form input,.alert-form select{background:var(--bg);border:1px solid var(--border2);color:var(--text);font-family:'Share Tech Mono',monospace;font-size:16px;padding:8px 10px;border-radius:4px;outline:none;width:100%;text-transform:none;letter-spacing:0}
.alert-form input:focus,.alert-form select:focus{border-color:var(--accent)}
.alert-form button{font-family:Orbitron,monospace;font-size:13px;letter-spacing:.1em;text-transform:uppercase;background:var(--accent);color:var(--on-accent);border:none;border-radius:4px;padding:10px 14px;cursor:pointer;font-weight:700}
.form-note,#alert-msg{grid-column:1/-1;font-size:16px;color:var(--muted);line-height:1.6;text-transform:none;letter-spacing:0}
.hp{position:absolute;left:-9999px;height:0;overflow:hidden}
.update{display:block;padding:.85rem 0;border-bottom:1px solid var(--border);text-decoration:none;color:inherit}
.update:hover .update-title{color:var(--accent)}
.update-date{font-size:13px;color:var(--muted);letter-spacing:.12em;text-transform:uppercase}
.update-title{font-family:Orbitron,monospace;font-size:16.5px;color:var(--text);margin:4px 0}
.update p{font-size:16px;color:var(--secondary);line-height:1.6}
.footer{margin-top:2rem;padding-top:1rem;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.footer a{color:var(--muted);text-decoration:none;font-size:16px;letter-spacing:.06em;text-transform:uppercase;margin-right:12px}
.footer a:hover{color:var(--accent)}
.disclaimer{margin-top:.8rem;font-size:15px;color:var(--muted);line-height:1.6}
.err{color:#ff6680;border:1px solid rgba(255,51,85,.3);background:rgba(255,51,85,.05);padding:.9rem 1rem;border-radius:6px}
@media(max-width:600px){h1{font-size:22px}.app{padding:.9rem .7rem 2.5rem}}
</style>
${ANALYTICS_SNIPPET}
</head>
<body>
<div class="app">
  <div class="topbar">
    <a class="logo" href="/">CIPHER<span>meme coin intelligence</span></a>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${themeControlHtml()}<a class="xlink" href="https://x.com/ciphersignal_" target="_blank" rel="noopener">@ciphersignal_</a></div>
  </div>
  ${navHtml(opts.active, { alertsReady: opts.alertsReady })}
  <h1>${esc(opts.heading || title)}</h1>
  ${opts.lede ? '<p class="lede">' + opts.lede + '</p>' : ''}
  ${share ? '<div class="actions">' + share + (opts.extraActions || '') + '</div>' : (opts.extraActions ? '<div class="actions">' + opts.extraActions + '</div>' : '')}
  ${opts.body || ''}
  <div class="footer">
    <div>
      <a href="/">scanner</a>
      <a href="/smart-money">smart money</a>
      <a href="/cipher-fortune">cipher fortune</a>
      <a href="/#advertise">advertise</a>
      <a href="/check">ape check</a>
      <a href="/compare">compare</a>
      <a href="/hall">hall</a>
      <a href="/movers">top movers</a>
      <a href="/alerts">price alerts</a>
      <a href="/digest">digest</a>
      <a href="/updates">what's new</a>
      <a href="/learn/">learn</a>
      <a href="/privacy.html">privacy</a>
      <a href="/terms">terms</a>
    </div>
  </div>
  <p class="disclaimer">Not financial advice. Nothing here is an offer to buy, sell, or bet. Affiliate links may earn a commission.<br>Prices via <a href="https://www.coingecko.com/en/api?utm_source=ciphersignal&utm_medium=referral" target="_blank" rel="noopener">CoinGecko</a> · © 2026 CIPHER</p>
</div>
<script>
(function(){
  var KEY='cipher_watchlist';
  function read(){ try { var v=JSON.parse(localStorage.getItem(KEY)||'[]'); return Array.isArray(v)?v:[]; } catch(e){ return []; } }
  function write(list){ try { localStorage.setItem(KEY, JSON.stringify(list)); } catch(e){} }
  function has(id){ return read().indexOf(id)!==-1; }
  function paint(){
    document.querySelectorAll('[data-watch]').forEach(function(btn){
      var id=btn.getAttribute('data-watch');
      btn.textContent = has(id) ? '⭐ watching' : '☆ watch';
    });
  }
  document.querySelectorAll('[data-watch]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id=btn.getAttribute('data-watch');
      var list=read();
      var i=list.indexOf(id);
      if(i===-1) list.push(id); else list.splice(i,1);
      write(list);
      paint();
    });
  });
  paint();
  var form=document.getElementById('alert-form');
  if(!form) return;
  form.addEventListener('submit', function(ev){
    ev.preventDefault();
    var msg=document.getElementById('alert-msg');
    var button=form.querySelector('button[type="submit"]');
    button.disabled=true;
    var body={
      email: form.email.value,
      coinId: form.coinId.value,
      direction: form.direction.value,
      threshold: form.threshold.value,
      company: form.company ? form.company.value : ''
    };
    fetch('/api/alerts', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body)})
      .then(function(r){ return r.json().then(function(data){ return data || {}; }).catch(function(){ return {}; }); })
      .then(function(data){
        if(data.stored){
          msg.style.color=data.emailed===false?'#ffb400':'#00ff99';
          msg.textContent=data.message || 'Saved.';
        } else {
          msg.style.color='#ff6680';
          msg.textContent=data.error || 'Could not save that signup.';
        }
      })
      .catch(function(){
        msg.style.color='#ff6680';
        msg.textContent='Network error. Try again.';
      })
      .then(function(){ button.disabled=false; });
  });
})();
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-CQVB0E2CMB"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-CQVB0E2CMB');</script>
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "2382bf7a026c49308ca0a646e46d7b84"}'></script>
${themeClientScript()}
${referralClickScript()}
</body>
</html>`;
}

module.exports = {
  SITE,
  AFFILIATES,
  REFERRAL_DISCLOSURE,
  whereToBuyHtml,
  buyButtonsHtml,
  buySoftNoteHtml,
  referralClickScript,
  affiliateHref,
  alertFormHtml,
  shell,
  navHtml,
};
