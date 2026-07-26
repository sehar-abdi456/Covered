/**
 * server.js — Backend REST API (Express)
 * ---------------------------------------------------------------------------
 * Wires together the Data Layer, Detection Engine, Claims Layer, mock stream,
 * and the external-dependency stubs. Single demo card member, no auth.
 * ---------------------------------------------------------------------------
 */

import express from "express";
import cors from "cors";
import db, { entitlements } from "./db.js";
import stream from "./stream/streamEmitter.js";
import { buildDraft, submitClaim, getClaimStatus, listClaims } from "./claims/claimsLayer.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// Helper: hydrate a transaction row for the frontend (parse JSON columns).
function shapeTxn(row) {
  return {
    transaction_id: row.transaction_id,
    card_last4: row.card_last4,
    card_product: row.card_product,
    merchant: row.merchant,
    mcc: row.mcc,
    amount: row.amount,
    currency: row.currency,
    timestamp: row.timestamp,
    category_hint: row.category_hint,
    status: row.status,
    benefit_type: row.benefit_type,
    coverage: row.coverage_json ? JSON.parse(row.coverage_json) : null,
    confidence: row.confidence,
    demo_note: row.raw_json ? JSON.parse(row.raw_json)._demo_note : null
  };
}

// --- Transactions ----------------------------------------------------------
app.get("/transactions", (_req, res) => {
  const rows = db.prepare("SELECT * FROM transactions ORDER BY timestamp DESC").all();
  res.json(rows.map(shapeTxn));
});

// Control the mock live feed.
app.post("/transactions/stream/start", (_req, res) => {
  stream.start();
  res.json({ running: stream.isRunning() });
});
app.post("/transactions/stream/stop", (_req, res) => {
  stream.stop();
  res.json({ running: stream.isRunning() });
});
app.get("/transactions/stream/status", (_req, res) => {
  const pending = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status = 'new'").get().n;
  res.json({ running: stream.isRunning(), pending });
});

// --- Coverages (currently-detected eligible coverages for the demo user) ---
app.get("/coverages", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM transactions WHERE status IN ('eligible','quick_confirm','claimed') ORDER BY timestamp DESC")
    .all();
  res.json(rows.map(shapeTxn));
});

// --- Claims ----------------------------------------------------------------
// Pre-filled draft for a given transaction. (:id = transaction_id)
app.get("/claims/:id/draft", (req, res) => {
  const draft = buildDraft(req.params.id);
  if (draft.error) return res.status(404).json(draft);
  res.json(draft);
});

// Submit a claim (runs duplicate/abuse guard, then stores + hands off).
app.post("/claims", (req, res) => {
  const result = submitClaim(req.body || {});
  if (!result.ok) return res.status(409).json(result); // 409 = blocked/duplicate
  res.status(201).json(result);
});

// Fetch current status. (:id = reference, e.g. PP-4821)
app.get("/claims/:id/status", (req, res) => {
  const status = getClaimStatus(req.params.id);
  if (!status) return res.status(404).json({ error: "claim_not_found" });
  res.json(status);
});

// --- Benefits tab (coverages + claims + statuses) --------------------------
app.get("/benefits", (_req, res) => {
  const coverages = db
    .prepare("SELECT * FROM transactions WHERE status IN ('eligible','quick_confirm','claimed') ORDER BY timestamp DESC")
    .all()
    .map(shapeTxn);
  res.json({
    entitlements: entitlements.benefits.map((b) => ({
      benefit_type: b.benefit_type,
      display_name: b.display_name,
      per_item_limit: b.per_item_limit,
      coverage_window_days: b.coverage_window_days
    })),
    coverages,
    claims: listClaims()
  });
});

// --- Debug / admin: per-transaction evaluation trace (proves the rules) ----
app.get("/debug/evaluations", (_req, res) => {
  const rows = db.prepare("SELECT * FROM transactions ORDER BY timestamp DESC").all();
  res.json(
    rows.map((r) => ({
      transaction_id: r.transaction_id,
      merchant: r.merchant,
      mcc: r.mcc,
      amount: r.amount,
      status: r.status,
      confidence: r.confidence,
      benefit_type: r.benefit_type,
      trace: r.trace_json ? JSON.parse(r.trace_json) : null,
      demo_note: r.raw_json ? JSON.parse(r.raw_json)._demo_note : null
    }))
  );
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`\n💳  Covered backend listening on http://localhost:${PORT}`);
  console.log(`    Seeded ${db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n} transactions.`);
  console.log(`    POST /transactions/stream/start to begin the live feed.\n`);
});
