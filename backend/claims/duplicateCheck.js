/**
 * claims/duplicateCheck.js
 * ---------------------------------------------------------------------------
 * Duplicate / abuse guard.
 *
 * STANDS IN FOR: a fraud/abuse service that cross-checks a claim against
 * existing claims, merchant refunds, warranty claims, and velocity rules.
 *
 * WHAT IT CHECKS HERE:
 *   1. A claim already exists for this transaction_id (double filing).
 *   2. The transaction was already refunded by the merchant.
 *   3. The item is already being claimed under a manufacturer warranty.
 * Any hit -> claim is BLOCKED with a clear reason (no adjudication happens).
 * ---------------------------------------------------------------------------
 */

/**
 * checkDuplicateOrAbuse(db, transaction) -> { blocked, reason|null }
 */
export function checkDuplicateOrAbuse(db, transaction) {
  // 1) Already claimed?
  const existing = db
    .prepare("SELECT reference FROM claims WHERE transaction_id = ?")
    .get(transaction.transaction_id);
  if (existing) {
    return {
      blocked: true,
      code: "DUPLICATE_CLAIM",
      reason: `A claim (${existing.reference}) already exists for transaction ${transaction.transaction_id}.`
    };
  }

  // 2 & 3) Abuse flags carried on the transaction.
  const flags = transaction.flags_json ? JSON.parse(transaction.flags_json) : {};
  if (flags.already_refunded) {
    return {
      blocked: true,
      code: "ALREADY_REFUNDED",
      reason: "This purchase was already refunded by the merchant — it is not eligible for a protection payout."
    };
  }
  if (flags.under_manufacturer_warranty_claim) {
    return {
      blocked: true,
      code: "WARRANTY_DOUBLE_DIP",
      reason: "This item is already being claimed under a manufacturer warranty — double-dipping is not allowed."
    };
  }

  return { blocked: false, reason: null };
}
