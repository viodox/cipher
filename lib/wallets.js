'use strict';

// Edit this list to change Smart Money Watch.
// Every address here is a public ENS name, an explorer public name tag
// confirmed against Blockscout or Etherscan, a Solscan public name, or a
// wallet named in press as belonging to a public trader. No private
// individuals, no exchange deposit wallets, and no labels that are only
// a cluster guess.
//
// Desk addresses were checked against public explorers on 10 Nov 2026.
// Wintermute 4, Jump, both Cumberland tags, B2C2, FalconX, and Galaxy
// Digital each had multiple non-stable ERC-20 inflows that day. The
// previous Wintermute tag 0xdbf5…dc080 last received an ERC-20 on
// 19 Oct 2026, so Ethereum and Base now follow Wintermute 4.

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
    why: 'Etherscan public name tag Wintermute 4, and the same Blockscout name tag with wintermute.com on it, for 0xf819…73aa. That hot wallet was receiving non-stable tokens on Ethereum and Base on 10 Nov 2026. The older public tag 0xdbf5…dc080 last received an ERC-20 on 19 Oct 2026. Desk inventory, not a buy.',
    chains: [
      { chain: 'eth', address: '0xf8191d98ae98d2f7abdfb63a9b0b812b93c873aa' },
      { chain: 'base', address: '0xf8191d98ae98d2f7abdfb63a9b0b812b93c873aa' },
    ],
  },
  {
    id: 'jump',
    name: 'Jump Trading',
    kind: 'desk',
    why: 'Blockscout public name tag Jump Trading, with jumptrading.com on the tag. Ethereum inflows were still landing on 10 Nov 2026. The same address on Base had no ERC-20 transfer for weeks, so Base is not watched. Desk inventory, not a buy.',
    chains: [
      { chain: 'eth', address: '0xf584f8728b874a6a5c7a8d4d387c9aae9172d621' },
    ],
  },
  {
    id: 'cumberland',
    name: 'Cumberland',
    kind: 'desk',
    why: 'Etherscan and Blockscout public name tag: Cumberland: 0x87b…Dda. Several non-stable ERC-20 inflows on 10 Nov 2026 (AAVE, UNI, LINK, SHIB among them). Desk inventory, not a buy.',
    chains: [{ chain: 'eth', address: '0x87b49a99cbce4a9030e67919b776aa97d538adda' }],
  },
  {
    id: 'cumberland-2',
    name: 'Cumberland 2',
    kind: 'desk',
    why: 'Blockscout public name tag Cumberland: 0xad6…862. Etherscan titles the same address with that public name. Multiple non-stable inflows in the week of 10 Nov 2026. Desk inventory, not a buy.',
    chains: [{ chain: 'eth', address: '0xad6eaa735d9df3d7696fd03984379dae02ed8862' }],
  },
  {
    id: 'b2c2',
    name: 'B2C2',
    kind: 'desk',
    why: 'Blockscout public name tag B2C2 Group 1, with b2c2.com on the tag. Multiple non-stable ERC-20 inflows on 10 Nov 2026, including AAVE, QNT, and PEPE. Desk inventory, not a buy.',
    chains: [{ chain: 'eth', address: '0xc333e80ef2dec2805f239e3f1e810612d294f771' }],
  },
  {
    id: 'falconx',
    name: 'FalconX',
    kind: 'desk',
    why: 'Blockscout public name tag FalconX: 0x115…101, with falconx.io on the tag. Non-stable ERC-20 inflows on 10 Nov 2026 included EIGEN, QNT, and LINK. This is the firm hot wallet, not a client deposit address. Desk inventory, not a buy.',
    chains: [{ chain: 'eth', address: '0x1157a2076b9bb22a85cc2c162f20fab3898f4101' }],
  },
  {
    id: 'galaxy',
    name: 'Galaxy Digital',
    kind: 'desk',
    why: 'Blockscout public name tag Galaxy Digital: 0x579…9a7, with galaxy.com on the tag. Non-stable ERC-20 inflows on 10 Nov 2026 included LINK, UNI, AAVE, and ENA. Firm flow, not a buy.',
    chains: [{ chain: 'eth', address: '0x5797f722b1fee36e3d2c3481d938d1372bcd99a7' }],
  },
  {
    id: 'wintermute-sol',
    name: 'Wintermute SOL',
    kind: 'desk',
    why: 'Solscan public name: Wintermute hot wallet. The account was signing on 10 Nov 2026. Desk inventory, not a buy.',
    chains: [{ chain: 'sol', address: '44P5Ct5JkPz76Rs2K6juC65zXMpFRDrHatxcASJ4Dyra' }],
  },
  {
    id: 'wintermute-sol-bot',
    name: 'Wintermute SOL bot',
    kind: 'desk',
    why: 'Solscan public name: Wintermute Automated Liquidity Bot. On 10 Nov 2026 the account was signing transactions that increased non-stable SPL balances. Desk inventory, not a buy.',
    chains: [{ chain: 'sol', address: 'MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa' }],
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
