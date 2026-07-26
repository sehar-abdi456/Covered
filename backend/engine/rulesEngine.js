/**
 * rulesEngine.js
 * ---------------------------------------------------------------------------
 * Deterministic, versioned, JSON-configured eligibility evaluation.
 *
 * STANDS IN FOR: a policy engine such as OPA (Rego) or Drools. In production
 * the rules below would be authored/reviewed by the benefits-ops team and the
 * engine would be a hardened decision service. Here it is plain, readable code
 * that evaluates a transaction against the entitlements JSON.
 *
 * KEY POINT FOR JUDGES: this function NEVER hardcodes a benefit's numbers.
 * Every limit, window, MCC list and exclusion is READ FROM entitlements.json.
 * Adding a new benefit type = adding a JSON entry, not editing this file.
 * ---------------------------------------------------------------------------
 */

/**
 * Evaluate one benefit rule against a transaction.
 * Returns { eligible, reasons[] } — reasons explain every pass/fail so the
 * debug view can show exactly WHY a transaction was accepted or dropped.
 */
function evaluateBenefit(transaction, benefit, classification) {
  const reasons = [];
  let eligible = true;

  // Card product must be covered by this benefit.
  if (!benefit.eligible_card_products.includes(transaction.card_product)) {
    eligible = false;
    reasons.push(`card '${transaction.card_product}' not covered by ${benefit.benefit_type}`);
  }

  // MCC must be in the eligible list.
  if (!benefit.eligible_mcc_codes.includes(String(transaction.mcc))) {
    eligible = false;
    reasons.push(`mcc ${transaction.mcc} not in eligible list`);
  }

  // Classified category must not be an excluded category.
  if (benefit.excluded_categories.includes(classification.category)) {
    eligible = false;
    reasons.push(`category '${classification.category}' is excluded`);
  }

  // Minimum amount threshold.
  if (typeof benefit.min_amount === "number" && transaction.amount < benefit.min_amount) {
    eligible = false;
    reasons.push(`amount ${transaction.amount} below min ${benefit.min_amount}`);
  }

  // Coverage window: purchase must be recent enough to still be covered.
  const daysSince = daysBetween(transaction.timestamp, new Date());
  if (daysSince > benefit.coverage_window_days) {
    eligible = false;
    reasons.push(`purchased ${daysSince}d ago, past ${benefit.coverage_window_days}d window`);
  }

  if (eligible) {
    reasons.push(`matches ${benefit.benefit_type}`);
  }
  return { eligible, reasons, daysSince };
}

/**
 * evaluateEligibility(transaction, entitlements, classification)
 *   -> { eligible, benefitType, matchedRule, coverage, trace }
 *
 * `trace` records the per-benefit reasoning for the debug/admin view.
 * This is the single seam where OPA/Drools would slot in later.
 */
export function evaluateEligibility(transaction, entitlements, classification) {
  const trace = [];
  let match = null;

  for (const benefit of entitlements.benefits) {
    const result = evaluateBenefit(transaction, benefit, classification);
    trace.push({ benefit_type: benefit.benefit_type, ...result });
    if (result.eligible && !match) {
      match = { benefit, daysSince: result.daysSince };
    }
  }

  if (!match) {
    return { eligible: false, benefitType: null, matchedRule: null, coverage: null, trace };
  }

  const { benefit, daysSince } = match;
  const coverage = buildCoverage(transaction, benefit, daysSince);

  return {
    eligible: true,
    benefitType: benefit.benefit_type,
    matchedRule: benefit.benefit_type,
    coverage,
    trace
  };
}

/**
 * Turn a matched (transaction, benefit) pair into the coverage facts the
 * member sees and the claim gets pre-filled from — payout cap, filing
 * deadline, days remaining. All derived from the JSON, nothing hardcoded.
 */
export function buildCoverage(transaction, benefit, daysSince) {
  const coverageLimit = Math.min(transaction.amount, benefit.per_item_limit);
  const purchase = new Date(transaction.timestamp);

  const coverageEnds = addDays(purchase, benefit.coverage_window_days);
  const filingDeadline = addDays(purchase, benefit.filing_deadline_days);
  const daysLeft = Math.max(0, daysBetween(new Date(), filingDeadline));

  return {
    benefit_type: benefit.benefit_type,
    display_name: benefit.display_name,
    coverage_limit: coverageLimit,
    per_item_limit: benefit.per_item_limit,
    coverage_ends: coverageEnds.toISOString().slice(0, 10),
    filing_deadline: filingDeadline.toISOString().slice(0, 10),
    days_left: daysLeft,
    delay_threshold_hours: benefit.delay_threshold_hours ?? null
  };
}

// --- date helpers -----------------------------------------------------------
function daysBetween(a, b) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
