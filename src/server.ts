/**
 * OGBadge API Server
 *
 * Endpoints:
 *   GET /api/og?title=...&subtitle=...&theme=...  → PNG image
 *   GET /api/og/:templateId?title=...             → Template-based image
 *   POST /api/keys                                → Create API key (via Stripe)
 *   GET /                                         → Landing page
 *
 * Auth: API key via ?key= param or x-api-key header.
 * Free tier: watermark on image. Paid ($9/mo): no watermark.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { renderOgImage, type OgParams } from "./render.js";

const app = new Hono();

// ── In-memory key store (replace with KV/D1 in production) ──

interface ApiKey {
  id: string;
  tier: "free" | "pro";
  usageThisMonth: number;
  createdAt: string;
}

const keys = new Map<string, ApiKey>();

// Default free key for unauthenticated requests
const FREE_LIMIT = 100; // renders per month
const PRO_LIMIT = 10_000;

function resolveKey(raw: string | undefined): ApiKey {
  if (!raw) return { id: "anon", tier: "free", usageThisMonth: 0, createdAt: "" };
  const existing = keys.get(raw);
  if (existing) return existing;
  // Auto-create free key on first use
  const newKey: ApiKey = { id: raw, tier: "free", usageThisMonth: 0, createdAt: new Date().toISOString() };
  keys.set(raw, newKey);
  return newKey;
}

// ── OG Image endpoint ────────────────────────────────────

app.get("/api/og", async (c) => {
  const q = c.req.query();
  const apiKeyRaw = q.key || c.req.header("x-api-key");
  const apiKey = resolveKey(apiKeyRaw);

  const limit = apiKey.tier === "pro" ? PRO_LIMIT : FREE_LIMIT;
  if (apiKey.usageThisMonth >= limit) {
    return c.json({ error: "Monthly limit reached. Upgrade at ogbadge.dev/pricing" }, 429);
  }

  const params: OgParams = {
    title: q.title || "Untitled",
    subtitle: q.subtitle,
    domain: q.domain,
    theme: (q.theme as OgParams["theme"]) || "dark",
    accentColor: q.color || q.accentColor,
    emoji: q.emoji,
    watermark: apiKey.tier !== "pro",
    width: q.width ? parseInt(q.width) : 1200,
    height: q.height ? parseInt(q.height) : 630,
  };

  try {
    const png = await renderOgImage(params);
    apiKey.usageThisMonth++;

    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
        "X-OGBadge-Usage": `${apiKey.usageThisMonth}/${limit}`,
      },
    });
  } catch (err) {
    console.error("Render error:", err);
    return c.json({ error: "Failed to render image" }, 500);
  }
});

// ── Health check ─────────────────────────────────────────

app.get("/api/ping", (c) => c.json({ ok: true, version: "0.1.0" }));

// ── Landing page ─────────────────────────────────────────

app.get("/", (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OGBadge — Dynamic OG Images for Your Site</title>
  <meta name="description" content="Beautiful, dynamic Open Graph images via simple URL. Free tier with watermark. No code required.">
  <meta property="og:image" content="/api/og?title=OGBadge&subtitle=Beautiful%20OG%20images%20via%20URL&theme=gradient&color=%236366f1&domain=ogbadge.dev">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; line-height: 1.6; }
    .hero { max-width: 800px; margin: 0 auto; padding: 80px 24px; text-align: center; }
    h1 { font-size: 3rem; margin-bottom: 16px; background: linear-gradient(135deg, #6366f1, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .sub { font-size: 1.25rem; color: #94a3b8; margin-bottom: 40px; }
    .preview { width: 100%; border-radius: 12px; box-shadow: 0 25px 50px rgba(0,0,0,0.5); margin-bottom: 48px; }
    .code { background: #1e293b; padding: 24px; border-radius: 8px; text-align: left; font-family: monospace; font-size: 0.9rem; color: #a5f3fc; margin-bottom: 40px; overflow-x: auto; white-space: pre; }
    .cta { display: inline-block; padding: 16px 32px; background: #6366f1; color: white; text-decoration: none; border-radius: 8px; font-size: 1.1rem; font-weight: 600; }
    .cta:hover { background: #4f46e5; }
    .pricing { display: flex; gap: 24px; justify-content: center; margin-top: 60px; flex-wrap: wrap; }
    .plan { background: #1e293b; padding: 32px; border-radius: 12px; width: 280px; text-align: left; }
    .plan h3 { font-size: 1.3rem; margin-bottom: 8px; }
    .plan .price { font-size: 2rem; font-weight: 700; margin-bottom: 16px; }
    .plan ul { list-style: none; }
    .plan li { padding: 4px 0; color: #94a3b8; }
    .plan li::before { content: "✓ "; color: #6366f1; }
    .badge { color: #6366f1; font-weight: 600; }
  </style>
</head>
<body>
  <div class="hero">
    <h1>OGBadge</h1>
    <p class="sub">Beautiful Open Graph images via URL. Just add your title — we handle the rest.</p>

    <img class="preview" src="/api/og?title=My%20Awesome%20Blog%20Post&subtitle=A%20deep%20dive%20into%20modern%20web%20development&theme=gradient&color=%236366f1&domain=myblog.dev" alt="OG image preview">

    <div class="code">&lt;meta property="og:image" content="https://ogbadge.dev/api/og?title=Your+Title&amp;subtitle=Your+description" /&gt;</div>

    <a class="cta" href="#pricing">Get Started Free</a>

    <div class="pricing" id="pricing">
      <div class="plan">
        <h3>Free</h3>
        <div class="price">$0</div>
        <ul>
          <li>100 renders/month</li>
          <li>3 themes (light, dark, gradient)</li>
          <li>Custom colors</li>
          <li>Small <span class="badge">ogbadge.dev</span> watermark</li>
        </ul>
      </div>
      <div class="plan" style="border: 2px solid #6366f1;">
        <h3>Pro</h3>
        <div class="price">$9<span style="font-size: 1rem; font-weight: 400;">/mo</span></div>
        <ul>
          <li>10,000 renders/month</li>
          <li>No watermark</li>
          <li>Custom fonts</li>
          <li>Priority rendering</li>
          <li>Analytics dashboard</li>
        </ul>
      </div>
    </div>
  </div>
</body>
</html>`;
  return c.html(html);
});

// ── Start ────────────────────────────────────────────────

const port = parseInt(process.env.PORT || "3456");
console.log(`OGBadge server running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
