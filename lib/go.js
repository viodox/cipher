'use strict';

// Fixed partner hops. Each /go/<slug> page is a static file so Hobby can count
// a normal Web Analytics pageview. The destination is this allowlist only.
// Nothing on the page reads a query string, hash, or other user-supplied URL.

const { esc } = require('./http-util');
const { ANALYTICS_SNIPPET } = require('./web-analytics');

const GO_PARTNERS = [
  {
    slug: 'coinbase',
    name: 'COINBASE',
    label: 'Coinbase',
    href: 'https://coinbase.com/join/QQYSCTU?src=referral-link',
  },
  {
    slug: 'binance-us',
    name: 'BINANCE.US',
    label: 'Binance.US',
    href: 'https://www.binance.us/universal_JHHGDSKDJ/auth/registration?ref=52095831',
  },
  {
    slug: 'kraken',
    name: 'KRAKEN',
    label: 'Kraken',
    href: 'https://invite.kraken.com/JDNW/bkxtyuas',
  },
  {
    slug: 'crypto-com',
    name: 'CRYPTO.COM',
    label: 'Crypto.com',
    href: 'https://crypto.com/app/8hxtmyan6d',
  },
  {
    slug: 'robinhood',
    name: 'ROBINHOOD',
    label: 'Robinhood',
    href: 'https://join.robinhood.com/miked2104',
  },
];

function goPath(slug) {
  return '/go/' + slug;
}

function partnerBySlug(slug) {
  return GO_PARTNERS.find((partner) => partner.slug === slug) || null;
}

function isFixedHttps(href) {
  return /^https:\/\/[^\s"'<>\\]+$/.test(String(href || ''));
}

// Install a fetch wrapper before the deferred analytics script runs. Script
// 0.1.3 POSTs a pageview to /rq/s/view with keepalive after an async flags
// lookup. Leave once that request has started, or after 1.8s if it never does.
function goClientScript(dest) {
  const href = String(dest || '');
  if (!isFixedHttps(href)) throw new Error('redirect target must be a fixed https URL');
  return `(function(){
  var dest = ${JSON.stringify(href)};
  var left = false;
  function leave(){
    if(left) return;
    left = true;
    location.replace(dest);
  }
  var orig = window.fetch;
  if(typeof orig === 'function'){
    window.fetch = function(input){
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var result = orig.apply(this, arguments);
      if(!left && String(url).indexOf('/rq/s/view') !== -1) window.setTimeout(leave, 100);
      return result;
    };
  }
  window.setTimeout(leave, 1800);
})();`;
}

function renderHopPage(opts) {
  const label = opts.label;
  const href = opts.href;
  const path = opts.path;
  if (!isFixedHttps(href)) throw new Error('bad hop');
  const title = 'CIPHER → ' + label;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="robots" content="noindex, nofollow">
<link rel="canonical" href="https://www.ciphersignal.xyz${esc(path)}">
<meta http-equiv="refresh" content="3;url=${esc(href)}">
<link rel="icon" href="/favicon.ico" sizes="any">
<style>
body{margin:0;min-height:100vh;background:#060810;color:#e4eef8;font-family:ui-monospace,monospace;font-size:16.5px;line-height:1.6;display:flex;align-items:center;justify-content:center}
.box{max-width:32rem;padding:2rem 1.25rem}
.kicker{margin:0 0 .75rem;color:#00e5ff;letter-spacing:.12em;text-transform:uppercase;font-size:13px}
p{margin:0 0 1rem}
a{color:#00e5ff}
a:focus-visible{outline:2px solid #e4eef8;outline-offset:3px}
</style>
${ANALYTICS_SNIPPET}
</head>
<body>
<div class="box">
  <p class="kicker">// referral</p>
  <p>Redirecting to ${esc(label)}…</p>
  <p><a href="${esc(href)}" rel="sponsored nofollow noopener">Continue to ${esc(label)}</a></p>
</div>
<script>
${goClientScript(href)}
</script>
</body>
</html>
`;
}

function renderGoPage(slug) {
  const partner = partnerBySlug(slug);
  if (!partner) return null;
  return renderHopPage({
    label: partner.label,
    href: partner.href,
    path: goPath(partner.slug),
  });
}

function renderAdvertiseRedirect() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Advertise — CIPHER</title>
<meta name="description" content="Book a sponsored placement on CIPHER. Reach out from the form. There is no public rate card.">
<meta name="robots" content="noindex">
<link rel="canonical" href="https://www.ciphersignal.xyz/#advertise">
<meta http-equiv="refresh" content="0;url=/#advertise">
<link rel="icon" href="/favicon.ico" sizes="any">
<style>
body{margin:0;min-height:100vh;background:#060810;color:#e4eef8;font-family:ui-monospace,monospace;font-size:16.5px;line-height:1.6;display:flex;align-items:center;justify-content:center}
.box{max-width:32rem;padding:2rem 1.25rem}
a{color:#00e5ff}
a:focus-visible{outline:2px solid #e4eef8;outline-offset:3px}
</style>
${ANALYTICS_SNIPPET}
</head>
<body>
<div class="box">
  <p><a href="/#advertise">Book Coin of the Day</a></p>
</div>
<script>location.replace('/#advertise');</script>
</body>
</html>
`;
}

module.exports = {
  GO_PARTNERS,
  goPath,
  partnerBySlug,
  goClientScript,
  renderGoPage,
  renderAdvertiseRedirect,
};
