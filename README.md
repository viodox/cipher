# CIPHER

Free meme coin scanner for CoinGecko meme-token markets plus live GeckoTerminal and DexScreener pools, including tokens CoinGecko has not listed. Signal scores are formulas, not an AI model.

## Where this is deployed

`https://www.ciphersignal.xyz` is **this repository**, served by **Vercel** (project alias `cipher-two-alpha.vercel.app`, also set as the GitHub homepage field).

Checked against production on 1 Nov 2026:

- `www.ciphersignal.xyz` index HTML matched `index.html` in this repo byte for byte (SHA-256).
- Response headers are `server: Vercel` with `x-vercel-cache` / `x-vercel-id`. There is no `cf-ray`.
- DNS nameservers are Cloudflare (`elliot.ns.cloudflare.com`, `athena.ns.cloudflare.com`), but the records are DNS-only: apex `A` `216.198.79.1`, `www` CNAME `fc21d5b2466fbddc.vercel-dns-017.com`.
- GitHub Pages is not enabled on `viodox/cipher` (`GET /repos/viodox/cipher/pages` returns 404). `https://viodox.github.io/cipher/` is a GitHub 404.

Cloudflare Web Analytics is a script tag in the page. It is not the host.

## Run locally

```bash
npm install
npm run dev
```

Opens `http://127.0.0.1:4173` with the same routes Vercel serves: `/ai-decrypt`, `/profile`, `/cipherpot`, `/on-chain-stocks`, `/rug-radar`, `/movers`, `/updates`, `/alerts`, `/check`, `/hall`, `/shame`, `/check/{chain}/{address}`, `/coin/{id}`, `/scan/{chain}/{address}`, `/og/scan/{chain}/{address}.png`, `/og/check/{chain}/{address}.png`, `/og/movers.png`, `/og/coin/{id}.png`, `/api/updates`, `/api/movers`, `/api/check`, `/api/ape-view`, `/api/alerts`, and `/api/coingecko/...`.

`/coin/{id}`, `/og/coin/{id}.png`, and `/og/movers.png` are rewrites in `vercel.json` (query parameters on a normal function file). Do not add a `[...path].js` catch-all for new routes.

## What the owner must set on Vercel

Redeploy this repo on the existing Vercel project (the one already attached to `ciphersignal.xyz`). `vercel.json` adds rewrites and serverless functions under `api/`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `COINGECKO_API_KEY` | Strongly recommended | Demo key added only on the server. The previous key was in client JavaScript and should be **rotated** at CoinGecko, then stored here. Without it the public endpoint still works until it rate-limits. |
| `GOPLUS_API_KEY` | No | Not used. GoPlus token security is called on the free unauthenticated tier. |
| `KV_REST_API_URL` and `KV_REST_API_TOKEN` | To turn alerts on | Free [Upstash Redis](https://upstash.com). `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are accepted too. Without them, production shows **coming soon** and stores nothing. |
| `RESEND_API_KEY` and `RESEND_FROM` | To turn alerts on | Free [Resend](https://resend.com) API key, and the from address on a domain you verified there (for example `CIPHER <alerts@ciphersignal.xyz>`). |
| `CRON_SECRET` | To run checks | Long random string. Vercel Cron sends it as `Authorization: Bearer`. The same header is what cron-job.org must send. |
| `ALERTS_ADMIN_TOKEN` | Optional | `GET /api/alerts` with `Authorization: Bearer <token>` exports rows. Without it that URL does not list emails. |

### Price alerts — exact setup

The Vercel project already has `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` (same database), `ALERTS_ADMIN_TOKEN`, and `CRON_SECRET`. The form stays hidden until Resend is added. `GET /api/alerts/run` with `Authorization: Bearer <CRON_SECRET>` is authorized and sends nothing while `RESEND_API_KEY` or `RESEND_FROM` is missing.

1. Upstash is already connected. Both REST URL/token pairs point at that database.
2. `RESEND_API_KEY` (send-only) and `RESEND_FROM` (`CipherSignal <alerts@ciphersignal.xyz>`) are set. Domain verification in Resend is still pending. Until that finishes, Resend rejects the send. The signup is kept, the page says the confirmation could not be sent yet, and the row stays `pending` (not `sent`). The daily run retries. After the domain shows verified, the next run can deliver.
3. A signup stores the row in Upstash, tries to send a confirmation, and later one alert with a one-click unsubscribe. The job marks the row `sent` only after Resend accepts that alert email.
4. Hobby plans only allow a daily cron. This repo schedules `GET /api/alerts/run` at 13:00 UTC and Vercel sends `Authorization: Bearer <CRON_SECRET>`. For a check every 5–15 minutes, add a free job at [cron-job.org](https://cron-job.org) with that same header. The shared secret's name is `CRON_SECRET`. Do not put it in the query string.

Resend's free tier is about 100 emails/day and 3,000/month. A confirmation plus one alert per signup stays inside that if signups stay modest. The daily check only emails rows whose USD price is already across the threshold at check time.

### Daily digest, Smart Money, compare

Hobby still has one cron. `GET /api/alerts/run` sends price alerts and then the daily digest. The digest is top movers, one hall grade, one shame grade, Fear & Greed when `api.alternative.me` answers, and a link to `/smart-money`. Signup is `/digest`. Unsubscribe is the same one-click pattern as alerts (`list=digest`). Domain verification in Resend is a dashboard fact, not something this repo can mark true.

`GET /api/alerts?action=digest&dry=1` with `Authorization: Bearer <CRON_SECRET>` returns the email and does not send it.

Smart Money Watch (`/smart-money`) reads public explorers and caches the feed in Upstash for a few minutes. `HELIUS_API_KEY` is optional. Without it, Solana uses a public RPC. The wallet list is `lib/wallets.js`.

`/compare?a=eth:0x…&b=sol:…` grades two contracts side by side. The homepage is served by `api/site.js` (`page=home`) so a cached CoinGecko page can be in the first HTML. The scanner no longer waits 1.5s between market pages; the edge cache on `/api/coingecko` absorbs those calls.

Still four serverless functions: `api/alerts.js`, `api/coingecko.js`, `api/scan.js`, `api/site.js`.

### Forced Coin of the Day

Paid days are a checked-in file or env vars. No new serverless function. Leads come from the homepage form (`#advertise`, Formspree `https://formspree.io/f/xzdjaele`). There is no card checkout.

TODO: Stripe Checkout later, if card payment should happen on the site. Fold it into an existing function (`api/site.js` or `api/alerts.js`). Do not add a fifth function on the Hobby plan.

To book a day, edit `data/sponsored-cotd.json` or set the env vars below, then redeploy. An env booking whose date matches replaces the JSON row for that same date. Other JSON dates still apply. Prices live in one place: `PACKAGES` in `lib/sponsor.js` (banner row **$99/day**, Forced Coin of the Day **$249/day**, Fortune + Coin of the Day **$399/day**).

| Variable | Purpose |
| --- | --- |
| `SPONSORED_COTD_DATE` | `YYYY-MM-DD` in `America/New_York`. Required for an env booking. |
| `SPONSORED_COTD_ID` | CoinGecko id. |
| `SPONSORED_COTD_SYMBOL` | Ticker, without `$`. |
| `SPONSORED_COTD_NAME` | Display name on the banner. |
| `SPONSORED_COTD_LOGO` | Optional `https` logo URL. |
| `SPONSORED_COTD_BLURB` | Optional short line on the banner. |
| `SPONSORED_COTD_HREF` | Optional coin page, contract, or DEX link (`https://` or a site path). |
| `SPONSORED_COTD_FORCE_FORTUNE` | `true` locks Cipher Fortune’s daily spin to this coin. Bonus spins stay random. |
| `SPONSORED_COTD_PACKAGE` | `cotd` (default), `combo` (same as force fortune), or `banner` (gold table row only; Coin of the Day stays organic). |

`forceFortune: true` is the $399 combo. Omit it for the $249 homepage takeover. `"package": "banner"` is the $99 row and does not replace Coin of the Day.

```json
{
  "date": "2026-12-01",
  "id": "your-coingecko-id",
  "symbol": "TICKER",
  "name": "Display Name",
  "logo": "https://example.com/logo.png",
  "blurb": "One short line visitors can read.",
  "href": "/coin/your-coingecko-id",
  "forceFortune": true
}
```

### Ape Check human vs bot counters

These keys live in the same Upstash database. The date is the calendar day in `America/New_York`. Each key expires 40 days after the last write. Nothing is blocked.

| Key | Type | Meaning |
| --- | --- | --- |
| `ape:check:human:YYYY-MM-DD` | string counter | Grade page (`/check/{chain}/{address}`) whose script posted `/api/ape-view` with header `x-cipher-view: 1` after load. |
| `ape:check:bot:YYYY-MM-DD` | string counter | Direct `/api/check/{chain}/{address}` hits, grade-page fetches that are not a browser navigation (bot user agent, or no referrer and no document navigation), and `/api/ape-view` without that header. |
| `ape:check:bot-ua:YYYY-MM-DD` | sorted set | User agents in the bot bucket. Score is the count. Capped at the top 20. |

```bash
GET ape:check:human:2026-11-03
GET ape:check:bot:2026-11-03
ZREVRANGE ape:check:bot-ua:2026-11-03 0 19 WITHSCORES
```

A browser navigation is not counted until the page script runs, so a cached HTML response still counts the person. Open-graph image fetches are not counted. Repeated API hits served from the Vercel cache do not reach the function, so the bot counter is uncached lookups.

### CoinGecko call budget

Demo plan limits used here: about **30 calls/minute** and **10,000 calls/month**. A 5-minute cache on five market pages would be `5 × 12 × 24 × 30 = 43,200` calls/month if the site is requested all month, which blows the cap. The cache is therefore longer:

| Call | Cache | Steady-state calls/month |
| --- | --- | --- |
| 5 meme-market pages (250 each; the meme-token category currently fills 4 pages, about 1,000 coins, and the scanner keeps those with 24h volume over $500) | 60 min | 5 × 24 × 30 = **3,600** |
| Trending | 60 min | **720** |
| Top-100 names for the impostor filter | 6 hours | **120** |
| Coin pages, assume 15 hot ids watched continuously | 30 min | 15 × 48 × 30 = **1,800** if they are hit every window; quiet coins add nothing |
| 7-day charts, assume 10 hot ids | 60 min | **720** |
| Alert check, one `simple/price` batch per day | 10 min server cache, but the cron is daily | **30** |
| Optional 15-minute external pinger | one batch per run | 96 × 30 = **2,880** extra — still under the cap if coin-page traffic is the quiet case |
| **Default total (no extra pinger)** | | **about 7,000**, leaving roughly 3,000 calls of headroom |

The browser staggers the five market pages by 1.5 seconds so a cold start stays under 30 calls/minute. Scanner, coin-of-the-day, rekt, prediction, ticker, and Top Movers drop coins whose name or ticker copies a top-100 coin unless the CoinGecko id is the real one, and they require at least $500k market cap and $50k of 24h volume. Markets responses do not include a separate liquidity figure, so 24h volume is the tradability check. Unlisted DEX rows never enter those spotlight surfaces.

### DEX discovery (free, not CoinGecko Demo)

Homepage boot and `/api/boot` attach a cached on-chain universe. It does **not** send `COINGECKO_API_KEY`.

| Feed | Calls per refresh | Cache |
| --- | --- | --- |
| GeckoTerminal public `new_pools` + `trending_pools` for `solana`, `base`, `bsc`, `eth` (page 1, `include=base_token`) | 8 | 12 min memory, 6 h stale in Upstash |
| DexScreener boosts latest, boosts top, profiles latest | 3 | same snapshot |
| DexScreener `tokens/v1` only for boosts/profiles still missing a price | up to 4 | same snapshot |

A 429 sets a 10 minute backoff and the last good snapshot is served. Movers and Rug Radar read that cache only, so they do not start a second burst. CoinGecko movers also request meme-market page 2, which stays on the existing 60 minute market cache.

No new paid services. Scan pages and OG images still cache about 60 seconds. Rug Radar caches about 120 seconds.

`/api/coingecko/...` is a rewrite to `api/coingecko.js`. This project is not Next.js, and plain Vercel functions only match one dynamic segment, so `api/coingecko/[...path].js` is not a catch-all. The rewrite destination must stay `/api/coingecko` (Vercel appends `?path=$1`). Putting `:path+` in the destination query compiles to a trailing space.

Optional: add `COINGECKO_API_KEY` as a GitHub Actions secret if the daily X bot (`bot.js`) starts getting CoinGecko 429s. The bot calls CoinGecko directly and does not embed a key.

`fonts/` is Orbitron and Share Tech Mono from Google Fonts (SIL Open Font License), used only to draw the scan cards.

The X bot no longer posts Roobet. The same cron hours now publish CIPHER templates only. Secrets `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, and `X_ACCESS_TOKEN_SECRET` are unchanged.

## Routes

Tool pages are real HTML responses (unique title, description, canonical, Open Graph, Twitter card), not a 404 that bounces home in JavaScript. `/scan/eth|bsc|base|sol/{address}` is server-rendered so X can unfurl the card. The image is `/og/scan/{chain}/{address}.png`.

`/movers` is a server-rendered 24h board (gainers, losers, volume relative to market cap) with its own card at `/og/movers.png`. `/updates` is rendered from `data/updates.json`, and `GET /api/updates` returns that list for an automation. `/coin/{id}` is a per-coin page with meta tags, JSON-LD, a share-to-X link, and a CipherPot link when CoinGecko lists an Ethereum, BSC, Base, or Solana contract. The watch star on movers and coin pages uses the same `localStorage` key as the scanner (`cipher_watchlist`). `sitemap-coins.xml` lists the coin ids from the latest movers snapshot.
