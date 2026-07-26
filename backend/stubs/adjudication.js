/**
 * stubs/adjudication.js
 * ---------------------------------------------------------------------------
 * STANDS IN FOR: the real Amex claims / adjudication system — the "black box"
 * our Claims Layer submits into. Covered NEVER adjudicates; it only hands a
 * pre-filled claim to this downstream system.
 *
 * WHAT IT DOES HERE: an in-memory state machine. On submit it acknowledges and
 * returns a reference number, then advances the claim's status over time
 * (submitted -> in_review -> decision) so the UI status tracker has something
 * real to poll. THIS IS THE ONLY PLACE A CLAIM STATUS CHANGES — proving
 * Covered does not auto-approve anything.
 *
 * WHAT WOULD CHANGE TO MAKE IT REAL: replace this module with a client that
 * POSTs to the adjudication service and reads back status webhooks/events.
 * ---------------------------------------------------------------------------
 */

// reference -> { status, submittedAt, decision }
const registry = new Map();

// Demo pacing: how long (ms) the mock adjudicator spends in each stage.
const IN_REVIEW_AFTER_MS = 8000;   // submitted -> in_review
const DECISION_AFTER_MS = 20000;   // submitted -> decision

const PREFIX = {
  purchase_protection: "PP",
  return_protection: "RP",
  travel_delay: "TD"
};

let counter = 4820;

export function submitToAdjudicator(claim) {
  counter += 1;
  const reference = `${PREFIX[claim.benefit_type] || "CL"}-${counter}`;
  registry.set(reference, {
    reference,
    status: "submitted",
    submittedAt: Date.now(),
    decision: null
  });
  return { reference, status: "submitted", acknowledged: true };
}

/**
 * Compute the CURRENT status from elapsed time. Pull-based so we don't need
 * background timers — the status is a pure function of "how long since submit".
 */
export function getAdjudicationStatus(reference) {
  const rec = registry.get(reference);
  if (!rec) return null;

  const elapsed = Date.now() - rec.submittedAt;
  let status = "submitted";
  let decision = null;

  if (elapsed >= DECISION_AFTER_MS) {
    status = "decision";
    decision = "approved"; // demo: mock adjudicator approves after review
  } else if (elapsed >= IN_REVIEW_AFTER_MS) {
    status = "in_review";
  }

  rec.status = status;
  rec.decision = decision;
  return { reference, status, decision };
}
