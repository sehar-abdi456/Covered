/**
 * claims/claimsLayer.js
 * ---------------------------------------------------------------------------
 * The Claims Layer. Given a detected + matched transaction it:
 *   - builds a pre-filled DRAFT claim (this is the "pre-fill" step),
 *   - runs the duplicate/abuse guard on submit,
 *   - submits into the (mocked) adjudication system and stores the claim,
 *   - reads back live status for the tracker.
 *
 * Covered pre-fills everything the member would otherwise type by hand; the
 * member only supplies "what happened" + a photo. Covered does NOT adjudicate.
 * ---------------------------------------------------------------------------
 */

import db, { entitlements } from "../db.js";
import { evaluateTransaction } from "../engine/detectionEngine.js";
import { checkDuplicateOrAbuse } from "./duplicateCheck.js";
import { submitToAdjudicator, getAdjudicationStatus } from "../stubs/adjudication.js";
import { getReceipt } from "../stubs/eReceipt.js";

function getTxn(transactionId) {
  return db.prepare("SELECT * FROM transactions WHERE transaction_id = ?").get(transactionId);
}

/**
 * buildDraft(transactionId) -> pre-filled claim draft (read-only fields).
 * Everything here is DERIVED from data — nothing the member types.
 */
export function buildDraft(transactionId) {
  const txn = getTxn(transactionId);
  if (!txn) return { error: "transaction_not_found" };

  const raw = JSON.parse(txn.raw_json);
  const result = evaluateTransaction(raw, entitlements);

  if (result.status === "ineligible" || !result.coverage) {
    return { error: "not_eligible", detail: "No matching benefit for this transaction." };
  }

  const c = result.coverage;
  return {
    transaction_id: txn.transaction_id,
    // --- pre-filled, read-only fields shown on the claim review screen ---
    card_last4: txn.card_last4,
    card_product: txn.card_product,
    merchant: txn.merchant,
    amount: txn.amount,
    currency: txn.currency,
    purchase_date: txn.timestamp.slice(0, 10),
    benefit_type: c.benefit_type,
    benefit_display_name: c.display_name,
    coverage_limit: c.coverage_limit,
    filing_deadline: c.filing_deadline,
    days_left: c.days_left,
    // extra context surfaced only when useful (e.g. ambiguous purchases)
    receipt: getReceipt(txn.transaction_id),
    flight: result.flight,
    requires_confirmation: result.status === "quick_confirm",
    // --- the ONLY two member-editable inputs ---
    editable_fields: ["what_happened", "photo_filename"]
  };
}

/**
 * submitClaim({ transaction_id, what_happened, photo_filename })
 *   -> { ok, reference } | { ok:false, code, reason }
 */
export function submitClaim({ transaction_id, what_happened, photo_filename }) {
  const txn = getTxn(transaction_id);
  if (!txn) return { ok: false, code: "NOT_FOUND", reason: "Transaction not found." };

  // Duplicate / abuse guard BEFORE anything is submitted downstream.
  const guard = checkDuplicateOrAbuse(db, txn);
  if (guard.blocked) {
    return { ok: false, code: guard.code, reason: guard.reason };
  }

  // Re-evaluate to attach the matched benefit + coverage to the claim.
  const raw = JSON.parse(txn.raw_json);
  const result = evaluateTransaction(raw, entitlements);
  if (!result.coverage) {
    return { ok: false, code: "NOT_ELIGIBLE", reason: "No matching benefit for this transaction." };
  }

  // Hand off to the (mocked) adjudication system.
  const ack = submitToAdjudicator({ benefit_type: result.benefit_type });

  db.prepare(`
    INSERT INTO claims
      (reference, transaction_id, benefit_type, draft_json, what_happened, photo_filename, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ack.reference,
    transaction_id,
    result.benefit_type,
    JSON.stringify(result.coverage),
    what_happened || null,
    photo_filename || null,
    "submitted",
    new Date().toISOString()
  );

  db.prepare("UPDATE transactions SET status = 'claimed' WHERE transaction_id = ?").run(transaction_id);

  return { ok: true, reference: ack.reference, status: "submitted" };
}

/**
 * getClaimStatus(reference) — reads live status from the adjudication stub and
 * mirrors it into the claims table. This is the ONLY place a status advances.
 */
export function getClaimStatus(reference) {
  const claim = db.prepare("SELECT * FROM claims WHERE reference = ?").get(reference);
  if (!claim) return null;

  const live = getAdjudicationStatus(reference);
  if (live) {
    db.prepare("UPDATE claims SET status = ?, decision = ? WHERE reference = ?").run(
      live.status,
      live.decision,
      reference
    );
    claim.status = live.status;
    claim.decision = live.decision;
  }
  return {
    reference: claim.reference,
    transaction_id: claim.transaction_id,
    benefit_type: claim.benefit_type,
    status: claim.status,
    decision: claim.decision
  };
}

export function listClaims() {
  return db.prepare("SELECT * FROM claims ORDER BY id DESC").all().map((c) => {
    // Refresh each claim's status from the adjudicator on read.
    const live = getAdjudicationStatus(c.reference);
    if (live) {
      db.prepare("UPDATE claims SET status = ?, decision = ? WHERE reference = ?").run(
        live.status, live.decision, c.reference
      );
      c.status = live.status;
      c.decision = live.decision;
    }
    return {
      reference: c.reference,
      transaction_id: c.transaction_id,
      benefit_type: c.benefit_type,
      what_happened: c.what_happened,
      status: c.status,
      decision: c.decision,
      created_at: c.created_at
    };
  });
}
