// ============================================
// CIPHER X Bot — Automated Daily Tweets
// ============================================
const crypto = require("crypto");
const https = require("https");

const CONFIG = {
  API_KEY: process.env.X_API_KEY,
  API_KEY_SECRET: process.env.X_API_KEY_SECRET,
  ACCESS_TOKEN: process.env.X_ACCESS_TOKEN,
  ACCESS_TOKEN_SECRET: process.env.X_ACCESS_TOKEN_SECRET,
  COINGECKO_URL: "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=meme-token&order=volume_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h",
  SITE_URL: "https://www.ciphersignal.xyz",
};

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: "application/json", "User-Agent": "CipherBot/1.0" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch (e) { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function percentEncode(str) { return encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`); }

function generateOAuthSignature(method, url, params, cs, ts) {
  const sorted = Object.keys(params).sort().map(k => `${percentEncode(k)}=${percentEncode(params[k])}`).join("&");
  return crypto.createHmac("sha1", `${percentEncode(cs)}&${percentEncode(ts)}`).update(`${method}&${percentEncode(url)}&${percentEncode(sorted)}`).digest("base64");
}

function getOAuthHeader(method, url) {
  const op = { oauth_consumer_key: CONFIG.API_KEY, oauth_nonce: crypto.randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1", oauth_timestamp: Math.floor(Date.now()/1000).toString(), oauth_token: CONFIG.ACCESS_TOKEN, oauth_version: "1.0" };
  op.oauth_signature = generateOAuthSignature(method, url, op, CONFIG.API_KEY_SECRET, CONFIG.ACCESS_TOKEN_SECRET);
  return `OAuth ${Object.keys(op).sort().map(k => `${percentEncode(k)}="${percentEncode(op[k])}"`).join(", ")}`;
}

async function postTweet(text) {
  const url = "https://api.twitter.com/2/tweets";
  const body = JSON.stringify({ text });
  const res = await httpsRequest({ hostname: "api.twitter.com", path: "/2/tweets", method: "POST", headers: { Authorization: getOAuthHeader("POST", url), "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, body);
  if (res.status === 201) { console.log(`✅ Posted: ${res.body.data.id}`); return res.body; }
  else { console.error(`❌ Failed (${res.status}):`, JSON.stringify(res.body)); throw new Error(`Failed: ${res.status}`); }
}

async function fetchMemeCoins() {
  console.log("📡 Fetching data...");
  const r = await httpsGet(CONFIG.COINGECKO_URL);
  const coins = Array.isArray(r) ? r : [];
  if (!coins.length) {
    const t = await httpsGet("https://api.coingecko.com/api/v3/search/trending");
    const tc = t.coins || [];
    if (!tc.length) throw new Error("No data");
    return tc.map(c => ({ name: c.item.name, symbol: c.item.symbol.toUpperCase(), cgId: c.item.id, price: c.item.data?.price||0, change24h: c.item.data?.price_change_percentage_24h?.usd||0, volume: parseFloat(c.item.data?.total_volume||"0"), marketCap: parseFloat(c.item.data?.market_cap||"0") }));
  }
  return coins.map(c => ({ name: c.name, symbol: c.symbol.toUpperCase(), cgId: c.id, price: c.current_price, change24h: c.price_change_percentage_24h||0, volume: c.total_volume, marketCap: c.market_cap }));
}

// ── Helpers ──────────────────────────────────
function fP(p) { return p>=1?`$${p.toFixed(2)}`:p>=0.001?`$${p.toFixed(4)}`:`$${p.toFixed(8)}`; }
function fC(c) { return `${c>=0?"+":""}${c.toFixed(1)}%`; }
function fV(v) { return v>=1e9?`$${(v/1e9).toFixed(1)}B`:v>=1e6?`$${(v/1e6).toFixed(1)}M`:v>=1e3?`$${(v/1e3).toFixed(0)}K`:`$${v}`; }
function cg(c) { return `coingecko.com/en/coins/${c.cgId}`; }
function pick(a) { return a[Math.floor(Math.random()*a.length)]; }
function topN(c,k,n=3,d='d') { return [...c].sort((a,b)=>d==='d'?b[k]-a[k]:a[k]-b[k]).slice(0,n); }
function rating(c) { return c>=20?'SEND IT':c>=5?'BULLISH':c>=-5?'HOLD':c>=-15?'BEARISH':'NGMI'; }

// ── 16 Tweet Templates (branded style) ──────

function tpl_dailySignal(coins) {
  const top = topN(coins,'change24h',1)[0];
  const vol = topN(coins,'volume',1)[0];
  return `🔐 CIPHER Daily Signal

📈 Top Gainer: $${top.symbol} ${fC(top.change24h)}
↳ ${cg(top)}
🔊 Most Volume: $${vol.symbol} (${fV(vol.volume)})

🤖 Verdict: ${rating(top.change24h)}

🍯 Scan before you ape → ${CONFIG.SITE_URL}`;
}

function tpl_topMovers(coins) {
  const top = topN(coins,'change24h',3);
  let t = `🔐 CIPHER Top 3 Movers\n\n`;
  top.forEach((c,i) => { t += `${i+1}. ${c.change24h>=0?'🟢':'🔴'} $${c.symbol} ${fC(c.change24h)}\n↳ ${cg(c)}\n`; });
  t += `\n🍯 Scan contracts → ${CONFIG.SITE_URL}`;
  return t;
}

function tpl_spotlight(coins) {
  const c = pick(topN(coins,'volume',5));
  return `🔐 CIPHER Spotlight: $${c.symbol}

💰 ${fP(c.price)} · 📊 ${fC(c.change24h)}
🔊 Vol: ${fV(c.volume)} · MCap: ${fV(c.marketCap)}
🤖 Signal: ${rating(c.change24h)}

✅ Verify → ${cg(c)}
🍯 Scan contract → ${CONFIG.SITE_URL}`;
}

function tpl_volatility(coins) {
  const v = coins.filter(c => c.change24h<=-10 || c.change24h>=50);
  if (!v.length) return `🔐 CIPHER Volatility Check\n\n✅ No extreme movers in 24h\n\nStay safe. Scan any contract free → ${CONFIG.SITE_URL}`;
  let t = `⚡ CIPHER Volatility Alert\n\n`;
  v.slice(0,3).forEach(c => { t += `${c.change24h>=0?'📈':'📉'} $${c.symbol} ${fC(c.change24h)}\n↳ ${cg(c)}\n`; });
  t += `\n🍯 Scan before you ape → ${CONFIG.SITE_URL}`;
  return t;
}

function tpl_dipRadar(coins) {
  const dips = topN(coins,'change24h',3,'a');
  let t = `📉 CIPHER Dip Radar\n\n`;
  dips.forEach((c,i) => { t += `${i+1}. 🔴 $${c.symbol} ${fC(c.change24h)}\n↳ ${cg(c)}\n`; });
  t += `\n🍯 Verify before you buy → ${CONFIG.SITE_URL}`;
  return t;
}

function tpl_volumeWatch(coins) {
  const top = topN(coins,'volume',3);
  let t = `🔊 CIPHER Volume Watch\n\n`;
  top.forEach((c,i) => { t += `${i+1}. $${c.symbol} — ${fV(c.volume)} vol\n↳ ${cg(c)}\n`; });
  t += `\n🍯 Scan contracts → ${CONFIG.SITE_URL}`;
  return t;
}

function tpl_marketPulse(coins) {
  const avg = coins.reduce((s,c)=>s+c.change24h,0)/coins.length;
  const bull = coins.filter(c=>c.change24h>0).length;
  const bear = coins.length - bull;
  const top = topN(coins,'change24h',1)[0];
  return `🔐 CIPHER Market Pulse

📊 ${bull} bullish / ${bear} bearish
📈 Avg: ${fC(avg)}
👑 Top: $${top.symbol} ${fC(top.change24h)}
↳ ${cg(top)}

🍯 Scan any contract → ${CONFIG.SITE_URL}`;
}

function tpl_cipherPot(coins) {
  const top = topN(coins,'change24h',1)[0];
  return `🍯 CIPHER CipherPot

Paste any contract address → instant scan

✅ Honeypot detection
✅ Hidden buy/sell taxes
✅ Mint & freeze authority
✅ Top holder concentration

ETH · BSC · Base · Solana

Today's top mover: $${top.symbol} ${fC(top.change24h)}

Scan free → ${CONFIG.SITE_URL}`;
}

// ── NEW templates for variety ───────────────

function tpl_volumeSpike(coins) {
  const spikes = coins.filter(c=>c.marketCap>0&&c.volume/c.marketCap>1).sort((a,b)=>(b.volume/b.marketCap)-(a.volume/a.marketCap));
  if (!spikes.length) return tpl_volumeWatch(coins);
  let t = `🔐 CIPHER Volume Spike Alert\n\n🚨 Volume > Market Cap:\n\n`;
  spikes.slice(0,3).forEach(c => { t += `$${c.symbol} — ${(c.volume/c.marketCap).toFixed(1)}x vol/mcap\n↳ ${cg(c)}\n`; });
  t += `\n⚠️ Unusual activity. DYOR\n${CONFIG.SITE_URL}`;
  return t;
}

function tpl_greenDay(coins) {
  const green = coins.filter(c=>c.change24h>0).length;
  const pct = ((green/coins.length)*100).toFixed(0);
  const best = topN(coins,'change24h',1)[0];
  const worst = topN(coins,'change24h',1,'a')[0];
  return `🔐 CIPHER Market Snapshot

${pct}% of meme coins are green right now

🟢 Best: $${best.symbol} ${fC(best.change24h)}
🔴 Worst: $${worst.symbol} ${fC(worst.change24h)}

250+ coins tracked live
${CONFIG.SITE_URL}`;
}

function tpl_smallCap(coins) {
  const small = coins.filter(c=>c.marketCap>100e3&&c.marketCap<5e6&&c.change24h>10);
  if (!small.length) return tpl_spotlight(coins);
  const c = pick(small);
  return `🔐 CIPHER Low Cap Alert

🔍 $${c.symbol}
💰 MCap: ${fV(c.marketCap)}
📊 24h: ${fC(c.change24h)}
🔊 Vol: ${fV(c.volume)}

Low cap + momentum 👀

✅ ${cg(c)}
🍯 Scan contract → ${CONFIG.SITE_URL}`;
}

function tpl_whaleWatch(coins) {
  const big = topN(coins,'volume',3);
  let t = `🐋 CIPHER Whale Watch\n\n💰 Where the money is flowing:\n\n`;
  big.forEach((c,i) => { t += `${i+1}. $${c.symbol} — ${fV(c.volume)} in 24h\n↳ ${cg(c)}\n`; });
  t += `\n🔐 Track it live → ${CONFIG.SITE_URL}`;
  return t;
}

function tpl_sleepers(coins) {
  const s = coins.filter(c=>Math.abs(c.change24h)<3&&c.volume>1e6);
  if (s.length<2) return tpl_marketPulse(coins);
  const picks = s.sort(()=>Math.random()-.5).slice(0,3);
  let t = `🔐 CIPHER Sleeper Watch\n\n🔇 Flat price but real volume:\n\n`;
  picks.forEach(c => { t += `$${c.symbol} — ${fC(c.change24h)} w/ ${fV(c.volume)} vol\n`; });
  t += `\n👀 Something brewing?\n${CONFIG.SITE_URL}`;
  return t;
}

function tpl_didYouKnow(coins) {
  const top = topN(coins,'change24h',1)[0];
  const facts = [
    '🔐 CIPHER scans 250+ meme coins every 10 min\n\nCompletely free. No signup. No paywall.',
    '🍯 CipherPot catches honeypots before you buy\n\nPaste any contract address → instant scan',
    '🔐 CIPHER tracks real CoinGecko trending data\n\nNot random numbers. Real signals.',
    '🤖 AI Decrypt gives raw analysis on any meme coin\n\nPrice action, viral potential, rug signals.',
    '🔐 CIPHER has no premium tier\n\nNo token. No paywall. Just a free tool for the community.',
    '🔍 Search by contract address on CIPHER\n\nNot just ticker names. Paste any CA.',
  ];
  return `${pick(facts)}\n\nTop mover: $${top.symbol} ${fC(top.change24h)}\n\n${CONFIG.SITE_URL}`;
}

function tpl_endOfDay(coins) {
  const best = topN(coins,'change24h',1)[0];
  const totalVol = coins.reduce((s,c)=>s+c.volume,0);
  const avg = coins.reduce((s,c)=>s+c.change24h,0)/coins.length;
  return `🔐 CIPHER Daily Wrap

📊 Total vol scanned: ${fV(totalVol)}
📈 Avg move: ${fC(avg)}
👑 MVP: $${best.symbol} ${fC(best.change24h)}

Scanner runs 24/7 🔐
${CONFIG.SITE_URL}`;
}

function tpl_quickHit(coins) {
  const c = pick(topN(coins,'volume',10));
  const lines = [
    `$${c.symbol} doing ${fV(c.volume)} volume on ${fV(c.marketCap)} mcap 👀`,
    `$${c.symbol} at ${fP(c.price)} — ${fC(c.change24h)} today`,
    `$${c.symbol} — ${fV(c.volume)} vol, ${fC(c.change24h)} change`,
  ];
  return `🔐 CIPHER Quick Signal\n\n${pick(lines)}\n\n✅ ${cg(c)}\n🍯 ${CONFIG.SITE_URL}`;
}

// ── All 16 templates ────────────────────────
const TEMPLATES = [
  tpl_dailySignal, tpl_topMovers, tpl_spotlight, tpl_volatility,
  tpl_dipRadar, tpl_volumeWatch, tpl_marketPulse, tpl_cipherPot,
  tpl_volumeSpike, tpl_greenDay, tpl_smallCap, tpl_whaleWatch,
  tpl_sleepers, tpl_didYouKnow, tpl_endOfDay, tpl_quickHit,
];

function getTemplate() {
  const now = new Date();
  const day = Math.floor((now - new Date(now.getFullYear(),0,0)) / 86400000);
  const hour = now.getUTCHours();
  const idx = (day * 13 + hour * 7) % TEMPLATES.length;
  return TEMPLATES[idx];
}

// ── Main ────────────────────────────────────
async function main() {
  const missing = [];
  if (!CONFIG.API_KEY) missing.push("X_API_KEY");
  if (!CONFIG.API_KEY_SECRET) missing.push("X_API_KEY_SECRET");
  if (!CONFIG.ACCESS_TOKEN) missing.push("X_ACCESS_TOKEN");
  if (!CONFIG.ACCESS_TOKEN_SECRET) missing.push("X_ACCESS_TOKEN_SECRET");
  if (missing.length) { console.error(`❌ Missing: ${missing.join(", ")}`); process.exit(1); }

  try {
    const coins = await fetchMemeCoins();
    console.log(`📊 ${coins.length} coins loaded`);

    const fn = getTemplate();
    console.log(`📝 Template: ${fn.name}`);

    let tweet = fn(coins);
    if (tweet.length > 280) tweet = tweet.substring(0, 277) + '...';

    console.log(`\n--- (${tweet.length}/280) ---\n${tweet}\n---\n`);
    await postTweet(tweet);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

main();
