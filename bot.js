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
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`JSON parse: ${e.message}`)); } });
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

function percentEncode(str) { return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`); }

function generateOAuthSignature(method, url, params, cs, ts) {
  const sorted = Object.keys(params).sort().map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join("&");
  return crypto.createHmac("sha1", `${percentEncode(cs)}&${percentEncode(ts)}`).update(`${method}&${percentEncode(url)}&${percentEncode(sorted)}`).digest("base64");
}

function getOAuthHeader(method, url) {
  const op = { oauth_consumer_key: CONFIG.API_KEY, oauth_nonce: crypto.randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1", oauth_timestamp: Math.floor(Date.now()/1000).toString(), oauth_token: CONFIG.ACCESS_TOKEN, oauth_version: "1.0" };
  op.oauth_signature = generateOAuthSignature(method, url, op, CONFIG.API_KEY_SECRET, CONFIG.ACCESS_TOKEN_SECRET);
  return `OAuth ${Object.keys(op).sort().map((k) => `${percentEncode(k)}="${percentEncode(op[k])}"`).join(", ")}`;
}

async function postTweet(text) {
  const url = "https://api.twitter.com/2/tweets";
  const body = JSON.stringify({ text });
  const res = await httpsRequest({ hostname: "api.twitter.com", path: "/2/tweets", method: "POST", headers: { Authorization: getOAuthHeader("POST", url), "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, body);
  if (res.status === 201) { console.log(`✅ Posted: ${res.body.data.id}`); return res.body; }
  else { console.error(`❌ Failed (${res.status}):`, JSON.stringify(res.body)); throw new Error(`Tweet failed: ${res.status}`); }
}

async function fetchMemeCoins() {
  console.log("📡 Fetching data...");
  const r = await httpsGet(CONFIG.COINGECKO_URL);
  const coins = Array.isArray(r) ? r : [];
  if (coins.length === 0) {
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
function top(coins,key,n=3,d='d') { return [...coins].sort((a,b)=>d==='d'?b[key]-a[key]:a[key]-b[key]).slice(0,n); }

// ── 14 Tweet Templates ──────────────────────

function tpl1_gm(coins) {
  const g = coins.filter(c=>c.change24h>0).length;
  const l = coins.length - g;
  const t = top(coins,'change24h',1)[0];
  const mood = g>l*1.5?'green across the board':g>l?'leaning bullish':g===l?'split 50/50':'mostly red today';
  return `gm. ${mood}

${g} up / ${l} down across 50 meme coins

leading the pack: $${t.symbol} ${fC(t.change24h)}

full breakdown at ${CONFIG.SITE_URL}`;
}

function tpl2_spotlight(coins) {
  const c = pick(top(coins,'change24h',5));
  const vr = c.marketCap>0?(c.volume/c.marketCap).toFixed(1):'?';
  return `$${c.symbol} is doing numbers

${fP(c.price)} | ${fC(c.change24h)} today
${fV(c.volume)} volume on a ${fV(c.marketCap)} mcap
vol/mcap: ${vr}x

${cg(c)}
${CONFIG.SITE_URL}`;
}

function tpl3_sleepers(coins) {
  const s = coins.filter(c=>Math.abs(c.change24h)<3&&c.volume>1e6);
  if (s.length<2) return tpl2_spotlight(coins);
  const p = s.sort(()=>Math.random()-.5).slice(0,3);
  let t = `flat price but real volume. keep an eye on:\n\n`;
  p.forEach(c=>{ t+=`$${c.symbol} — ${fC(c.change24h)} w/ ${fV(c.volume)} vol\n`; });
  t += `\nquiet before the move? or just quiet. dyor\n${CONFIG.SITE_URL}`;
  return t;
}

function tpl4_leaderboard(coins) {
  const t3 = top(coins,'change24h',3);
  const headers = ['scoreboard:','today\'s top 3:','biggest 24h moves:','who\'s winning today:'];
  let t = `${pick(headers)}\n\n`;
  t3.forEach((c,i)=>{ t+=`${['🥇','🥈','🥉'][i]} $${c.symbol} ${fC(c.change24h)} — ${fV(c.volume)} vol\n`; });
  t += `\nlive data, 250+ coins tracked\n${CONFIG.SITE_URL}`;
  return t;
}

function tpl5_volumeAnomaly(coins) {
  const sp = coins.filter(c=>c.marketCap>0&&c.volume/c.marketCap>1).sort((a,b)=>(b.volume/b.marketCap)-(a.volume/a.marketCap));
  if (!sp.length) return tpl4_leaderboard(coins);
  const t3 = sp.slice(0,3);
  let t = `these coins have more 24h volume than their entire market cap\n\n`;
  t3.forEach(c=>{ t+=`$${c.symbol} — ${(c.volume/c.marketCap).toFixed(1)}x ratio\n`; });
  t += `\nunusual activity. worth investigating\n${CONFIG.SITE_URL}`;
  return t;
}

function tpl6_bleeders(coins) {
  const d = top(coins,'change24h',3,'a');
  const hooks = ['pain report:','who\'s getting rekt:','it\'s rough out here for:'];
  let t = `${pick(hooks)}\n\n`;
  d.forEach((c,i)=>{ t+=`${i+1}. $${c.symbol} ${fC(c.change24h)}\n`; });
  t += `\ndip or death spiral? check the contract first\n${CONFIG.SITE_URL}`;
  return t;
}

function tpl7_cipherpot(coins) {
  const hooks = [
    'friendly reminder: check the contract before you buy',
    'every rug pull starts with someone not checking the contract',
    'takes 5 seconds to scan. takes 5 months to recover from a rug',
    'the ape instinct is strong. CipherPot is stronger',
  ];
  return `${pick(hooks)}

CipherPot scans for honeypots, hidden taxes, mint authority & rug signals

ETH · BSC · Base · Solana

paste any CA → ${CONFIG.SITE_URL}`;
}

function tpl8_mood(coins) {
  const avg = coins.reduce((s,c)=>s+c.change24h,0)/coins.length;
  const bull = coins.filter(c=>c.change24h>5).length;
  const bear = coins.filter(c=>c.change24h<-5).length;
  const flat = coins.length-bull-bear;
  let vibe;
  if (avg>5) vibe='memes are eating today';
  else if (avg>0) vibe='cautiously optimistic';
  else if (avg>-5) vibe='choppy. no clear direction';
  else vibe='blood in the streets';
  return `market vibe: ${vibe}

${bull} pumping | ${flat} chilling | ${bear} dumping
avg change: ${fC(avg)}

track it all live → ${CONFIG.SITE_URL}`;
}

function tpl9_fact(coins) {
  const facts = [
    'CIPHER scans 250+ meme coins every 10 min. completely free, no signup',
    'CipherPot catches honeypots before you buy. paste any contract address',
    'the viral score uses real CoinGecko trending data, not random numbers',
    'you can search by contract address on CIPHER, not just ticker names',
    'CIPHER has no premium tier. no token. no paywall. just a free tool',
    'AI Decrypt gives you a raw breakdown of any meme coin in seconds',
    'coin of the day rotates through the top 10 most active coins daily',
  ];
  return `did you know?\n\n${pick(facts)}\n\n${CONFIG.SITE_URL}`;
}

function tpl10_snapshot(coins) {
  const green = coins.filter(c=>c.change24h>0).length;
  const pct = ((green/coins.length)*100).toFixed(0);
  const best = top(coins,'change24h',1)[0];
  const worst = top(coins,'change24h',1,'a')[0];
  return `${pct}% of meme coins are green right now

best: $${best.symbol} ${fC(best.change24h)}
worst: $${worst.symbol} ${fC(worst.change24h)}

live data on 250+ coins
${CONFIG.SITE_URL}`;
}

function tpl11_whales(coins) {
  const big = top(coins,'volume',3);
  let t = `follow the money\n\n`;
  big.forEach(c=>{ t+=`$${c.symbol} — ${fV(c.volume)} volume today\n`; });
  t += `\nbig volume = big interest. what you do with that is on you\n${CONFIG.SITE_URL}`;
  return t;
}

function tpl12_smallCap(coins) {
  const sm = coins.filter(c=>c.marketCap>100e3&&c.marketCap<5e6&&c.change24h>10);
  if (!sm.length) return tpl2_spotlight(coins);
  const c = pick(sm);
  return `low cap moving: $${c.symbol}

mcap: ${fV(c.marketCap)}
24h: ${fC(c.change24h)}
vol: ${fV(c.volume)}

early or a trap? always scan the contract
${CONFIG.SITE_URL}`;
}

function tpl13_wrap(coins) {
  const best = top(coins,'change24h',1)[0];
  const totalVol = coins.reduce((s,c)=>s+c.volume,0);
  const avg = coins.reduce((s,c)=>s+c.change24h,0)/coins.length;
  return `daily wrap

total volume scanned: ${fV(totalVol)}
avg move: ${fC(avg)}
mvp: $${best.symbol} ${fC(best.change24h)}

scanner runs 24/7. see you tomorrow
${CONFIG.SITE_URL}`;
}

function tpl14_quickHit(coins) {
  const c = pick(top(coins,'volume',10));
  const lines = [
    `$${c.symbol} doing ${fV(c.volume)} volume on ${fV(c.marketCap)} mcap. make of that what you will`,
    `watching $${c.symbol} at ${fP(c.price)}. ${c.change24h>0?'climbing':'dipping'}. ${fC(c.change24h)} today`,
    `$${c.symbol} — ${fV(c.volume)} vol, ${fC(c.change24h)} change. the chart is talking`,
  ];
  return `${pick(lines)}\n\n${cg(c)}\n${CONFIG.SITE_URL}`;
}

// ── Template pool & scheduling ──────────────
const TEMPLATES = [
  tpl1_gm, tpl2_spotlight, tpl3_sleepers, tpl4_leaderboard,
  tpl5_volumeAnomaly, tpl6_bleeders, tpl7_cipherpot, tpl8_mood,
  tpl9_fact, tpl10_snapshot, tpl11_whales, tpl12_smallCap,
  tpl13_wrap, tpl14_quickHit,
];

function getTemplate() {
  const now = new Date();
  const day = Math.floor((now - new Date(now.getFullYear(),0,0)) / 86400000);
  const hour = now.getUTCHours();
  // Each time slot on each day gets a different template
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
