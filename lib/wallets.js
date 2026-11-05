'use strict';

// Edit this list to change Smart Money Watch.
// Every address here is a public ENS name, an explorer public name tag
// confirmed against Blockscout, a Solscan public name, or a wallet named
// in press as belonging to a public trader. No private individuals.

const WALLETS = [
  {
    id: 'vitalik',
    name: 'vitalik.eth',
    kind: 'notable',
    why: 'ENS vitalik.eth. The public Ethereum address, watched because it is public — not because a transfer is a recommendation.',
    chains: [{ chain: 'eth', address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' }],
  },
  {
    id: 'vitalik-vb2',
    name: 'vitalik.eth vb2',
    kind: 'notable',
    why: 'The long-public 0xAb58… Vitalik Buterin address used alongside vitalik.eth.',
    chains: [{ chain: 'eth', address: '0xab5801a7d398351b8be11c439e05c5b3259aec9b' }],
  },
  {
    id: 'vitalik-1db3',
    name: 'vitalik.eth 0x1db3',
    kind: 'notable',
    why: 'Another Vitalik Buterin address that has been public for years next to vitalik.eth.',
    chains: [{ chain: 'eth', address: '0x1db3439a222c519ab44bb1144fc28167b4fa6ee6' }],
  },
  {
    id: 'ef',
    name: 'Ethereum Foundation',
    kind: 'notable',
    why: 'The long-public Ethereum Foundation address 0xde0B…BAe. Foundation flow, not a trading desk.',
    chains: [{ chain: 'eth', address: '0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae' }],
  },
  {
    id: 'wintermute',
    name: 'Wintermute',
    kind: 'desk',
    why: 'Blockscout public name tag on this address: Wintermute. Market-making desk, so inflows are desk flow.',
    chains: [
      { chain: 'eth', address: '0xdbf5e9c5206d0db70a90108bf936da60221dc080' },
      { chain: 'base', address: '0xdbf5e9c5206d0db70a90108bf936da60221dc080' },
    ],
  },
  {
    id: 'jump',
    name: 'Jump Trading',
    kind: 'desk',
    why: 'Blockscout public name tag on this address: Jump Trading. Same address is watched on Base when that explorer answers.',
    chains: [
      { chain: 'eth', address: '0xf584f8728b874a6a5c7a8d4d387c9aae9172d621' },
      { chain: 'base', address: '0xf584f8728b874a6a5c7a8d4d387c9aae9172d621' },
    ],
  },
  {
    id: 'wintermute-sol',
    name: 'Wintermute SOL',
    kind: 'desk',
    why: 'Solscan public name: Wintermute hot wallet.',
    chains: [{ chain: 'sol', address: '44P5Ct5JkPz76Rs2K6juC65zXMpFRDrHatxcASJ4Dyra' }],
  },
  {
    id: 'ansem',
    name: 'Ansem',
    kind: 'trader',
    why: 'Solana wallet publicly tied to @blknoiz06 in press coverage of his trading. Activity is on-chain, not a signal from him.',
    chains: [{ chain: 'sol', address: 'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm' }],
  },
];

const IGNORE_SYMBOLS = new Set([
  'USDC', 'USDT', 'DAI', 'FDUSD', 'USDE', 'USD1', 'PYUSD', 'TUSD', 'FRAX', 'USDS',
  'BUSD', 'USDBC', 'USDbC', 'EURC', 'WETH', 'WBNB', 'WBTC', 'CBBTC', 'CBETH',
  'ETH', 'BNB', 'SOL', 'WSOL',
]);

const IGNORE_MINTS = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
]);

module.exports = { WALLETS, IGNORE_SYMBOLS, IGNORE_MINTS };
