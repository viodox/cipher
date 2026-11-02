'use strict';

const LETTERS = [
  [97, 'A+'], [93, 'A'], [90, 'A-'],
  [87, 'B+'], [83, 'B'], [80, 'B-'],
  [77, 'C+'], [73, 'C'], [70, 'C-'],
  [67, 'D+'], [63, 'D'], [60, 'D-'],
];

const VERDICTS = {
  honeypot: [
    'GoPlus says these tokens cannot be sold. The grade stops at F.',
    'A sell check came back blocked. That is an automatic F.',
    'The security feed marked this contract as a honeypot. F, no further debate.',
    'Cannot-sell is set. The receipt ends at F.',
  ],
  mintable: [
    'Mint authority is still on. New supply can be created.',
    'Someone can still mint more of this token.',
    'The mint switch has not been turned off.',
    'GoPlus marks this token mintable.',
  ],
  owner: [
    'The owner address is still set. It is not the zero address.',
    'Contract ownership has not been renounced.',
    'An owner wallet is still on the record.',
    'Ownership was not sent to the burn address.',
  ],
  tax: [
    'Buy or sell tax is above 10 percent.',
    'The tax line is over the 10 percent mark.',
    'A trade tax above 10 percent is on this receipt.',
    'GoPlus or the pool reports a tax higher than 10 percent.',
  ],
  liquidity: [
    'Pool liquidity is under $10,000.',
    'The deepest pool we found is below $10k.',
    'There is not $10,000 of liquidity on the best pool.',
    'Liquidity on the receipt is under ten thousand dollars.',
  ],
  lp: [
    'Most of the LP tokens are not locked and not burned.',
    'LP is neither locked nor sent to a burn address.',
    'The liquidity tokens look unlocked.',
    'We did not find a lock or burn on the majority of LP.',
  ],
  holders: [
    'The top 10 holders own more than half the supply.',
    'Top 10 wallets hold over 50 percent.',
    'Holder concentration is above 50 percent for the top 10.',
    'More than half the supply sits in ten wallets.',
  ],
  age: [
    'The pool is younger than 24 hours.',
    'This pair was created less than a day ago.',
    'Age on the receipt is under 24 hours.',
    'The market is not a day old yet.',
  ],
  dump: [
    'Price is down more than 50 percent in 24 hours.',
    'The 24 hour change is worse than minus 50 percent.',
    'Today’s move is a drop past 50 percent.',
    'DexScreener shows a 24 hour drop steeper than 50 percent.',
  ],
};

function letterFromScore(score, autoF) {
  if (autoF) return 'F';
  const value = Number(score);
  for (const [min, letter] of LETTERS) {
    if (value >= min) return letter;
  }
  return 'F';
}

function hashString(text) {
  let h = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickLine(seed, lines) {
  return lines[hashString(seed) % lines.length];
}

function isBuyGrade(letter) {
  return letter.charAt(0) === 'A' || letter.charAt(0) === 'B';
}

function isSkipGrade(letter) {
  return letter.charAt(0) === 'D' || letter === 'F';
}

function letterColor(letter) {
  const head = String(letter || '').charAt(0);
  if (head === 'A') return '#00ff99';
  if (head === 'B') return '#00e5ff';
  if (head === 'C') return '#ffb400';
  if (head === 'D') return '#ff7a45';
  return '#ff3355';
}

function gradeFacts(facts, seed) {
  const src = facts || {};
  const checks = [];
  let score = 100;
  let autoF = false;

  function add(id, label, status, detail, penalty) {
    checks.push({ id, label, status, detail: detail || '' });
    if (status === 'fail' && penalty) score -= penalty;
  }

  const honeypot = src.honeypot;
  if (honeypot == null) add('honeypot', 'Can it be sold?', 'unknown', 'No honeypot field on this pass.');
  else if (honeypot) {
    autoF = true;
    score -= 100;
    add('honeypot', 'Can it be sold?', 'fail', 'Honeypot or cannot-sell flag is on.', 0);
  } else add('honeypot', 'Can it be sold?', 'pass', 'No honeypot or cannot-sell flag.');

  if (src.mintable == null) add('mintable', 'Mint authority', 'unknown', 'Mint status was not in the feed.');
  else if (src.mintable) add('mintable', 'Mint authority', 'fail', 'Minting is still enabled.', 25);
  else add('mintable', 'Mint authority', 'pass', 'Mint authority is off.');

  if (src.ownerRenounced == null) add('owner', 'Owner renounced', 'unknown', 'Owner address was not in the feed.');
  else if (!src.ownerRenounced) add('owner', 'Owner renounced', 'fail', 'Owner is still set.', 10);
  else add('owner', 'Owner renounced', 'pass', 'Owner is the zero address or there is no mint authority.');

  const buy = src.buyTax;
  const sell = src.sellTax;
  const taxDetail = 'Buy ' + (buy == null ? 'unknown' : buy + '%') + ' · sell ' + (sell == null ? 'unknown' : sell + '%') + '.';
  if (buy == null && sell == null) add('tax', 'Buy / sell tax', 'unknown', 'Tax was not reported.');
  else if ((buy != null && buy > 10) || (sell != null && sell > 10)) add('tax', 'Buy / sell tax', 'fail', taxDetail, 20);
  else if (buy == null || sell == null) add('tax', 'Buy / sell tax', 'unknown', taxDetail);
  else add('tax', 'Buy / sell tax', 'pass', taxDetail);

  if (src.liquidityUsd == null) add('liquidity', 'Liquidity', 'unknown', 'No pool liquidity figure.');
  else if (src.liquidityUsd < 10000) add('liquidity', 'Liquidity', 'fail', 'Best pool is under $10,000.', 20);
  else add('liquidity', 'Liquidity', 'pass', 'Best pool is at least $10,000.');

  if (src.lpLockedOrBurned == null) add('lp', 'LP locked or burned', 'unknown', 'LP holder list was missing.');
  else if (!src.lpLockedOrBurned) add('lp', 'LP locked or burned', 'fail', 'Majority of LP is not locked or burned.', 15);
  else add('lp', 'LP locked or burned', 'pass', 'At least half the LP is locked or burned.');

  if (src.top10Pct == null) add('holders', 'Top 10 holders', 'unknown', 'Holder list was missing.');
  else if (src.top10Pct > 50) add('holders', 'Top 10 holders', 'fail', 'Top 10 hold ' + src.top10Pct + '%.', 15);
  else add('holders', 'Top 10 holders', 'pass', 'Top 10 hold ' + src.top10Pct + '%.');

  if (src.ageHours == null) add('age', 'Pool age', 'unknown', 'Pair creation time was missing.');
  else if (src.ageHours < 24) add('age', 'Pool age', 'fail', 'Pool is ' + Math.max(0, Math.round(src.ageHours)) + ' hours old.', 10);
  else add('age', 'Pool age', 'pass', 'Pool is older than 24 hours.');

  if (src.change24h == null) add('dump', '24h change', 'unknown', '24h change was missing.');
  else if (src.change24h < -50) add('dump', '24h change', 'fail', '24h change is ' + src.change24h + '%.', 10);
  else add('dump', '24h change', 'pass', '24h change is ' + src.change24h + '%.');

  if (score < 0) score = 0;
  const letter = letterFromScore(score, autoF);
  const verdicts = [];
  checks.forEach((check) => {
    if (check.status !== 'fail') return;
    const lines = VERDICTS[check.id];
    if (!lines) return;
    verdicts.push(pickLine(String(seed || '') + '|' + check.id, lines));
  });
  if (!verdicts.length) {
    verdicts.push(pickLine(String(seed || '') + '|clean', [
      'None of the receipt checks failed. Missing lines stayed unknown instead of being filled in.',
      'The checks we could read all passed. Unknown means the feed did not say.',
      'No failed row on this receipt. That is the data, not a price call.',
      'Clean receipt on the fields that came back. Unknowns were left blank.',
    ]));
  }
  return { score, letter, autoF, checks, verdicts };
}

module.exports = {
  LETTERS,
  letterFromScore,
  gradeFacts,
  hashString,
  isBuyGrade,
  isSkipGrade,
  letterColor,
};
