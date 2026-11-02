'use strict';

const CHAINS = {
  eth: { slug: 'eth', id: '1', name: 'Ethereum', goplus: '1', kind: 'evm' },
  '1': null,
  bsc: { slug: 'bsc', id: '56', name: 'BSC', goplus: '56', kind: 'evm' },
  '56': null,
  base: { slug: 'base', id: '8453', name: 'Base', goplus: '8453', kind: 'evm' },
  '8453': null,
  arb: { slug: 'arb', id: '42161', name: 'Arbitrum', goplus: '42161', kind: 'evm' },
  '42161': null,
  sol: { slug: 'sol', id: 'sol', name: 'Solana', goplus: 'solana', kind: 'sol' },
  solana: null,
};

CHAINS['1'] = CHAINS.eth;
CHAINS['56'] = CHAINS.bsc;
CHAINS['8453'] = CHAINS.base;
CHAINS['42161'] = CHAINS.arb;
CHAINS.solana = CHAINS.sol;

const DEX_TO_SLUG = {
  ethereum: 'eth',
  eth: 'eth',
  bsc: 'bsc',
  base: 'base',
  arbitrum: 'arb',
  solana: 'sol',
  sol: 'sol',
};

function normalizeChain(input) {
  const key = String(input || '').trim().toLowerCase();
  return CHAINS[key] || null;
}

function chainFromDex(chainId) {
  const slug = DEX_TO_SLUG[String(chainId || '').toLowerCase()];
  return slug ? CHAINS[slug] : null;
}

function canonicalAddress(chain, address) {
  const raw = String(address || '').trim();
  if (chain.kind === 'evm') return raw.toLowerCase();
  return raw;
}

function validAddress(chain, address) {
  if (!address) return false;
  if (chain.kind === 'evm') return /^0x[a-f0-9]{40}$/.test(address);
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

const CHAIN_LIST = ['eth', 'bsc', 'base', 'arb', 'sol'].map((slug) => CHAINS[slug]);

module.exports = { CHAINS, CHAIN_LIST, normalizeChain, chainFromDex, canonicalAddress, validAddress };
