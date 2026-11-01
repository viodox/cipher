'use strict';

const { createCache, fetchJson } = require('./http-util');
const { normalizeChain, canonicalAddress, validAddress } = require('./chains');

const cache = createCache(400);
const TTL_MS = 60 * 1000;

function asNum(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function on(value) {
  return value === '1' || value === 1 || value === true;
}

function taxPercent(value) {
  const n = asNum(value);
  if (n == null) return null;
  if (n < 0) return null;
  // GoPlus documents buy_tax/sell_tax as a fraction (0.05 = 5%).
  if (n <= 1) return Math.round(n * 1000) / 10;
  return Math.round(n * 10) / 10;
}

function percentFromFraction(value) {
  const n = asNum(value);
  if (n == null) return null;
  if (n <= 1) return Math.round(n * 1000) / 10;
  return Math.round(n * 10) / 10;
}

function isZeroAddress(addr) {
  return typeof addr === 'string' && /^0x0{40}$/i.test(addr);
}

function sumPercents(list, n) {
  if (!Array.isArray(list) || !list.length) return null;
  const slice = list.slice(0, n);
  let total = 0;
  let any = false;
  slice.forEach((row) => {
    const pct = percentFromFraction(row && (row.percent ?? row.pct));
    if (pct != null) { total += pct; any = true; }
  });
  return any ? Math.round(total * 10) / 10 : null;
}

function topPercent(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return percentFromFraction(list[0].percent ?? list[0].pct);
}

function emptyReport(chain, address) {
  return {
    ok: false,
    chain: chain.slug,
    chainName: chain.name,
    address,
    symbol: null,
    name: null,
    stamp: 'CAUTION',
    riskScore: null,
    buyTax: null,
    sellTax: null,
    liquidityUsd: null,
    holders: null,
    topHolderPct: null,
    top10Pct: null,
    reasons: [],
    sources: [],
    updatedAt: new Date().toISOString(),
    checks: {},
    error: 'no data',
  };
}

function applyGoPlusEvm(report, token) {
  if (!token || typeof token !== 'object') return;
  report.sources.push('GoPlus');
  report.name = report.name || token.token_name || null;
  report.symbol = report.symbol || token.token_symbol || null;
  if (report.buyTax == null) report.buyTax = taxPercent(token.buy_tax);
  if (report.sellTax == null) report.sellTax = taxPercent(token.sell_tax);
  if (report.holders == null && token.holder_count) report.holders = asNum(token.holder_count);
  if (report.topHolderPct == null) report.topHolderPct = topPercent(token.holders);
  if (report.top10Pct == null) report.top10Pct = sumPercents(token.holders, 10);
  if (report.liquidityUsd == null && Array.isArray(token.dex) && token.dex.length) {
    const liqs = token.dex.map((d) => asNum(d.liquidity)).filter((n) => n != null);
    if (liqs.length) report.liquidityUsd = Math.max(...liqs);
  }
  const owner = token.owner_address || '';
  report.checks.honeypot = report.checks.honeypot || on(token.is_honeypot);
  report.checks.cannotSellAll = on(token.cannot_sell_all);
  report.checks.mintable = on(token.is_mintable);
  report.checks.proxy = on(token.is_proxy);
  report.checks.blacklist = on(token.is_blacklisted);
  report.checks.ownerRenounced = isZeroAddress(owner) || owner === '';
  report.checks.ownerChangeBalance = on(token.owner_change_balance);
  report.checks.canTakeBackOwnership = on(token.can_take_back_ownership);
  report.checks.hiddenOwner = on(token.hidden_owner);
  report.checks.transferPausable = on(token.transfer_pausable);
}

function applyGoPlusSol(report, token) {
  if (!token || typeof token !== 'object') return;
  report.sources.push('GoPlus');
  const meta = token.metadata || {};
  report.name = report.name || meta.name || null;
  report.symbol = report.symbol || meta.symbol || null;
  if (report.holders == null) report.holders = asNum(token.holder_count);
  if (report.topHolderPct == null) report.topHolderPct = topPercent(token.holders);
  if (report.top10Pct == null) report.top10Pct = sumPercents(token.holders, 10);
  const fee = token.transfer_fee || {};
  if (report.sellTax == null && fee.current_fee_rate != null) {
    report.sellTax = taxPercent(fee.current_fee_rate);
  }
  report.checks.mintable = on(token.mintable && token.mintable.status);
  report.checks.freezable = on(token.freezable && token.freezable.status);
  report.checks.closable = on(token.closable && token.closable.status);
  report.checks.metadataMutable = on(token.metadata_mutable && token.metadata_mutable.status);
  report.checks.nonTransferable = on(token.non_transferable);
  report.checks.honeypot = report.checks.honeypot || report.checks.nonTransferable;
}

function applyHoneypot(report, data) {
  if (!data || !data.token) return;
  report.sources.push('honeypot.is');
  const token = data.token || {};
  const sim = data.simulationResult || {};
  const hp = data.honeypotResult || {};
  const pair = data.pair || {};
  report.name = report.name || token.name || null;
  report.symbol = report.symbol || token.symbol || null;
  if (sim.buyTax != null) report.buyTax = asNum(sim.buyTax);
  if (sim.sellTax != null) report.sellTax = asNum(sim.sellTax);
  if (pair.liquidity != null) report.liquidityUsd = asNum(pair.liquidity);
  if (token.totalHolders != null) report.holders = asNum(token.totalHolders);
  if (hp.isHoneypot) report.checks.honeypot = true;
  if (hp.honeypotReason) report.checks.honeypotReason = String(hp.honeypotReason).slice(0, 180);
}

function applyRugcheck(report, data) {
  if (!data || !data.tokenMeta) return;
  report.sources.push('RugCheck');
  report.name = report.name || data.tokenMeta.name || null;
  report.symbol = report.symbol || data.tokenMeta.symbol || null;
  if (data.totalMarketLiquidity != null) report.liquidityUsd = asNum(data.totalMarketLiquidity);
  const holders = data.topHolders || [];
  if (report.topHolderPct == null) report.topHolderPct = percentFromFraction(holders[0] && holders[0].pct);
  if (report.top10Pct == null) report.top10Pct = sumPercents(holders, 10);
  report.checks.rugged = !!data.rugged;
  report.checks.mintable = report.checks.mintable || !!data.mintAuthority;
  report.checks.freezable = report.checks.freezable || !!data.freezeAuthority;
  report.checks.rugcheckScore = asNum(data.score);
  if (Array.isArray(data.risks)) {
    report.checks.rugcheckRisks = data.risks.slice(0, 4).map((r) => r.name).filter(Boolean);
  }
}

function applyDex(report, data) {
  const pairs = data && Array.isArray(data.pairs) ? data.pairs : [];
  if (!pairs.length) return;
  report.sources.push('DexScreener');
  const best = [...pairs].sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0];
  if (!best) return;
  report.symbol = report.symbol || (best.baseToken && best.baseToken.symbol) || null;
  report.name = report.name || (best.baseToken && best.baseToken.name) || null;
  if (report.liquidityUsd == null && best.liquidity) report.liquidityUsd = asNum(best.liquidity.usd);
  report.checks.dexUrl = best.url || null;
}

function finalize(report) {
  const c = report.checks;
  const reasons = [];
  if (c.rugged) reasons.push('RugCheck marked this token as rugged');
  if (c.honeypot) reasons.push(c.honeypotReason || 'Sell simulation or GoPlus flagged a honeypot');
  if (c.cannotSellAll) reasons.push('GoPlus: cannot sell all (honeypot pattern)');
  if ((report.sellTax != null && report.sellTax >= 49) || (report.buyTax != null && report.buyTax >= 49)) {
    reasons.push('Extreme tax (49% or more)');
  } else if ((report.sellTax != null && report.sellTax > 10) || (report.buyTax != null && report.buyTax > 10)) {
    reasons.push('Tax above 10%');
  }
  if (c.mintable) reasons.push('Mint authority is still active');
  if (c.freezable) reasons.push('Freeze authority is still active');
  if (c.ownerChangeBalance) reasons.push('Owner can change balances');
  if (c.canTakeBackOwnership) reasons.push('Owner can take back ownership');
  if (c.hiddenOwner) reasons.push('Hidden owner');
  if (c.proxy) reasons.push('Proxy contract — implementation can change');
  if (c.blacklist && !c.ownerRenounced) reasons.push('Blacklist function with an active owner');
  else if (c.blacklist) reasons.push('Blacklist function present (owner looks renounced)');
  if (c.metadataMutable) reasons.push('Metadata is mutable');
  if (c.nonTransferable) reasons.push('Token is non-transferable');
  if (report.topHolderPct != null && report.topHolderPct >= 30) reasons.push('Top holder has ' + report.topHolderPct + '%');
  else if (report.top10Pct != null && report.top10Pct >= 70) reasons.push('Top 10 holders have ' + report.top10Pct + '%');
  if (c.rugcheckScore != null && c.rugcheckScore >= 5000) reasons.push('RugCheck score ' + c.rugcheckScore);
  if (Array.isArray(c.rugcheckRisks)) c.rugcheckRisks.forEach((name) => reasons.push(name));

  let score = 12;
  if (c.rugged || c.honeypot || c.cannotSellAll || c.nonTransferable) score += 70;
  if (report.sellTax != null && report.sellTax >= 49) score += 40;
  else if (report.sellTax != null && report.sellTax > 10) score += Math.min(30, report.sellTax);
  if (c.mintable) score += 22;
  if (c.freezable) score += 18;
  if (c.ownerChangeBalance) score += 24;
  if (c.canTakeBackOwnership) score += 16;
  if (c.hiddenOwner) score += 16;
  if (c.proxy && !c.ownerRenounced) score += 10;
  if (c.blacklist && !c.ownerRenounced) score += 12;
  if (report.topHolderPct != null && report.topHolderPct >= 30) score += 15;
  if (report.liquidityUsd != null && report.liquidityUsd < 2000) score += 12;
  report.riskScore = Math.max(1, Math.min(99, Math.round(score)));

  const danger = c.rugged || c.honeypot || c.cannotSellAll || c.nonTransferable || (report.sellTax != null && report.sellTax >= 49);
  const caution = reasons.some((r) => !/renounced\)$/.test(r) && !/^Blacklist function present/.test(r));
  if (c.rugged) report.stamp = 'RUGGED';
  else if (danger) report.stamp = 'HONEYPOT';
  else if (caution || report.riskScore >= 35) report.stamp = 'CAUTION';
  else report.stamp = 'CLEAN';

  report.reasons = [...new Set(reasons)].slice(0, 8);
  report.sources = [...new Set(report.sources)];
  report.ok = report.sources.length > 0;
  if (!report.symbol) report.symbol = report.address.slice(0, 4) + '…' + report.address.slice(-4);
  if (!report.name) report.name = 'Unknown token';
  report.updatedAt = new Date().toISOString();
  delete report.error;
  if (!report.ok) report.error = 'scanners returned no data';
  return report;
}

async function scanToken(chainInput, addressInput) {
  const chain = normalizeChain(chainInput);
  if (!chain) return { ok: false, error: 'unsupported chain', status: 400 };
  const address = canonicalAddress(chain, addressInput);
  if (!validAddress(chain, address)) return { ok: false, error: 'invalid address', status: 400, chain: chain.slug };

  const key = chain.slug + ':' + address;
  const hit = cache.get(key);
  if (hit) return hit;

  const report = emptyReport(chain, address);
  const dexUrl = 'https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(address);
  let primary;
  let goplus;
  let dex;
  if (chain.kind === 'evm') {
    [primary, goplus, dex] = await Promise.all([
      fetchJson('https://api.honeypot.is/v2/IsHoneypot?address=' + address + '&chainID=' + chain.id, 8000),
      fetchJson('https://api.gopluslabs.io/api/v1/token_security/' + chain.goplus + '?contract_addresses=' + address, 8000),
      fetchJson(dexUrl, 8000),
    ]);
    if (primary.json) applyHoneypot(report, primary.json);
    const map = goplus.json && goplus.json.result;
    if (map) applyGoPlusEvm(report, map[address] || map[address.toLowerCase()] || Object.values(map)[0]);
  } else {
    [primary, goplus, dex] = await Promise.all([
      fetchJson('https://api.rugcheck.xyz/v1/tokens/' + encodeURIComponent(address) + '/report', 8000),
      fetchJson('https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=' + encodeURIComponent(address), 8000),
      fetchJson(dexUrl, 8000),
    ]);
    if (primary.json) applyRugcheck(report, primary.json);
    const map = goplus.json && goplus.json.result;
    if (map) applyGoPlusSol(report, map[address] || Object.values(map)[0]);
  }
  if (dex.json) applyDex(report, dex.json);
  const done = finalize(report);
  if (done.ok) cache.set(key, done, TTL_MS);
  return done;
}

module.exports = { scanToken, TTL_MS };
