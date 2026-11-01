'use strict';

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

function storageMode() {
  if (kvConfig()) return 'upstash';
  if (!process.env.VERCEL) return 'file';
  return 'unconfigured';
}

function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

function alertsReady() {
  const storageOk = storageMode() === 'upstash' || (storageMode() === 'file' && !process.env.VERCEL);
  return storageOk && emailConfigured();
}

function alertStatus() {
  const missing = [];
  if (storageMode() === 'unconfigured') missing.push('KV_REST_API_URL', 'KV_REST_API_TOKEN');
  if (!process.env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!process.env.RESEND_FROM) missing.push('RESEND_FROM');
  if (!process.env.CRON_SECRET) missing.push('CRON_SECRET');
  return {
    storage: storageMode(),
    email: emailConfigured(),
    cron: Boolean(process.env.CRON_SECRET),
    ready: alertsReady(),
    missing,
  };
}

module.exports = { kvConfig, storageMode, emailConfigured, alertsReady, alertStatus };
