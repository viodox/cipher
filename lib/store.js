'use strict';

const { kvConfig } = require('./alerts-ready');

async function redisCmd(args) {
  const cfg = kvConfig();
  if (!cfg) return { ok: false, reason: 'no-redis' };
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + cfg.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (err) { json = null; }
    if (!res.ok || !json || json.error) return { ok: false, status: res.status };
    return { ok: true, result: json.result };
  } catch (err) {
    return { ok: false, reason: 'network' };
  }
}

async function cacheGet(key) {
  const res = await redisCmd(['GET', key]);
  if (!res.ok || res.result == null || res.result === '') return null;
  try { return JSON.parse(res.result); } catch (err) { return null; }
}

async function cacheSet(key, value, ttlSec) {
  const ttl = Math.max(1, Math.round(Number(ttlSec) || 60));
  return redisCmd(['SET', key, JSON.stringify(value), 'EX', String(ttl)]);
}

module.exports = { redisCmd, cacheGet, cacheSet };
