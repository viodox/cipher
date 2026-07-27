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
function fV(v) { return v>=1e9?`${(v/1e9).toFixed(1)}B`:v>=1e6?`${(v/1e6).toFixed(1)}M`:v>=1e3?`${(v/1e3).toFixed(0)}K`:`${v}`; }
function cg(c) { return `coingecko.com/en/coins/${c.cgId}`; }
function pick(a) { return a[Math.floor(Math.random()*a.length)]; }
function topN(c,k,n=3,d='d') { return [...c].sort((a,b)=>d==='d'?b[k]-a[k]:a[k]-b[k]).slice(0,n); }
function randCoins(coins,n) { return [...coins].sort(()=>Math.random()-.5).slice(0,n); }

// X API only allows 1 cashtag per tweet — keep the first $TICKER as cashtag, convert rest to #TICKER
function limitCashtags(text) {
  let found = false;
  return text.replace(/\$([A-Za-z\u4e00-\u9fff]{1,20})/g, (match, ticker) => {
    if (/^\d/.test(ticker)) return match;
    if (!found) { found = true; return match; }
    return '#' + ticker;
  });
}

// ══════════════════════════════════════════════
// 20 TICKER-HEAVY TWEET TEMPLATES
// ══════════════════════════════════════════════

// ── 1. DAILY SIGNAL ─────────────────────────
function tpl01(coins) {
  const top = topN(coins,'change24h',1)[0];
  const vol = topN(coins,'volume',1)[0];
  const hot = topN(coins,'change24h',5);
  return `🔐 CIPHER Daily Signal

📈 $${top.symbol} leading at ${fC(top.change24h)}
🔊 $${vol.symbol} doing ${fV(vol.volume)} in volume
👀 Also watching: $${hot[2].symbol} $${hot[3].symbol} $${hot[4].symbol}

🍯 Scan contracts → ${CONFIG.SITE_URL}`;
}

// ── 2. TOP 5 MOVERS ─────────────────────────
function tpl02(coins) {
  const top = topN(coins,'change24h',5);
  let t = `🔐 CIPHER Top 5 Movers\n\n`;
  top.forEach((c,i) => { t += `${['🥇','🥈','🥉','4️⃣','5️⃣'][i]} $${c.symbol} ${fC(c.change24h)}\n`; });
  t += `\nWhich $ticker are you holding? 👇\n\n🍯 ${CONFIG.SITE_URL}`;
  return t;
}

// ── 3. COIN SPOTLIGHT ───────────────────────
function tpl03(coins) {
  const c = pick(topN(coins,'volume',8));
  const peers = randCoins(coins.filter(x=>x.symbol!==c.symbol),3);
  return `🔐 CIPHER Spotlight: $${c.symbol} 🔍

💰 ${fP(c.price)} · ${fC(c.change24h)}
🔊 ${fV(c.volume)} volume
💎 MCap: ${fV(c.marketCap)}

Also on radar: $${peers[0].symbol} $${peers[1].symbol} $${peers[2].symbol}

Bullish or nah? 👇

🍯 ${CONFIG.SITE_URL}`;
}

// ── 4. MEME COIN ROLLERCOASTER ──────────────
function tpl04(coins) {
  const tops = topN(coins,'change24h',3);
  const bots = topN(coins,'change24h',3,'a');
  return `⚡ CIPHER Meme Coin Rollercoaster

🚀 Pumping:
$${tops[0].symbol} ${fC(tops[0].change24h)} | $${tops[1].symbol} ${fC(tops[1].change24h)} | $${tops[2].symbol} ${fC(tops[2].change24h)}

📉 Dumping:
$${bots[0].symbol} ${fC(bots[0].change24h)} | $${bots[1].symbol} ${fC(bots[1].change24h)} | $${bots[2].symbol} ${fC(bots[2].change24h)}

Which side are you on? 👇

🔐 ${CONFIG.SITE_URL}`;
}

// ── 5. TICKER WALL ──────────────────────────
function tpl05(coins) {
  const green = coins.filter(c=>c.change24h>0).sort((a,b)=>b.change24h-a.change24h).slice(0,8);
  let tickers = green.map(c=>`$${c.symbol}`).join(' ');
  return `🟢 CIPHER Green Board\n\n${tickers}\n\nAll green in the last 24h ✅\n\nDrop your favorite $ticker from this list 👇\n\n🔐 ${CONFIG.SITE_URL}`;
}

// ── 6. VOLUME KINGS ─────────────────────────
function tpl06(coins) {
  const top = topN(coins,'volume',5);
  let t = `🐋 CIPHER Volume Kings\n\n💰 Where the money is flowing today:\n\n`;
  top.forEach((c,i) => { t += `${i+1}. $${c.symbol} — ${fV(c.volume)}\n`; });
  t += `\n$${top[0].symbol} eating everyone\'s lunch rn 🍽️\n\n🔐 ${CONFIG.SITE_URL}`;
  return t;
}

// ── 7. MARKET MOOD ──────────────────────────
function tpl07(coins) {
  const avg = coins.reduce((s,c)=>s+c.change24h,0)/coins.length;
  const bull = coins.filter(c=>c.change24h>0).length;
  const bear = coins.length-bull;
  const top = topN(coins,'change24h',1)[0];
  const bot = topN(coins,'change24h',1,'a')[0];
  const emoji = avg>5?'🟢':avg>0?'🟡':avg>-5?'🟠':'🔴';
  const headers = ['CIPHER Market Mood', 'CIPHER Mood Check', 'Market Vibes 📡', 'Where we at rn', 'CIPHER Read'];
  const cta = [
    `Is $${top.symbol} the play rn or overcooked? 👇`,
    `You buying $${top.symbol} at these levels? 👇`,
    `Is $${top.symbol} still early or too late? 👇`,
    `Would you touch $${top.symbol} here? 👇`,
    `Fading $${top.symbol} or riding it? 👇`,
  ];
  return `${emoji} ${pick(headers)}

${bull} green / ${bear} red · Avg: ${fC(avg)}
👑 $${top.symbol} ${fC(top.change24h)}
💀 $${bot.symbol} ${fC(bot.change24h)}

${pick(cta)}

🔐 ${CONFIG.SITE_URL}`;
}

// ── 8. CIPHERPOT PROMO ──────────────────────
function tpl08(coins) {
  const c = pick(topN(coins,'change24h',5));
  const hooks = [
    `$${c.symbol} is pumping ${fC(c.change24h)} — but is the contract safe?\n\n5 seconds on CipherPot and you\'ll know 🍯`,
    `Before you ape into $${c.symbol} or any meme coin — scan the contract first\n\nFree. Takes 5 seconds. Saves your bag 🍯`,
    `$${c.symbol} doing numbers today. But have you checked the contract?\n\nPaste any CA into CipherPot → instant rug scan 🍯`,
  ];
  return `${pick(hooks)}\n\n✅ Honeypot detection\n✅ Hidden taxes\n✅ Mint authority\n\nETH · BSC · Base · Solana\n\n${CONFIG.SITE_URL}`;
}

// ── 9. VOLUME ANOMALY ───────────────────────
function tpl09(coins) {
  const spikes = coins.filter(c=>c.marketCap>0&&c.volume/c.marketCap>1).sort((a,b)=>(b.volume/b.marketCap)-(a.volume/a.marketCap));
  if (!spikes.length) return tpl06(coins);
  let t = `🚨 CIPHER Volume Alert\n\n`;
  spikes.slice(0,4).forEach(c => { t += `$${c.symbol} — ${(c.volume/c.marketCap).toFixed(1)}x vol/mcap 🔥\n`; });
  t += `\n$${spikes[0].symbol} has more 24h volume than its entire market cap\n\nSomething brewing 👀\n\n🔐 ${CONFIG.SITE_URL}`;
  return t;
}

// ── 10. THIS OR THAT ────────────────────────
function tpl10(coins) {
  const pool = topN(coins,'volume',10);
  const a = pool[Math.floor(Math.random()*5)];
  let b = pool[5+Math.floor(Math.random()*5)];
  if (!b) b = pool[1];
  return `🔐 CIPHER — Pick One

$${a.symbol} (${fC(a.change24h)}) 🆚 $${b.symbol} (${fC(b.change24h)})

Reply with your pick 👇

Check both → ${CONFIG.SITE_URL}`;
}

// ── 11. SMALL CAP RADAR ─────────────────────
function tpl11(coins) {
  const small = coins.filter(c=>c.marketCap>100e3&&c.marketCap<5e6&&c.change24h>5);
  if (small.length<2) return tpl03(coins);
  const picks = small.sort((a,b)=>b.change24h-a.change24h).slice(0,4);
  let t = `🔐 CIPHER Low Cap Radar 🔍\n\n`;
  picks.forEach(c => { t += `$${c.symbol} — ${fV(c.marketCap)} mcap, ${fC(c.change24h)} 📈\n`; });
  t += `\nLow cap szn? Or just noise?\n\nScan contracts first 🍯\n${CONFIG.SITE_URL}`;
  return t;
}

// ── 12. SLEEPER WATCH ───────────────────────
function tpl12(coins) {
  const s = coins.filter(c=>Math.abs(c.change24h)<3&&c.volume>1e6);
  if (s.length<3) return tpl07(coins);
  const picks = s.sort(()=>Math.random()-.5).slice(0,4);
  let t = `👀 CIPHER Sleeper Watch\n\nFlat price. Real volume. 🤔\n\n`;
  picks.forEach(c => { t += `$${c.symbol} — ${fV(c.volume)} vol\n`; });
  t += `\nWhich $ticker wakes up first? 👇\n\n📌 Save this\n${CONFIG.SITE_URL}`;
  return t;
}

// ── 13. HOT TAKES ───────────────────────────
function tpl13(coins) {
  const top = topN(coins,'change24h',3);
  const vol = topN(coins,'volume',1)[0];
  const takes = [
    `$${top[0].symbol} ${fC(top[0].change24h)} today and most of you missed it\n\nCIPHER had it on the scanner all morning 🔐\n\n${CONFIG.SITE_URL}`,
    `Your friend: "bro just buy $${pick(topN(coins,'volume',5)).symbol}"\n\nCipherPot: "honeypot risk detected"\n\nWho you listening to? 🍯\n\n${CONFIG.SITE_URL}`,
    `$${top[0].symbol} $${top[1].symbol} $${top[2].symbol} all pumping today\n\nBut did you check the contracts? 🍯\n\nFree scanner → ${CONFIG.SITE_URL}`,
    `POV: $${vol.symbol} doing ${fV(vol.volume)} in volume and you\'re not tracking it\n\nCIPHER scans 500+ meme coins live. Free.\n\n🔐 ${CONFIG.SITE_URL}`,
    `Meme coin season is not about finding pumps\n\nIt\'s about avoiding rugs\n\n$${top[0].symbol} $${top[1].symbol} $${top[2].symbol} are moving — but are they safe?\n\n🍯 ${CONFIG.SITE_URL}`,
  ];
  return pick(takes);
}

// ── 14. WHAT ARE YOU BUYING ─────────────────
function tpl14(coins) {
  const hot = topN(coins,'change24h',6);
  return `🔐 CIPHER Check-In\n\nWhat are you buying today?\n\n$${hot[0].symbol} · $${hot[1].symbol} · $${hot[2].symbol} · $${hot[3].symbol} · $${hot[4].symbol} · $${hot[5].symbol}\n\nOr something else? Drop your $ticker 👇\n\n${CONFIG.SITE_URL}`;
}

// ── 15. DAILY WRAP ──────────────────────────
function tpl15(coins) {
  const best = topN(coins,'change24h',1)[0];
  const worst = topN(coins,'change24h',1,'a')[0];
  const vol = topN(coins,'volume',1)[0];
  return `🔐 CIPHER Daily Wrap\n\n🏆 MVP: $${best.symbol} ${fC(best.change24h)}\n💀 Rekt: $${worst.symbol} ${fC(worst.change24h)}\n🐋 Vol king: $${vol.symbol} (${fV(vol.volume)})\n\nDid you hold $${best.symbol} today? 👇\n\n${CONFIG.SITE_URL}`;
}

// ── 16. RAPID FIRE ──────────────────────────
function tpl16(coins) {
  const r = randCoins(topN(coins,'volume',15),6);
  return `🔐 CIPHER Rapid Fire\n\n$${r[0].symbol} — ${fC(r[0].change24h)}\n$${r[1].symbol} — ${fC(r[1].change24h)}\n$${r[2].symbol} — ${fC(r[2].change24h)}\n$${r[3].symbol} — ${fC(r[3].change24h)}\n$${r[4].symbol} — ${fC(r[4].change24h)}\n$${r[5].symbol} — ${fC(r[5].change24h)}\n\nWhich ones are you in? 👇\n\n🍯 ${CONFIG.SITE_URL}`;
}

// ── 17. MEME COIN WISDOM ────────────────────
function tpl17(coins) {
  const top = topN(coins,'change24h',3);
  const wisdom = [
    `Meme coin checklist before aping:\n\n✅ Check $ticker on CIPHER\n✅ Read the AI Decrypt report\n✅ Scan contract on CipherPot\n✅ Check top holders\n❌ Trust random CT calls\n\n$${top[0].symbol} $${top[1].symbol} $${top[2].symbol} are moving — did you check?`,
    `$${top[0].symbol} is up ${fC(top[0].change24h)} today\n\nThe people who caught it early?\n\nThey were watching the volume spike on CIPHER before CT even noticed 📡`,
    `Every meme coin looks like a 100x until you check the contract\n\n$${top[0].symbol} $${top[1].symbol} $${top[2].symbol} all pumping\n\nBut only CipherPot tells you if they\'re safe 🍯`,
  ];
  return `🔐 ${pick(wisdom)}\n\n${CONFIG.SITE_URL}`;
}

// ── 18. COMMUNITY ENGAGEMENT ────────────────
function tpl18(coins) {
  const top = topN(coins,'change24h',1)[0];
  const shouts = [
    `Drop your best meme coin play this week\n\nMost liked reply gets a CIPHER shoutout 🔐\n\n$${top.symbol} is leading the board at ${fC(top.change24h)}\n\n${CONFIG.SITE_URL}`,
    `What $ticker are you most bullish on rn?\n\nWe\'ll scan the top reply on CipherPot live 🍯\n\n${CONFIG.SITE_URL}`,
    `Reply with a $ticker and we\'ll tell you what CIPHER sees 👀\n\n500+ meme coins tracked live\n\n${CONFIG.SITE_URL}`,
    `RT if you\'ve dodged a rug pull by scanning the contract first 🫡\n\nIf you haven\'t started:\n🍯 ${CONFIG.SITE_URL}`,
  ];
  return `🔐 ${pick(shouts)}`;
}

// ── 19. DID YOU KNOW ────────────────────────
function tpl19(coins) {
  const hot = topN(coins,'change24h',3);
  const facts = [
    `CIPHER scans 500+ meme coins including $${hot[0].symbol} $${hot[1].symbol} $${hot[2].symbol} and updates every 10 min\n\nCompletely free. No signup. No paywall.`,
    `CipherPot has caught honeypots on coins that looked legit on the surface\n\nPaste any CA → instant scan\n\nETH · BSC · Base · Solana`,
    `$${hot[0].symbol} is up ${fC(hot[0].change24h)} today\n\nCIPHER\'s viral score flagged unusual volume before the pump 📡\n\nReal signals. Not vibes.`,
    `You can search $${hot[0].symbol} $${hot[1].symbol} or any coin by contract address on CIPHER\n\nNot just ticker names. Paste any CA and get a full breakdown.`,
  ];
  return `🔐 Did you know?\n\n${pick(facts)}\n\n${CONFIG.SITE_URL}`;
}

// ── 20. ALPHA DROP ──────────────────────────
function tpl20(coins) {
  const top = topN(coins,'change24h',5);
  const vol = topN(coins,'volume',3);
  return `🔐 CIPHER Alpha Drop\n\n🔥 Hottest: $${top[0].symbol} ${fC(top[0].change24h)}\n📈 Runner up: $${top[1].symbol} ${fC(top[1].change24h)}\n🐋 Volume: $${vol[0].symbol} (${fV(vol[0].volume)})\n👀 Watch: $${top[3].symbol} $${top[4].symbol}\n\nAll verified on CoinGecko ✅\n\n🍯 ${CONFIG.SITE_URL}`;
}

// ── 21-24. ROBINHOOD CHAIN / RWA COMMENTARY ──
function tpl21(coins) {
  const takes = [
    `Robinhood launched their own chain and tokenized stocks trade 24/7 now\n\nNVDA, AAPL, GOOG — on-chain, usable as DeFi collateral\n\nTradFi and crypto are merging in real time 👀\n\nMeme coins won\'t be the only thing on-chain anymore`,
    `Stocks that trade 24/7 on-chain. Lending pools for NVDA tokens. AI agents trading equities.\n\nThat\'s not a prediction — Robinhood Chain is live rn\n\nThe on-chain economy is getting bigger every week 🔐`,
    `Robinhood Chain did 4M transactions in its first week\n\nTokenized stocks are the fastest growing RWA segment\n\nCrypto rails are winning. The scanner stays busy 🔐`,
  ];
  return `${pick(takes)}\n\n${CONFIG.SITE_URL}`;
}

function tpl22(coins) {
  const top = topN(coins,'change24h',1)[0];
  return `⚡ On-chain now: tokenized NVDA, AAPL & GOOG trading 24/7 on Robinhood Chain

Meanwhile in meme land: $${top.symbol} up ${fC(top.change24h)}

Two very different corners of crypto. Same blockchain rails 🔐

${CONFIG.SITE_URL}`;
}

function tpl23(coins) {
  return `Heads up: Robinhood\'s Stock Tokens are NOT available in the US

And they\'re debt securities — you don\'t get shareholder rights, just price exposure

Always read the fine print. On stocks AND meme coins 🔍

That\'s why we scan contracts → ${CONFIG.SITE_URL}`;
}

function tpl24(coins) {
  const top = topN(coins,'change24h',3);
  return `The RWA market just crossed $30B

BlackRock has tokenized treasuries. Robinhood has tokenized stocks. Coinbase is next.

Institutions are on-chain. Are you still not checking contracts before you buy?

🍯 ${CONFIG.SITE_URL}`;
}

// ── 25-26. SIGNAL FEED TERMINAL HYPE ────────
function tpl25(coins) {
  const spikes = coins.filter(c => c.marketCap > 0 && c.volume/c.marketCap > 1).sort((a,b)=>(b.volume/b.marketCap)-(a.volume/a.marketCap));
  const example = spikes[0] || topN(coins,'change24h',1)[0];
  return `📡 We just shipped the Signal Feed — a live market terminal on CIPHER

Real-time alerts:
⚡ Volume spikes
🚀 Pump detects
🚨 Risk flags
🐋 Whale moves

Right now flagging: $${example.symbol}

See the feed live 👇
${CONFIG.SITE_URL}`;
}

function tpl26(coins) {
  const top = topN(coins,'change24h',1)[0];
  return `🔐 NEW on CIPHER — the Signal Feed

It's a live terminal ticking out market events in real time. Volume spikes, pumps, risk flags, whale volume — all clickable, all straight from the data.

Watching $${top.symbol} bag ${fC(top.change24h)} rn 👀

📡 ${CONFIG.SITE_URL}`;
}

// ── 27-28. DAILY PREDICTION + STREAK HYPE ────
function tpl27(coins) {
  const top = topN(coins,'change24h',3);
  return `🎯 NEW on CIPHER — Daily Prediction Game

Every day we pick 3 coins going into 24h.
You pick the one you think will pump the most.
Come back tomorrow and see if you were right.

Correct picks build your streak 🔥
Miss a day → streak resets.

Today's contenders include $${top[0].symbol}, ${top[1].symbol.toUpperCase()}, ${top[2].symbol.toUpperCase()} 👀

📡 ${CONFIG.SITE_URL}`;
}

function tpl28(coins) {
  const top = topN(coins,'change24h',1)[0];
  return `🔥 What's your CIPHER streak?

Daily prediction. Pick 1 of 3 coins. Right = streak++
Wrong = streak resets to 0.

The all-time pick rate on your profile is the flex.

Today: $${top.symbol} is one of the movers to beat at ${fC(top.change24h)}

🎯 Lock in your pick → ${CONFIG.SITE_URL}`;
}

// ── Template pool & scheduling ──────────────
const TEMPLATES = [
  tpl01, tpl02, tpl03, tpl04, tpl05,
  tpl06, tpl07, tpl08, tpl09, tpl10,
  tpl11, tpl12, tpl13, tpl14, tpl15,
  tpl16, tpl17, tpl18, tpl19, tpl20,
  tpl21, tpl22, tpl23, tpl24, tpl25, tpl26,
  tpl27, tpl28,
];

// ══════════════════════════════════════════════
// ROOBET AFFILIATE TEMPLATES (10 rotating templates)
// ══════════════════════════════════════════════

function roo01() {
  return `💰 Use my code "ctg" on Roobet and stack extra value from day one

Sign up → deposit → play with more
→ roobet.com/?ref=ctg

🎰 Don't leave free money on the table`;
}

function roo02() {
  const amounts = ['$1,000', '$2,500', '$5,000', '$10,000', '$25,000', '$50,000'];
  return `💰 People are winning ${pick(amounts)} on Roobet using code "ctg"

Same code. Same games. Could be your turn.

→ roobet.com/?ref=ctg

🚀 Sign up and go get it`;
}

function roo03() {
  return `🎰 Signing up with code "ctg" is the smart way to start on Roobet

More perks. More value. Same shot at big wins.

→ roobet.com/?ref=ctg

💰 Why start with less?`;
}

function roo04() {
  return `💸 Reminder: use code "ctg" when you join Roobet

It's the difference between starting flat and starting ahead

→ roobet.com/?ref=ctg

🎰 Stack every edge you can get`;
}

function roo05() {
  return `💰 Code "ctg" on Roobet = extra value on your signup

Deposit crypto, play instantly, cash out in seconds
No banks. No delays. No leaving money behind.

→ roobet.com/?ref=ctg

🚀 Let's get you set up`;
}

function roo06() {
  const wins = ['$4,200', '$8,700', '$15,000', '$32,000', '$67,000', '$140,000'];
  return `🚨 Someone just cashed out ${pick(wins)} on Roobet

They signed up. They played. They won.

Use code "ctg" and get in the game
→ roobet.com/?ref=ctg

💰 Extra value for using the code`;
}

function roo07() {
  return `⚡ Why sign up under code "ctg" on Roobet:

💰 Extra value on your signup
⚡ Instant crypto payouts
🎰 Same shot at life-changing wins
📌 I've hit 10,000x here — proof pinned

→ roobet.com/?ref=ctg`;
}

function roo08() {
  return `💰 Don't sign up for Roobet without code "ctg"

You'd be leaving free value on the table.

Code "ctg" → roobet.com/?ref=ctg

🎰 Start ahead, not behind`;
}

function roo09() {
  return `🎰 Use code "ctg" — I did, and I hit 10,000x on Roobet

$10 turned into $100,000. Proof pinned 📌

Sign up under the code and chase yours
→ roobet.com/?ref=ctg

💰 The code costs nothing, the upside is everything`;
}

function roo10() {
  return `🚨 Winning extra on Roobet starts with one thing: code "ctg"

Sign up with it. Deposit. Play with more value than you'd get otherwise.

→ roobet.com/?ref=ctg

💰 Smart degens use the code`;
}

function roo11() {
  return `🎰 The move: sign up on Roobet with code "ctg"

Instant crypto deposits. Instant payouts. Extra value for using the code.

→ roobet.com/?ref=ctg

💰 No reason not to`;
}

function roo12() {
  const amounts = ['$3,000', '$7,500', '$18,000', '$40,000', '$90,000'];
  return `💰 Latest Roobet winner just pulled ${pick(amounts)}

They used a code. You should too.

Code "ctg" → roobet.com/?ref=ctg

🚀 Get your edge`;
}

function roo13() {
  return `⚡ Crypto in. Crypto out. Instantly.

That's Roobet — and code "ctg" gets you extra value on the way in.

→ roobet.com/?ref=ctg

💰 Start smarter`;
}

function roo14() {
  return `🎰 Smart degens don't sign up raw

Code "ctg" on Roobet = more value from your first deposit

→ roobet.com/?ref=ctg

💰 Play the game right`;
}

function roo15() {
  return `🚨 If you're joining Roobet anyway, use code "ctg"

Same signup. More value. Zero downside.

→ roobet.com/?ref=ctg

💰 Free edge, take it`;
}

function roo16() {
  return `💰 I run everything through Roobet — deposits, spins, payouts

Sign up under code "ctg" and stack the same value I do
→ roobet.com/?ref=ctg

🎰 Let's eat`;
}

function roo17() {
  const wins = ['$5,500', '$11,000', '$28,000', '$54,000', '$120,000'];
  return `🎰 ${pick(wins)} just hit on Roobet 👀

The winners keep coming. The code stays the same: "ctg"

→ roobet.com/?ref=ctg

💰 Join the run`;
}

function roo18() {
  return `⚡ Roobet payouts hit your wallet in seconds — not days

Sign up with code "ctg" for extra value
→ roobet.com/?ref=ctg

💰 Fast money, done right`;
}

function roo19() {
  return `🎰 Code "ctg" is your Roobet cheat code

Extra value. Instant crypto. Real wins.

→ roobet.com/?ref=ctg

💰 Use it or lose the edge`;
}

function roo20() {
  return `🚨 Last call reminder: code "ctg" on Roobet

Sign up, deposit, play with more than you'd have otherwise

→ roobet.com/?ref=ctg

💰 Don't sleep on free value`;
}

const ROOBET_TEMPLATES = [roo01, roo02, roo03, roo04, roo05, roo06, roo07, roo08, roo09, roo10, roo11, roo12, roo13, roo14, roo15, roo16, roo17, roo18, roo19, roo20];

// ── Scheduling ──────────────────────────────
// 16 slots/day: 10 Roobet + 6 CIPHER
// Roobet at :17 past 0,2,4,6,8,12,14,16,20,22 UTC
// CIPHER at :47 past 1,5,10,13,18,23 UTC
const ROOBET_HOURS = [0, 2, 4, 6, 8, 12, 14, 16, 20, 22];
const CIPHER_HOURS = [1, 5, 10, 13, 18, 23];

function getTemplate() {
  const now = new Date();
  const day = Math.floor((now - new Date(now.getFullYear(),0,0)) / 86400000);
  const hour = now.getUTCHours();

  if (ROOBET_HOURS.includes(hour)) {
    const slotIndex = ROOBET_HOURS.indexOf(hour);
    // Shift start template by day so day 1 starts at different roo than day 0
    const idx = (slotIndex + day) % ROOBET_TEMPLATES.length;
    return ROOBET_TEMPLATES[idx];
  }

  const slotIndex = CIPHER_HOURS.indexOf(hour);
  // If somehow off-schedule, fall back to random
  if (slotIndex === -1) return TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  // Shift by day so consecutive days rotate through different template subsets
  const idx = (slotIndex * 3 + day * 5) % TEMPLATES.length;
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
    const fn = getTemplate();
    console.log(`📝 Template: ${fn.name}`);
    
    let tweet;
    if (fn.name.startsWith('roo')) {
      tweet = fn();
    } else {
      const coins = await fetchMemeCoins();
      console.log(`📊 ${coins.length} coins loaded`);
      tweet = fn(coins);
      tweet = limitCashtags(tweet);
    }
    
    if (tweet.length > 280) tweet = tweet.substring(0, 277) + '...';
    // Add invisible zero-width variation so identical templates never look identical
    // (X's duplicate detection blocks near-identical text within 24-48h)
    const now = new Date();
    const stamp = now.getUTCHours().toString(36) + now.getUTCDate().toString(36);
    // Use invisible characters that don't render but make text unique
    const zwsp = '\u200B'.repeat((now.getUTCHours() % 3) + 1);
    tweet = tweet.replace(/🔐 https/, `🔐${zwsp} https`);
    console.log(`\n--- (${tweet.length}/280) ---\n${tweet}\n---\n`);
    await postTweet(tweet);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

main();
