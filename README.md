# CIPHER

Free meme coin scanner for up to 500 CoinGecko meme-token markets, plus contract checks. Signal scores are formulas, not an AI model.

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

Opens `http://127.0.0.1:4173` with the same routes Vercel serves: `/ai-decrypt`, `/profile`, `/cipherpot`, `/on-chain-stocks`, `/rug-radar`, `/movers`, `/updates`, `/alerts`, `/coin/{id}`, `/scan/{chain}/{address}`, `/og/scan/{chain}/{address}.png`, `/og/movers.png`, `/og/coin/{id}.png`, `/api/updates`, `/api/movers`, `/api/alerts`, and `/api/coingecko/...`.

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

The browser staggers the five market pages by 1.5 seconds so a cold start stays under 30 calls/minute. Scanner, coin-of-the-day, rekt, prediction, ticker, and Top Movers drop coins whose name or ticker copies a top-100 coin unless the CoinGecko id is the real one, and they require at least $500k market cap and $50k of 24h volume. Markets responses do not include a separate liquidity figure, so 24h volume is the tradability check.

No new paid services. Scan pages and OG images still cache about 60 seconds. Rug Radar caches about 120 seconds.

`/api/coingecko/...` is a rewrite to `api/coingecko.js`. This project is not Next.js, and plain Vercel functions only match one dynamic segment, so `api/coingecko/[...path].js` is not a catch-all. The rewrite destination must stay `/api/coingecko` (Vercel appends `?path=$1`). Putting `:path+` in the destination query compiles to a trailing space.

Optional: add `COINGECKO_API_KEY` as a GitHub Actions secret if the daily X bot (`bot.js`) starts getting CoinGecko 429s. The bot calls CoinGecko directly and does not embed a key.

`fonts/` is Orbitron and Share Tech Mono from Google Fonts (SIL Open Font License), used only to draw the scan cards.

The X bot no longer posts Roobet. The same cron hours now publish CIPHER templates only. Secrets `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, and `X_ACCESS_TOKEN_SECRET` are unchanged.

## Routes

Tool pages are real HTML responses (unique title, description, canonical, Open Graph, Twitter card), not a 404 that bounces home in JavaScript. `/scan/eth|bsc|base|sol/{address}` is server-rendered so X can unfurl the card. The image is `/og/scan/{chain}/{address}.png`.

`/movers` is a server-rendered 24h board (gainers, losers, volume relative to market cap) with its own card at `/og/movers.png`. `/updates` is rendered from `data/updates.json`, and `GET /api/updates` returns that list for an automation. `/coin/{id}` is a per-coin page with meta tags, JSON-LD, a share-to-X link, and a CipherPot link when CoinGecko lists an Ethereum, BSC, Base, or Solana contract. The watch star on movers and coin pages uses the same `localStorage` key as the scanner (`cipher_watchlist`). `sitemap-coins.xml` lists the coin ids from the latest movers snapshot.
