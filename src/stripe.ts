/**
 * Stripe billing integration for OGBadge.
 * Handles checkout sessions, webhooks, and API key management.
 * API keys and usage are persisted in SQLite (see db.ts).
 */

import Stripe from "stripe";
import { randomBytes } from "crypto";
import { db } from "./db.js";

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not set");
    _stripe = new Stripe(key, { apiVersion: "2026-01-28.clover" as Stripe.LatestApiVersion });
  }
  return _stripe;
}

// ── API Key Store (SQLite) ───────────────────────────────

export interface ApiKeyRecord {
  key: string;
  tier: "free" | "pro";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  usageThisMonth: number;
  usageResetAt: string;
  createdAt: string;
}

interface Row {
  key: string;
  tier: "free" | "pro";
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  usage_this_month: number;
  usage_reset_at: string;
  created_at: string;
}

function fromRow(r: Row): ApiKeyRecord {
  return {
    key: r.key,
    tier: r.tier,
    stripeCustomerId: r.stripe_customer_id ?? undefined,
    stripeSubscriptionId: r.stripe_subscription_id ?? undefined,
    usageThisMonth: r.usage_this_month,
    usageResetAt: r.usage_reset_at,
    createdAt: r.created_at,
  };
}

const stmts = {
  select: db.prepare<string, Row>("SELECT * FROM api_keys WHERE key = ?"),
  insert: db.prepare(
    "INSERT INTO api_keys (key, tier, usage_this_month, usage_reset_at, created_at) VALUES (?, 'free', 0, ?, ?)",
  ),
  upgrade: db.prepare(
    "UPDATE api_keys SET tier = 'pro', stripe_customer_id = ?, stripe_subscription_id = ? WHERE key = ?",
  ),
  downgradeBySub: db.prepare(
    "UPDATE api_keys SET tier = 'free', stripe_subscription_id = NULL WHERE stripe_subscription_id = ?",
  ),
  resetUsage: db.prepare(
    "UPDATE api_keys SET usage_this_month = 0, usage_reset_at = ? WHERE key = ?",
  ),
  bumpUsage: db.prepare(
    "UPDATE api_keys SET usage_this_month = usage_this_month + 1 WHERE key = ?",
  ),
  stats: db.prepare<[], { free: number; pro: number; totalUsage: number }>(
    `SELECT
       SUM(CASE WHEN tier='free' THEN 1 ELSE 0 END) AS free,
       SUM(CASE WHEN tier='pro'  THEN 1 ELSE 0 END) AS pro,
       COALESCE(SUM(usage_this_month), 0)           AS totalUsage
     FROM api_keys`,
  ),
};

function nextMonthIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
}

export function generateApiKey(): string {
  return `og_${randomBytes(24).toString("base64url")}`;
}

export function getKey(key: string): ApiKeyRecord | undefined {
  const row = stmts.select.get(key);
  return row ? fromRow(row) : undefined;
}

export function createFreeKey(): ApiKeyRecord {
  const key = generateApiKey();
  const now = new Date().toISOString();
  const resetAt = nextMonthIso();
  stmts.insert.run(key, resetAt, now);
  return { key, tier: "free", usageThisMonth: 0, usageResetAt: resetAt, createdAt: now };
}

export function upgradeKey(key: string, customerId: string, subscriptionId: string): void {
  stmts.upgrade.run(customerId, subscriptionId, key);
}

export function downgradeKey(subscriptionId: string): void {
  stmts.downgradeBySub.run(subscriptionId);
}

export function incrementUsage(key: string): { ok: boolean; usage: number; limit: number } {
  const record = getKey(key);
  if (!record) return { ok: false, usage: 0, limit: 0 };

  let usage = record.usageThisMonth;
  if (new Date() >= new Date(record.usageResetAt)) {
    stmts.resetUsage.run(nextMonthIso(), key);
    usage = 0;
  }

  const limit = record.tier === "pro" ? 10_000 : 100;
  if (usage >= limit) return { ok: false, usage, limit };

  stmts.bumpUsage.run(key);
  return { ok: true, usage: usage + 1, limit };
}

// ── Stripe Checkout ──────────────────────────────────────

const PRICE_ID = process.env.STRIPE_PRICE_ID || "";

export async function createCheckoutSession(apiKey: string, successUrl: string, cancelUrl: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: PRICE_ID, quantity: 1 }],
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    metadata: { api_key: apiKey },
  });
  return session.url || "";
}

// ── Stripe Webhook Handler ───────────────────────────────

export async function handleWebhook(body: string, signature: string): Promise<{ type: string }> {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET not set");

  const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const apiKey = session.metadata?.api_key;
      if (apiKey && session.customer && session.subscription) {
        upgradeKey(
          apiKey,
          typeof session.customer === "string" ? session.customer : session.customer.id,
          typeof session.subscription === "string" ? session.subscription : session.subscription.id,
        );
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      downgradeKey(sub.id);
      break;
    }
  }

  return { type: event.type };
}

// ── Key Stats ────────────────────────────────────────────

export function getStats() {
  const row = stmts.stats.get();
  const free = row?.free ?? 0;
  const pro = row?.pro ?? 0;
  return { free, pro, totalKeys: free + pro, totalUsage: row?.totalUsage ?? 0 };
}
