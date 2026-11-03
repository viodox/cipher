'use strict';

const { kvConfig } = require('./alerts-ready');

const TTL_SEC = 40 * 24 * 60 * 60;
const UA_KEEP = 20;
const FETCH_MS = 800;

// Daily counters for America/New_York. Human is a browser that executed the
// grade page and posted /api/ape-view with x-cipher-view: 1. Bot is a direct
// /api/check lookup, a grade-page fetch that is not a browser navigation, or
// a hit on /api/ape-view without that header. Nothing is blocked.
const BOT_UA = /(bot\b|crawler|spider|slurp|facebookexternalhit|embedly|pinterest|vkshare|whatsapp|telegrambot|discordbot|slackbot|linkedinbot|headless|phantomjs|wget\/|curl\/|python-requests|python-urllib|go-http-client|java\/|okhttp|axios\/|node-fetch|undici|scrapy|httpclient|libwww|semrush|ahrefs|petalbot|bytespider|gptbot|claudebot|amazonbot|bingbot|googlebot|yandex|duckduckbot|baiduspider|applebot|ia_archiver|pingdom|uptimerobot|lighthouse|pagespeed|chrome-lighthouse|httpx|fasthttp|aiohttp|libcurl|postmanruntime|insomnia)/i;

function header(req, name) {
  const headers = (req && req.headers) || {};
  const value = headers[name] != null ? headers[name] : headers[name.toLowerCase()];
  if (Array.isArray(value)) return value.join(', ');
  return value == null ? '' : String(value);
}

function nyDay(input) {
  const date = input instanceof Date ? input : new Date(input == null ? Date.now() : input);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function humanKey(day) {
  return 'ape:check:human:' + day;
}

function botKey(day) {
  return 'ape:check:bot:' + day;
}

function botUaKey(day) {
  return 'ape:check:bot-ua:' + day;
}

function userAgentLabel(req) {
  const raw = header(req, 'user-agent').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return '(none)';
  return raw.length > 180 ? raw.slice(0, 180) : raw;
}

function looksLikeBrowser(ua) {
  return /Mozilla\/5\.0/.test(ua) && /(Chrome|Safari|Firefox|Edg)\/\d/.test(ua) && !BOT_UA.test(ua);
}

function classifyApeLookup(req, channel) {
  const flagged = header(req, 'x-cipher-view') === '1';
  if (channel === 'view' || channel === 'api') return flagged ? 'human' : 'bot';
  if (flagged) return 'skip';
  const ua = header(req, 'user-agent');
  const dest = header(req, 'sec-fetch-dest');
  const mode = header(req, 'sec-fetch-mode');
  const accept = header(req, 'accept');
  const referer = header(req, 'referer') || header(req, 'referrer');
  if (!ua || BOT_UA.test(ua)) return 'bot';
  // A typed URL or bookmark has no referrer, but browsers send a document navigation.
  if (dest === 'document' || mode === 'navigate') return 'skip';
  if (!referer) return 'bot';
  if (looksLikeBrowser(ua) && /text\/html/i.test(accept)) return 'skip';
  return 'bot';
}

async function redisPipeline(commands) {
  const cfg = kvConfig();
  if (!cfg || !commands.length) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(cfg.url + '/pipeline', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        authorization: 'Bearer ' + cfg.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    return res.ok;
  } catch (err) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function recordApeHit(req, bucket, now) {
  if (bucket !== 'human' && bucket !== 'bot') return false;
  const cfg = kvConfig();
  if (!cfg) return false;
  const day = nyDay(now);
  if (bucket === 'human') {
    return redisPipeline([
      ['INCR', humanKey(day)],
      ['EXPIRE', humanKey(day), String(TTL_SEC)],
    ]);
  }
  // Rank 0 is the lowest score. 0 .. -(keep+1) drops everything below the top keep.
  return redisPipeline([
    ['INCR', botKey(day)],
    ['EXPIRE', botKey(day), String(TTL_SEC)],
    ['ZINCRBY', botUaKey(day), '1', userAgentLabel(req)],
    ['EXPIRE', botUaKey(day), String(TTL_SEC)],
    ['ZREMRANGEBYRANK', botUaKey(day), '0', String(-(UA_KEEP + 1))],
  ]);
}

async function noteApeLookup(req, channel, now) {
  try {
    const bucket = classifyApeLookup(req, channel);
    if (bucket === 'skip') return null;
    await recordApeHit(req, bucket, now);
    return bucket;
  } catch (err) {
    return null;
  }
}

module.exports = {
  TTL_SEC,
  UA_KEEP,
  humanKey,
  botKey,
  botUaKey,
  nyDay,
  classifyApeLookup,
  userAgentLabel,
  recordApeHit,
  noteApeLookup,
};
