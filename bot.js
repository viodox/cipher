// ============================================
// CIPHER X Bot — Automated Daily Tweets
// ============================================
// Posts daily meme coin signals to @ciphersignal_
// Pulls live data from CoinGecko, formats into
// rotating tweet templates, posts via X API v2
// ============================================

const crypto = require("crypto");
const https = require("https");

// ── Config ──────────────────────────────────
const CONFIG = {
  // X API Credentials (set these as environment variables)
  API_KEY: process.env.X_API_KEY,
  API_KEY_SECRET: process.env.X_API_KEY_SECRET,
  ACCESS_TOKEN: process.env.X_ACCESS_TOKEN,
  ACCESS_TOKEN_SECRET: process.env.X_ACCESS_TOKEN_SECRET,

  // CoinGecko
  COINGECKO_URL:
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=meme-token&order=volume_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h",

  // Site
  SITE_URL: "https://www.ciphersignal.xyz",
};

// ── HTTP helpers (zero dependencies) ────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Accept: "application/json", "User-Agent": "CipherBot/1.0" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── OAuth 1.0a Signature ────────────────────
function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function generateOAuthSignature(method, url, params, consumerSecret, tokenSecret) {
  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");

  const baseString = `${method}&${percentEncode(url)}&${percentEncode(sortedParams)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;

  return crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");
}

function getOAuthHeader(method, url) {
  const oauthParams = {
    oauth_consumer_key: CONFIG.API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: CONFIG.ACCESS_TOKEN,
    oauth_version: "1.0",
  };

  const signature = generateOAuthSignature(method, url, oauthParams, CONFIG.API_KEY_SECRET, CONFIG.ACCESS_TOKEN_SECRET);

  oauthParams.oauth_signature = signature;

  const header = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${header}`;
}

// ── Post Tweet ──────────────────────────────
async function postTweet(text) {
  const url = "https://api.twitter.com/2/tweets";
  const body = JSON.stringify({ text });

  const options = {
    hostname: "api.twitter.com",
    path: "/2/tweets",
    method: "POST",
    headers: {
      Authorization: getOAuthHeader("POST", url),
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const res = await httpsRequest(options, body);

  if (res.status === 201) {
    console.log(`✅ Tweet posted: ${res.body.data.id}`);
    return res.body;
  } else {
    console.error(`❌ Tweet failed (${res.status}):`, JSON.stringify(res.body));
    throw new Error(`Tweet failed: ${res.status}`);
  }
}

// ── Fetch Coin Data ─────────────────────────
async function fetchMemeCoins() {
  console.log("📡 Fetching meme coin data from CoinGecko...");
  const response = await httpsGet(CONFIG.COINGECKO_URL);

  // Handle CoinGecko returning an error object instead of array
  const coins = Array.isArray(response) ? response : [];

  if (coins.length === 0) {
    // Fallback: try the trending endpoint
    console.log("⚠️ Primary endpoint failed, trying trending...");
    const trending = await httpsGet("https://api.coingecko.com/api/v3/search/trending");
    const trendingCoins = trending.coins || [];

    if (trendingCoins.length === 0) {
      throw new Error("Could not fetch coin data from any endpoint");
    }

    return trendingCoins.map((c) => ({
      name: c.item.name,
      symbol: c.item.symbol.toUpperCase(),
      cgId: c.item.id,
      price: c.item.data?.price || 0,
      change24h: c.item.data?.price_change_percentage_24h?.usd || 0,
      volume: parseFloat(c.item.data?.total_volume || "0"),
      marketCap: parseFloat(c.item.data?.market_cap || "0"),
    }));
  }

  return coins.map((c) => ({
    name: c.name,
    symbol: c.symbol.toUpperCase(),
    cgId: c.id,
    price: c.current_price,
    change24h: c.price_change_percentage_24h || 0,
    volume: c.total_volume,
    marketCap: c.market_cap,
  }));
}

// ── Format Helpers ──────────────────────────
function formatPrice(price) {
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.001) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(8)}`;
}

function formatChange(change) {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

function formatVolume(vol) {
  if (vol >= 1e9) return `$${(vol / 1e9).toFixed(1)}B`;
  if (vol >= 1e6) return `$${(vol / 1e6).toFixed(1)}M`;
  if (vol >= 1e3) return `$${(vol / 1e3).toFixed(0)}K`;
  return `$${vol}`;
}

function getRating(change) {
  if (change >= 20) return "SEND IT";
  if (change >= 5) return "BULLISH";
  if (change >= -5) return "WAIT";
  if (change >= -15) return "BEARISH";
  return "NGMI";
}

function cgLink(coin) {
  return `coingecko.com/en/coins/${coin.cgId}`;
}

// ── Tweet Templates ─────────────────────────

// MORNING — Daily overview
function buildDailySignal(coins) {
  const topGainer = coins.reduce((a, b) => (a.change24h > b.change24h ? a : b));
  const topVolume = coins.reduce((a, b) => (a.volume > b.volume ? a : b));

  return `🔐 CIPHER Daily Signal

📈 Top Gainer: $${topGainer.symbol} ${formatChange(topGainer.change24h)}
↳ ${cgLink(topGainer)}
🔊 Most Volume: $${topVolume.symbol} (${formatVolume(topVolume.volume)})

🤖 Verdict: ${getRating(topGainer.change24h)}

🍯 Scan before you ape → ${CONFIG.SITE_URL}`;
}

// MIDDAY — Top movers
function buildTopMovers(coins) {
  const sorted = [...coins].sort((a, b) => b.change24h - a.change24h);
  const top3 = sorted.slice(0, 3);

  let tweet = `🔐 CIPHER Top 3 Movers (24h)\n\n`;
  top3.forEach((c, i) => {
    const emoji = c.change24h >= 0 ? "🟢" : "🔴";
    tweet += `${i + 1}. ${emoji} $${c.symbol} ${formatChange(c.change24h)}\n↳ ${cgLink(c)}\n`;
  });
  tweet += `\n🍯 Scan contracts → ${CONFIG.SITE_URL}`;
  return tweet;
}

// AFTERNOON — Spotlight on a single coin
function buildSpotlight(coins) {
  const sorted = [...coins].sort((a, b) => b.volume - a.volume);
  const coin = sorted[Math.floor(Math.random() * Math.min(5, sorted.length))];

  return `🔍 CIPHER Spotlight: $${coin.symbol}

💰 ${formatPrice(coin.price)} · 📊 ${formatChange(coin.change24h)}
🔊 Vol: ${formatVolume(coin.volume)} · MCap: ${formatVolume(coin.marketCap)}
🤖 Signal: ${getRating(coin.change24h)}

✅ Verify → ${cgLink(coin)}
🍯 Scan contract → ${CONFIG.SITE_URL}`;
}

// EVENING — Volatility alert
function buildRugAlert(coins) {
  const volatile = coins.filter((c) => c.change24h <= -10 || c.change24h >= 50);

  if (volatile.length === 0) {
    return `⚡ CIPHER Volatility Alert

All clear — no extreme movers in 24h.

Stay safe ser. Scan any contract free → ${CONFIG.SITE_URL}`;
  }

  let tweet = `⚡ CIPHER Volatility Alert\n\n🔔 Big movers:\n`;
  volatile.slice(0, 3).forEach((c) => {
    const emoji = c.change24h >= 50 ? "📈" : "📉";
    tweet += `${emoji} $${c.symbol} ${formatChange(c.change24h)}\n↳ ${cgLink(c)}\n`;
  });
  tweet += `\nScan before you ape → ${CONFIG.SITE_URL}`;
  return tweet;
}

// BONUS — Biggest loser / dip alert
function buildDipAlert(coins) {
  const sorted = [...coins].sort((a, b) => a.change24h - b.change24h);
  const top3 = sorted.slice(0, 3);

  let tweet = `📉 CIPHER Dip Radar\n\n`;
  top3.forEach((c, i) => {
    tweet += `${i + 1}. 🔴 $${c.symbol} ${formatChange(c.change24h)}\n↳ ${cgLink(c)}\n`;
  });
  tweet += `\nVerify before you buy → ${CONFIG.SITE_URL}`;
  return tweet;
}

// BONUS — Volume leaders
function buildVolumeAlert(coins) {
  const sorted = [...coins].sort((a, b) => b.volume - a.volume);
  const top3 = sorted.slice(0, 3);

  let tweet = `🔊 CIPHER Volume Watch\n\n`;
  top3.forEach((c, i) => {
    tweet += `${i + 1}. $${c.symbol} — ${formatVolume(c.volume)} vol\n↳ ${cgLink(c)}\n`;
  });
  tweet += `\n🍯 Scan contracts → ${CONFIG.SITE_URL}`;
  return tweet;
}

// BONUS — Market pulse
function buildMarketPulse(coins) {
  const avgChange = coins.reduce((sum, c) => sum + c.change24h, 0) / coins.length;
  const bullish = coins.filter((c) => c.change24h > 0).length;
  const bearish = coins.filter((c) => c.change24h <= 0).length;
  const topCoin = coins.reduce((a, b) => (a.change24h > b.change24h ? a : b));

  return `🔐 CIPHER Market Pulse

📊 ${bullish} bullish / ${bearish} bearish
📈 Avg: ${formatChange(avgChange)}
👑 Top: $${topCoin.symbol} ${formatChange(topCoin.change24h)}
↳ ${cgLink(topCoin)}

🍯 Scan any contract → ${CONFIG.SITE_URL}`;
}

// BONUS — CipherPot promo
function buildCipherPotPromo(coins) {
  const topGainer = coins.reduce((a, b) => (a.change24h > b.change24h ? a : b));
  return `🍯 Don't ape blind

Paste any contract address into CipherPot and scan for honeypots, taxes & rug signals instantly.

Supports ETH · BSC · Base · Solana

Today's top mover: $${topGainer.symbol} ${formatChange(topGainer.change24h)}
↳ ${cgLink(topGainer)}

Scan free → ${CONFIG.SITE_URL}`;
}

// ── Schedule: 8 posts per day, no repeats ───
// Each hour gets a pool of templates it picks from
// based on the day, so no two posts in one day are the same
const SCHEDULE = {
  early: [buildDailySignal, buildMarketPulse],
  morning: [buildTopMovers, buildDailySignal],
  midday: [buildSpotlight, buildVolumeAlert],
  earlyAfternoon: [buildDipAlert, buildMarketPulse],
  afternoon: [buildTopMovers, buildCipherPotPromo],
  evening: [buildRugAlert, buildSpotlight],
  night: [buildVolumeAlert, buildDipAlert],
  lateNight: [buildMarketPulse, buildCipherPotPromo],
};

function getTemplateForSlot(slot) {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const pool = SCHEDULE[slot];
  const index = dayOfYear % pool.length;
  return pool[index];
}

function getCurrentSlot() {
  const hour = new Date().getUTCHours();
  // 12 UTC = 7am EST, 14 = 9am, 16 = 11am, 18 = 1pm, 20 = 3pm, 22 = 5pm, 0 = 7pm, 2 = 9pm
  if (hour <= 13) return "early";
  if (hour <= 15) return "morning";
  if (hour <= 17) return "midday";
  if (hour <= 19) return "earlyAfternoon";
  if (hour <= 21) return "afternoon";
  if (hour <= 23) return "evening";
  if (hour <= 1) return "night";
  return "lateNight";
}

// ── Main ────────────────────────────────────
async function main() {
  // Validate credentials
  const missing = [];
  if (!CONFIG.API_KEY) missing.push("X_API_KEY");
  if (!CONFIG.API_KEY_SECRET) missing.push("X_API_KEY_SECRET");
  if (!CONFIG.ACCESS_TOKEN) missing.push("X_ACCESS_TOKEN");
  if (!CONFIG.ACCESS_TOKEN_SECRET) missing.push("X_ACCESS_TOKEN_SECRET");

  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(", ")}`);
    console.error("Set them in your .env file or hosting platform.");
    process.exit(1);
  }

  try {
    // Fetch data
    const coins = await fetchMemeCoins();
    console.log(`📊 Loaded ${coins.length} meme coins`);

    // Pick template based on time slot
    const slot = getCurrentSlot();
    const templateFn = getTemplateForSlot(slot);
    console.log(`⏰ Slot: ${slot} | Template: ${templateFn.name}`);

    // Build tweet
    const tweet = templateFn(coins);
    console.log(`\n--- Tweet Preview ---\n${tweet}\n--- End Preview ---\n`);

    // Check length
    if (tweet.length > 280) {
      console.error(`❌ Tweet too long (${tweet.length}/280). Using fallback...`);
      const fallback = buildDailySignal(coins);
      await postTweet(fallback.substring(0, 280));
    } else {
      console.log(`📏 Length: ${tweet.length}/280`);
      await postTweet(tweet);
    }
  } catch (err) {
    console.error("❌ Bot error:", err.message);
    process.exit(1);
  }
}

// Run
main();
