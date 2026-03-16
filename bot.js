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
  SITE_URL: "ciphersignal.xyz",
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
      price: c.item.data?.price || 0,
      change24h: c.item.data?.price_change_percentage_24h?.usd || 0,
      volume: parseFloat(c.item.data?.total_volume || "0"),
      marketCap: parseFloat(c.item.data?.market_cap || "0"),
    }));
  }

  return coins.map((c) => ({
    name: c.name,
    symbol: c.symbol.toUpperCase(),
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

// ── Tweet Templates ─────────────────────────
function buildDailySignal(coins) {
  const topGainer = coins.reduce((a, b) => (a.change24h > b.change24h ? a : b));
  const topVolume = coins.reduce((a, b) => (a.volume > b.volume ? a : b));
  const topLoser = coins.reduce((a, b) => (a.change24h < b.change24h ? a : b));

  return `🔐 CIPHER Daily Signal

📈 Top Gainer: $${topGainer.symbol} ${formatChange(topGainer.change24h)}
🔊 Most Volume: $${topVolume.symbol} (${formatVolume(topVolume.volume)})
📉 Biggest Dip: $${topLoser.symbol} ${formatChange(topLoser.change24h)}

🤖 AI verdict on $${topGainer.symbol}: ${getRating(topGainer.change24h)}

dyor → ${CONFIG.SITE_URL}`;
}

function buildTopMovers(coins) {
  const sorted = [...coins].sort((a, b) => b.change24h - a.change24h);
  const top5 = sorted.slice(0, 5);

  let tweet = `🔐 CIPHER Top 5 Movers (24h)\n\n`;
  top5.forEach((c, i) => {
    const emoji = c.change24h >= 0 ? "🟢" : "🔴";
    tweet += `${i + 1}. ${emoji} $${c.symbol} ${formatChange(c.change24h)} (${formatPrice(c.price)})\n`;
  });
  tweet += `\nscan all 150+ coins free → ${CONFIG.SITE_URL}`;
  return tweet;
}

function buildSpotlight(coins) {
  const sorted = [...coins].sort((a, b) => b.volume - a.volume);
  const coin = sorted[Math.floor(Math.random() * Math.min(5, sorted.length))];

  return `🔍 CIPHER Coin Spotlight: $${coin.symbol}

💰 Price: ${formatPrice(coin.price)}
📊 24h: ${formatChange(coin.change24h)}
🔊 Volume: ${formatVolume(coin.volume)}
🏦 MCap: ${formatVolume(coin.marketCap)}

🤖 Signal: ${getRating(coin.change24h)}

decrypt any coin free → ${CONFIG.SITE_URL}`;
}

function buildRugAlert(coins) {
  const volatile = coins.filter((c) => c.change24h <= -10 || c.change24h >= 50);

  if (volatile.length === 0) {
    return `🍯 CIPHER Rug Radar

All clear — no extreme movers detected in the last 24h.

Stay safe. Scan contracts before you ape → ${CONFIG.SITE_URL}`;
  }

  let tweet = `🍯 CIPHER Rug Radar\n\n⚠️ Extreme movers detected:\n`;
  volatile.slice(0, 4).forEach((c) => {
    const emoji = c.change24h >= 50 ? "🚀" : "💀";
    tweet += `${emoji} $${c.symbol} ${formatChange(c.change24h)}\n`;
  });
  tweet += `\nAlways scan before you ape → ${CONFIG.SITE_URL}`;
  return tweet;
}

function buildWeeklyRecap(coins) {
  const totalVolume = coins.reduce((sum, c) => sum + c.volume, 0);
  const avgChange = coins.reduce((sum, c) => sum + c.change24h, 0) / coins.length;
  const bullish = coins.filter((c) => c.change24h > 0).length;
  const bearish = coins.filter((c) => c.change24h <= 0).length;
  const topCoin = coins.reduce((a, b) => (a.change24h > b.change24h ? a : b));

  return `🔐 CIPHER Weekly Pulse

📊 Market: ${bullish} bullish / ${bearish} bearish
🔊 Total Volume: ${formatVolume(totalVolume)}
📈 Avg Move: ${formatChange(avgChange)}
👑 Top Performer: $${topCoin.symbol} ${formatChange(topCoin.change24h)}

intelligence is free → ${CONFIG.SITE_URL}`;
}

// ── Template Rotation ───────────────────────
const TEMPLATES = [
  { name: "Daily Signal", builder: buildDailySignal },
  { name: "Top 5 Movers", builder: buildTopMovers },
  { name: "Coin Spotlight", builder: buildSpotlight },
  { name: "Rug Radar", builder: buildRugAlert },
  { name: "Weekly Pulse", builder: buildWeeklyRecap },
];

function getTodaysTemplate() {
  // Rotate through templates based on day of year
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const index = dayOfYear % TEMPLATES.length;
  return TEMPLATES[index];
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

    // Pick template
    const template = getTodaysTemplate();
    console.log(`📝 Template: ${template.name}`);

    // Build tweet
    const tweet = template.builder(coins);
    console.log(`\n--- Tweet Preview ---\n${tweet}\n--- End Preview ---\n`);

    // Check length
    if (tweet.length > 280) {
      console.error(`❌ Tweet too long (${tweet.length}/280). Trimming...`);
      // Fallback to a shorter template
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
