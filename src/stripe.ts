/**
 * Stripe billing integration for OGBadge.
 * Handles checkout sessions, webhooks, and API key management.
 */

import Stripe from "stripe";
import { randomBytes } from "crypto";

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not set");
    _stripe = new Stripe(key, { apiVersion: "2026-01-28.clover" as Stripe.LatestApiVersion });
  }
  return _stripe;
}

// ── API Key Store (SQLite in production, Map for MVP) ────

export interface ApiKeyRecord {
  key: string;
  tier: "free" | "pro";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  usageThisMonth: number;
  usageResetAt: string; // ISO date of next reset
  createdAt: string;
}

const keys = new Map<string, ApiKeyRecord>();

export function generateApiKey(): string {
  return `og_${randomBytes(24).toString("base64url")}`;
}

export function getKey(key: string): ApiKeyRecord | undefined {
  return keys.get(key);
}

export function createFreeKey(): ApiKeyRecord {
  const key = generateApiKey();
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const record: ApiKeyRecord = {
    key,
    tier: "free",
    usageThisMonth: 0,
    usageResetAt: nextMonth.toISOString(),
    createdAt: now.toISOString(),
  };
  keys.set(key, record);
  return record;
}

export function upgradeKey(key: string, customerId: string, subscriptionId: string): void {
  const record = keys.get(key);
  if (record) {
    record.tier = "pro";
    record.stripeCustomerId = customerId;
    record.stripeSubscriptionId = subscriptionId;
  }
}

export function downgradeKey(subscriptionId: string): void {
  for (const record of keys.values()) {
    if (record.stripeSubscriptionId === subscriptionId) {
      record.tier = "free";
      record.stripeSubscriptionId = undefined;
    }
  }
}

export function incrementUsage(key: string): { ok: boolean; usage: number; limit: number } {
  const record = keys.get(key);
  if (!record) return { ok: false, usage: 0, limit: 0 };

  // Reset usage if past reset date
  if (new Date() >= new Date(record.usageResetAt)) {
    record.usageThisMonth = 0;
    const now = new Date();
    record.usageResetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  }

  const limit = record.tier === "pro" ? 10_000 : 100;
  if (record.usageThisMonth >= limit) {
    return { ok: false, usage: record.usageThisMonth, limit };
  }

  record.usageThisMonth++;
  return { ok: true, usage: record.usageThisMonth, limit };
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
  let free = 0, pro = 0, totalUsage = 0;
  for (const record of keys.values()) {
    if (record.tier === "pro") pro++;
    else free++;
    totalUsage += record.usageThisMonth;
  }
  return { free, pro, totalKeys: free + pro, totalUsage };
}
