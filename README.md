# OGBadge

> Dynamic Open Graph images via simple URL. Beautiful previews for your links on Twitter, LinkedIn, Slack, Discord — no design skills required.

![OG preview](https://ogbadge.dev/api/og?title=OGBadge&subtitle=Dynamic%20OG%20images%20via%20URL&theme=gradient&color=%236366f1&domain=ogbadge.dev)

## Why OGBadge

Every link you share looks generic without a custom OG image. Designing one per post is tedious. OGBadge generates a polished 1200×630 PNG on the fly from URL parameters, served in under 100ms with a 7-day CDN cache.

- **One meta tag. Done.** Paste one URL, get a unique OG image per page.
- **7 templates.** `dark` · `light` · `gradient` · `blog` · `stats` · `product` · `minimal`
- **No Puppeteer.** Built on Satori + resvg — lean Docker image, fast cold start.
- **Free tier.** 100 renders/month per IP, small `ogbadge.dev` watermark.

## Quick Start

```html
<meta property="og:image"
  content="https://ogbadge.dev/api/og?title=Your%20Title&subtitle=Your%20description&theme=gradient" />
```

That's it. The image renders on first request and stays cached for a week.

### Parameters

| Param | Notes |
|-------|-------|
| `title` | Required. Auto-resizes 48–96px based on length. |
| `subtitle` | Optional secondary line. |
| `domain` | Shown in footer. Defaults to "ogbadge.dev" on free tier. |
| `theme` | `dark` (default), `light`, `gradient`. |
| `color` | Accent color, e.g. `%236366f1`. |
| `emoji` | One emoji to anchor the design. |
| `width`, `height` | Clamped to 2400×1260. Defaults 1200×630. |

### Templates

Use `/api/og/:template` for pre-designed layouts:

```
GET /api/og/blog?title=My%20post&author=Chihiro&date=2026-04-22
GET /api/og/stats?title=12k%20users&stat=+34%25&statLabel=MoM
GET /api/og/product?title=ProductName&subtitle=one-liner&tag=Launch
GET /api/og/minimal?title=Simple&domain=example.com
```

List available templates: `GET /api/templates`.

## Pricing

| Tier | Price | Renders / month | Watermark |
|------|-------|-----------------|-----------|
| Free | $0 | 100 (per IP) | Yes — `ogbadge.dev` |
| Pro  | $9/mo | 10,000 (per key) | None |

Upgrade: `POST /api/checkout` with `{ "key": "<your-key>" }` → returns a Stripe Checkout URL.

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/og` | Render with query params |
| `GET /api/og/:template` | Render a named template |
| `GET /api/templates` | List template IDs |
| `GET /api/key` | Create a free API key (rate-limited, 5/IP/hour) |
| `POST /api/checkout` | Start a Stripe Checkout for Pro |
| `POST /api/webhooks/stripe` | Stripe webhook (server → billing updates) |
| `GET /api/ping` | Healthcheck |
| `GET /api/stats` | Admin usage stats (requires `x-admin-key`) |

Auth on render endpoints is optional — pass `?key=…` or `x-api-key:` for Pro behavior.

## Self-Host

```bash
docker compose up -d     # binds 3460:3456
curl http://localhost:3460/api/ping
```

Environment variables:

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
ADMIN_KEY=<random string for /api/stats>
```

## Development

```bash
npm install
npm run dev           # tsx watch src/server.ts
npm run build         # tsc → build/
npm run lint          # tsc --noEmit
```

## Tech

- [Hono](https://hono.dev/) — HTTP framework
- [Satori](https://github.com/vercel/satori) — JSX → SVG
- [resvg-js](https://github.com/yisibl/resvg-js) — SVG → PNG
- Node 22 on Docker, no headless Chromium

## Limits (current)

- Anonymous: 100 renders/month per IP, no customization of watermark
- Image size capped at 2400×1260
- Key creation: 5 per IP per hour
- Cache: 24h browser, 7d CDN
- Storage: keys + usage are in-memory today (SQLite persistence on roadmap)

## License

MIT — see [LICENSE](LICENSE).
