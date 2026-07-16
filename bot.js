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
  return `${emoji} CIPHER Market Mood

${bull} green / ${bear} red
👑 $${top.symbol} ${fC(top.change24h)}
💀 $${bot.symbol} ${fC(bot.change24h)}

Is $${top.symbol} the play rn or overcooked? 👇

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

// ── Template pool & scheduling ──────────────
const TEMPLATES = [
  tpl01, tpl02, tpl03, tpl04, tpl05,
  tpl06, tpl07, tpl08, tpl09, tpl10,
  tpl11, tpl12, tpl13, tpl14, tpl15,
  tpl16, tpl17, tpl18, tpl19, tpl20,
  tpl21, tpl22, tpl23, tpl24,
];

// ══════════════════════════════════════════════
// ROOBET AFFILIATE TEMPLATES (8 per day)
// ══════════════════════════════════════════════

function roo01() {
  return `🎰 Zeus vs Hades. Gates of Olympus. Sweet Bonanza. Crash. Dice.

Roobet has every game that matters — all crypto, instant deposits & withdrawals.

Sign up with code "ctg"
→ roobet.com/?ref=ctg

🍀 Good luck out there`;
}

function roo02() {
  return `⚡ Why Roobet over other crypto casinos?

✅ Provably fair games
✅ Instant crypto withdrawals
✅ No KYC to start playing
✅ Originals you can't find anywhere else

Code: ctg
→ roobet.com/?ref=ctg`;
}

function roo03() {
  return `🎲 I hit a 10000x on Zeus vs Hades on Roobet

Yes, ten thousand X. Replay is pinned on my profile 📌

If you're playing anywhere else, you're missing out

Code "ctg" → roobet.com/?ref=ctg`;
}

function roo04() {
  const games = ['Zeus vs Hades ⚡', 'Gates of Olympus ⚡', 'Sugar Rush 🍭', 'Sweet Bonanza 🍬', 'Crash 📈', 'Mines 💣'];
  return `🎰 Tonight's rotation: ${pick(games)}

Roobet — the crypto casino CT actually uses

Instant deposits. Instant withdrawals. Provably fair.

Sign up with code "ctg"
→ roobet.com/?ref=ctg`;
}

function roo05() {
  return `💰 Deposit crypto. Play instantly. Withdraw instantly.

No banks. No waiting. No nonsense.

That's Roobet.

Code: ctg
→ roobet.com/?ref=ctg

🍀 Play smart, play responsibly`;
}

function roo06() {
  return `🎰 The slots hit different when you can withdraw in crypto seconds later

Roobet — BTC, ETH, SOL, LTC & more accepted

My code: ctg
→ roobet.com/?ref=ctg

May the RNG be with you 🍀`;
}

function roo07() {
  return `⚡ Real talk: I hit 10000x on Zeus vs Hades

Proof is pinned on my profile — full replay link 📌

Roobet is where I play. Code "ctg" if you want in

→ roobet.com/?ref=ctg`;
}

function roo08() {
  return `🎲 Weekend plans:

1. Check the CIPHER scanner 🔐
2. Take some profits
3. Spin a little on Roobet 🎰

Balance in all things.

Code: ctg
→ roobet.com/?ref=ctg`;
}

const ROOBET_TEMPLATES = [roo01, roo02, roo03, roo04, roo05, roo06, roo07, roo08];

// ── Scheduling ──────────────────────────────
// 16 slots/day: Roobet at 0,3,6,9,12,15,18,21 UTC · CIPHER at 1,4,7,10,13,16,19,22 UTC
const ROOBET_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

function getTemplate() {
  const now = new Date();
  const day = Math.floor((now - new Date(now.getFullYear(),0,0)) / 86400000);
  const hour = now.getUTCHours();
  
  if (ROOBET_HOURS.includes(hour)) {
    const idx = (day * 3 + hour) % ROOBET_TEMPLATES.length;
    return ROOBET_TEMPLATES[idx];
  }
  
  const idx = (day * 17 + hour * 11) % TEMPLATES.length;
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
    console.log(`\n--- (${tweet.length}/280) ---\n${tweet}\n---\n`);
    await postTweet(tweet);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

main();
