/**
 * SQLite persistence for OGBadge billing state.
 *
 * Stores API keys, tier, Stripe linkage, and monthly usage. Survives container
 * restarts and image rebuilds when the data directory is volume-mounted.
 */

import Database, { type Database as DatabaseType } from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

const DB_PATH = process.env.DATABASE_PATH || "/data/ogbadge.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db: DatabaseType = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    key                    TEXT PRIMARY KEY,
    tier                   TEXT NOT NULL CHECK (tier IN ('free','pro')),
    stripe_customer_id     TEXT,
    stripe_subscription_id TEXT,
    usage_this_month       INTEGER NOT NULL DEFAULT 0,
    usage_reset_at         TEXT NOT NULL,
    created_at             TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_api_keys_subscription
    ON api_keys(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
`);
