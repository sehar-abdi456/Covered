/**
 * db.js — Data Layer
 * ---------------------------------------------------------------------------
 * SQLite (single file, zero-setup) STANDS IN FOR the production combo of
 * MySQL (system-of-record) + DynamoDB/Redis (fast reads) + a warehouse.
 *
 * Logical stores:
 *   - entitlements : per-benefit coverage rules (loaded from entitlements.json;
 *                    mirrored into a table so the "data layer" is real, but the
 *                    Rules Engine still reads the JSON config pack directly).
 *   - transactions : the seeded feed + an evaluation `status` per row.
 *   - claims       : submitted claims + status + reference number.
 * ---------------------------------------------------------------------------
 */

import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, "seed-data");

// In-memory DB so every boot is clean and deterministic for the demo.
const db = new Database(":memory:");
db.pragma("journal_mode = WAL");

// Entitlements are the config pack — kept in memory as the source of truth for
// the Rules Engine, and mirrored into a table for the data-layer story.
export const entitlements = JSON.parse(
  readFileSync(join(SEED_DIR, "entitlements.json"), "utf-8")
);

function initSchema() {
  db.exec(`
    CREATE TABLE entitlements (
      benefit_type TEXT PRIMARY KEY,
      config_json  TEXT NOT NULL
    );
    CREATE TABLE transactions (
      transaction_id TEXT PRIMARY KEY,
      card_last4     TEXT,
      card_product   TEXT,
      merchant       TEXT,
      mcc            TEXT,
      amount         REAL,
      currency       TEXT,
      timestamp      TEXT,
      category_hint  TEXT,
      flight_number  TEXT,
      flight_date    TEXT,
      flags_json     TEXT,
      raw_json       TEXT,
      -- new | evaluated | eligible | quick_confirm | ineligible | claimed
      status         TEXT DEFAULT 'new',
      benefit_type   TEXT,
      coverage_json  TEXT,
      confidence     REAL,
      trace_json     TEXT
    );
    CREATE TABLE claims (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      reference      TEXT UNIQUE,
      transaction_id TEXT NOT NULL,
      benefit_type   TEXT,
      draft_json     TEXT,
      what_happened  TEXT,
      photo_filename TEXT,
      status         TEXT DEFAULT 'submitted',
      decision       TEXT,
      created_at     TEXT
    );
  `);
}

function seed() {
  // Mirror entitlements into the table.
  const insEnt = db.prepare("INSERT INTO entitlements (benefit_type, config_json) VALUES (?, ?)");
  for (const b of entitlements.benefits) insEnt.run(b.benefit_type, JSON.stringify(b));

  // Load the seeded transaction feed. Rows start as 'new' — the stream emitter
  // + detection engine will evaluate them one at a time during the demo.
  const txns = JSON.parse(readFileSync(join(SEED_DIR, "transactions.json"), "utf-8"));
  const insTxn = db.prepare(`
    INSERT INTO transactions
      (transaction_id, card_last4, card_product, merchant, mcc, amount, currency,
       timestamp, category_hint, flight_number, flight_date, flags_json, raw_json, status)
    VALUES
      (@transaction_id, @card_last4, @card_product, @merchant, @mcc, @amount, @currency,
       @timestamp, @category_hint, @flight_number, @flight_date, @flags_json, @raw_json, 'new')
  `);
  for (const t of txns) {
    insTxn.run({
      transaction_id: t.transaction_id,
      card_last4: t.card_last4,
      card_product: t.card_product,
      merchant: t.merchant,
      mcc: String(t.mcc),
      amount: t.amount,
      currency: t.currency,
      timestamp: t.timestamp,
      category_hint: t.category_hint || null,
      flight_number: t.flight_number || null,
      flight_date: t.flight_date || null,
      flags_json: t.flags ? JSON.stringify(t.flags) : null,
      raw_json: JSON.stringify(t)
    });
  }

  // Pre-seed ONE claim so the duplicate stub has something to reject in the demo
  // (txn_1501). See stubs / duplicateCheck.
  db.prepare(`
    INSERT INTO claims (reference, transaction_id, benefit_type, draft_json, what_happened, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "PP-4820",
    "txn_1501",
    "purchase_protection",
    JSON.stringify({ note: "pre-seeded claim for duplicate demo" }),
    "Screen cracked",
    "in_review",
    new Date().toISOString()
  );
}

initSchema();
seed();

export default db;
