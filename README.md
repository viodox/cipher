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

Opens `http://127.0.0.1:4173` with the same routes Vercel serves: `/ai-decrypt`, `/profile`, `/cipherpot`, `/on-chain-stocks`, `/rug-radar`, `/scan/{chain}/{address}`, `/og/scan/{chain}/{address}.png`, and `/api/coingecko/...`.

## What the owner must set on Vercel

Redeploy this repo on the existing Vercel project (the one already attached to `ciphersignal.xyz`). `vercel.json` adds rewrites and serverless functions under `api/`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `COINGECKO_API_KEY` | Strongly recommended | Demo key added only on the server. The previous key was in client JavaScript and should be **rotated** at CoinGecko, then stored here. Without it the public endpoint still works until it rate-limits. |
| `GOPLUS_API_KEY` | No | Not used. GoPlus token security is called on the free unauthenticated tier. |

No new paid services. CoinGecko responses are cached about 60 seconds (`Cache-Control: s-maxage=60` plus an in-memory cache on the function). Scan pages and OG images use the same 60 second window. Rug Radar caches about 120 seconds.

Optional: add `COINGECKO_API_KEY` as a GitHub Actions secret if the daily X bot (`bot.js`) starts getting CoinGecko 429s. The bot calls CoinGecko directly and does not embed a key.

`fonts/` is Orbitron and Share Tech Mono from Google Fonts (SIL Open Font License), used only to draw the scan cards.

The X bot no longer posts Roobet. The same cron hours now publish CIPHER templates only. Secrets `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, and `X_ACCESS_TOKEN_SECRET` are unchanged.

## Routes

Tool pages are real HTML responses (unique title, description, canonical, Open Graph, Twitter card), not a 404 that bounces home in JavaScript. `/scan/eth|bsc|base|sol/{address}` is server-rendered so X can unfurl the card. The image is `/og/scan/{chain}/{address}.png`.
