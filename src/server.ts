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
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { renderOgImage, renderTemplate, type OgParams } from "./render.js";
import { TEMPLATES, type TemplateParams } from "./templates.js";
import * as billing from "./stripe.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// ── Landing page (static file) ───────────────────────────

app.get("/", async (c) => {
  const htmlPath = join(__dirname, "..", "public", "index.html");
  try {
    const html = await readFile(htmlPath, "utf-8");
    return c.html(html);
  } catch {
    return c.text("OGBadge — https://ogbadge.dev/api/og?title=Hello", 200);
  }
});

/* OLD INLINE LP REMOVED — now served from public/index.html */
// ── Start ────────────────────────────────────────────────

const port = parseInt(process.env.PORT || "3456");
console.log(`OGBadge server running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
