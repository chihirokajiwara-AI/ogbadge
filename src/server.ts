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
import { renderOgImage, renderTemplate, type OgParams } from "./render.js";
import { TEMPLATES, type TemplateParams } from "./templates.js";
import * as billing from "./stripe.js";

const app = new Hono();

// ── Key resolution ──────────────────────────────────────

const FREE_LIMIT = 100;
const PRO_LIMIT = 10_000;
const MAX_WIDTH = 2400;
const MAX_HEIGHT = 1260;

// IP-based anonymous rate limiting
const anonUsage = new Map<string, { count: number; resetAt: number }>();

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || c.req.header("x-real-ip")
    || "unknown";
}

function checkAnonLimit(ip: string): { ok: boolean; usage: number } {
  const now = Date.now();
  let record = anonUsage.get(ip);
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + 30 * 24 * 3600 * 1000 };
    anonUsage.set(ip, record);
  }
  if (record.count >= FREE_LIMIT) return { ok: false, usage: record.count };
  record.count++;
  return { ok: true, usage: record.count };
}

function clampDimension(val: string | undefined, fallback: number, max: number): number {
  if (!val) return fallback;
  const n = parseInt(val);
  if (isNaN(n) || n < 1) return fallback;
  return Math.min(n, max);
}

interface ResolvedKey {
  key: string | null;
  tier: "free" | "pro";
}

function resolveKey(raw: string | undefined): ResolvedKey {
  if (!raw) return { key: null, tier: "free" };
  const record = billing.getKey(raw);
  if (!record) return { key: null, tier: "free" }; // Don't auto-create keys for random strings
  return { key: raw, tier: record.tier };
}

function checkAndIncrementUsage(resolved: ResolvedKey, ip: string): { ok: boolean; usage: number; limit: number } {
  if (resolved.key) {
    return billing.incrementUsage(resolved.key);
  }
  // Anonymous — use IP-based limit
  const anon = checkAnonLimit(ip);
  return { ...anon, limit: FREE_LIMIT };
}

// ── OG Image endpoint ────────────────────────────────────

app.get("/api/og", async (c) => {
  const q = c.req.query();
  const apiKeyRaw = q.key || c.req.header("x-api-key");
  const resolved = resolveKey(apiKeyRaw);
  const ip = getClientIp(c);

  const usage = checkAndIncrementUsage(resolved, ip);
  if (!usage.ok) {
    return c.json({ error: "Monthly limit reached. Upgrade at ogbadge.dev/pricing" }, 429);
  }

  const params: OgParams = {
    title: q.title || "Untitled",
    subtitle: q.subtitle,
    domain: q.domain,
    theme: (q.theme as OgParams["theme"]) || "dark",
    accentColor: q.color || q.accentColor,
    emoji: q.emoji,
    watermark: resolved.tier !== "pro",
    width: clampDimension(q.width, 1200, MAX_WIDTH),
    height: clampDimension(q.height, 630, MAX_HEIGHT),
  };

  try {
    const png = await renderOgImage(params);

    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
        "Vary": "x-api-key",
        "X-OGBadge-Usage": `${usage.usage}/${usage.limit}`,
      },
    });
  } catch (err) {
    console.error("Render error:", err);
    return c.json({ error: "Failed to render image" }, 500);
  }
});

// ── Template endpoint ────────────────────────────────────

app.get("/api/og/:template", async (c) => {
  const templateId = c.req.param("template");
  const templateFn = TEMPLATES[templateId];
  if (!templateFn) {
    return c.json({ error: `Unknown template: ${templateId}. Available: ${Object.keys(TEMPLATES).join(", ")}` }, 400);
  }

  const q = c.req.query();
  const apiKeyRaw = q.key || c.req.header("x-api-key");
  const resolved = resolveKey(apiKeyRaw);
  const ip = getClientIp(c);

  const usage = checkAndIncrementUsage(resolved, ip);
  if (!usage.ok) {
    return c.json({ error: "Monthly limit reached. Upgrade at ogbadge.dev/pricing" }, 429);
  }

  const params: TemplateParams = {
    title: q.title || "Untitled",
    subtitle: q.subtitle,
    domain: q.domain,
    tag: q.tag,
    author: q.author,
    date: q.date,
    stat: q.stat,
    statLabel: q.statLabel || q.stat_label,
    accentColor: q.color || q.accentColor,
    watermark: resolved.tier !== "pro",
  };

  try {
    const element = templateFn(params);
    const w = clampDimension(q.width, 1200, MAX_WIDTH);
    const h = clampDimension(q.height, 630, MAX_HEIGHT);
    const png = await renderTemplate(element, w, h);

    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
        "Vary": "x-api-key",
        "X-OGBadge-Usage": `${usage.usage}/${usage.limit}`,
      },
    });
  } catch (err) {
    console.error("Template render error:", err);
    return c.json({ error: "Failed to render image" }, 500);
  }
});

// ── Templates list ───────────────────────────────────────

app.get("/api/templates", (c) => {
  return c.json({
    templates: Object.keys(TEMPLATES),
    docs: "GET /api/og/:template?title=...&subtitle=...&domain=...",
  });
});

// ── Billing endpoints ────────────────────────────────────

// Rate-limited key creation (max 5 per IP per hour)
const keyCreateLimits = new Map<string, { count: number; resetAt: number }>();

app.get("/api/key", (c) => {
  const ip = getClientIp(c);
  const now = Date.now();
  let limit = keyCreateLimits.get(ip);
  if (!limit || now > limit.resetAt) {
    limit = { count: 0, resetAt: now + 3600_000 };
    keyCreateLimits.set(ip, limit);
  }
  if (limit.count >= 5) {
    return c.json({ error: "Too many key requests. Try again later." }, 429);
  }
  limit.count++;
  const record = billing.createFreeKey();
  return c.json({ key: record.key, tier: record.tier, limit: FREE_LIMIT });
});

app.post("/api/checkout", async (c) => {
  const body = await c.req.json();
  const apiKey = body.key;
  if (!apiKey) return c.json({ error: "key is required" }, 400);

  try {
    const baseUrl = new URL(c.req.url).origin;
    const url = await billing.createCheckoutSession(
      apiKey,
      `${baseUrl}/api/checkout/success`,
      `${baseUrl}/pricing`,
    );
    return c.json({ url });
  } catch (err) {
    console.error("Checkout error:", err);
    return c.json({ error: "Failed to create checkout session" }, 500);
  }
});

app.post("/api/webhooks/stripe", async (c) => {
  const body = await c.req.text();
  const sig = c.req.header("stripe-signature");
  if (!sig) return c.json({ error: "Missing stripe-signature" }, 400);

  try {
    const result = await billing.handleWebhook(body, sig);
    return c.json(result);
  } catch (err) {
    console.error("Webhook error:", err);
    return c.json({ error: "Webhook failed" }, 400);
  }
});

app.get("/api/stats", (c) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey || c.req.header("x-admin-key") !== adminKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return c.json(billing.getStats());
});

// ── Health check ─────────────────────────────────────────

app.get("/api/ping", (c) => c.json({ ok: true, version: "0.2.0" }));

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
