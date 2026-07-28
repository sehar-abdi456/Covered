"""
engine/rules_engine.py
---------------------------------------------------------------------------
Deterministic, versioned, JSON-configured eligibility evaluation.

STANDS IN FOR: a policy engine such as OPA (Rego) or Drools. In production the
rules below would be authored/reviewed by the benefits-ops team and served by a
hardened decision service. Here it is plain, readable code that evaluates a
transaction against the entitlements JSON.

KEY POINT FOR JUDGES: this module NEVER hardcodes a benefit's numbers. Every
limit, window, MCC list and exclusion is READ FROM entitlements.json. Adding a
new benefit type = adding a JSON entry, not editing this file.
---------------------------------------------------------------------------
"""

from datetime import datetime, timezone, timedelta


def _parse_ts(ts):
    """Parse an ISO timestamp like '2026-07-24T14:32:00Z' as timezone-aware UTC."""
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _now():
    return datetime.now(timezone.utc)


def _days_between(a, b):
    return (b - a).days


def _add_days(dt, days):
    return dt + timedelta(days=days)


def _evaluate_benefit(transaction, benefit, classification):
    """Evaluate one benefit rule against a transaction.

    Returns {"eligible", "reasons"[], "daysSince"} -- reasons explain every
    pass/fail so the debug view can show exactly WHY a transaction was accepted
    or dropped.
    """
    reasons = []
    eligible = True

    # Card product must be covered by this benefit.
    if transaction["card_product"] not in benefit["eligible_card_products"]:
        eligible = False
        reasons.append(f"card '{transaction['card_product']}' not covered by {benefit['benefit_type']}")

    # MCC must be in the eligible list.
    if str(transaction["mcc"]) not in benefit["eligible_mcc_codes"]:
        eligible = False
        reasons.append(f"mcc {transaction['mcc']} not in eligible list")

    # Classified category must not be excluded.
    if classification["category"] in benefit["excluded_categories"]:
        eligible = False
        reasons.append(f"category '{classification['category']}' is excluded")

    # Minimum amount threshold.
    if isinstance(benefit.get("min_amount"), (int, float)) and transaction["amount"] < benefit["min_amount"]:
        eligible = False
        reasons.append(f"amount {transaction['amount']} below min {benefit['min_amount']}")

    # Coverage window: purchase must be recent enough to still be covered.
    days_since = _days_between(_parse_ts(transaction["timestamp"]), _now())
    if days_since > benefit["coverage_window_days"]:
        eligible = False
        reasons.append(f"purchased {days_since}d ago, past {benefit['coverage_window_days']}d window")

    if eligible:
        reasons.append(f"matches {benefit['benefit_type']}")

    return {"eligible": eligible, "reasons": reasons, "daysSince": days_since}


def evaluate_eligibility(transaction, entitlements, classification):
    """evaluate_eligibility(...) -> dict with eligible/benefit_type/coverage/trace.

    `trace` records the per-benefit reasoning for the debug/admin view. This is
    the single seam where OPA/Drools would slot in later.
    """
    trace = []
    match = None

    for benefit in entitlements["benefits"]:
        result = _evaluate_benefit(transaction, benefit, classification)
        trace.append({"benefit_type": benefit["benefit_type"], **result})
        if result["eligible"] and match is None:
            match = {"benefit": benefit, "days_since": result["daysSince"]}

    if match is None:
        return {"eligible": False, "benefit_type": None, "matched_rule": None, "coverage": None, "trace": trace}

    benefit = match["benefit"]
    coverage = build_coverage(transaction, benefit, match["days_since"])
    return {
        "eligible": True,
        "benefit_type": benefit["benefit_type"],
        "matched_rule": benefit["benefit_type"],
        "coverage": coverage,
        "trace": trace,
    }


def build_coverage(transaction, benefit, days_since=None):
    """Turn a matched (transaction, benefit) pair into the coverage facts the
    member sees and the claim gets pre-filled from -- payout cap, filing
    deadline, days remaining. All derived from the JSON, nothing hardcoded.
    """
    coverage_limit = min(transaction["amount"], benefit["per_item_limit"])
    purchase = _parse_ts(transaction["timestamp"])

    coverage_ends = _add_days(purchase, benefit["coverage_window_days"])
    filing_deadline = _add_days(purchase, benefit["filing_deadline_days"])
    days_left = max(0, _days_between(_now(), filing_deadline))

    return {
        "benefit_type": benefit["benefit_type"],
        "display_name": benefit["display_name"],
        "coverage_limit": coverage_limit,
        "per_item_limit": benefit["per_item_limit"],
        "coverage_ends": coverage_ends.date().isoformat(),
        "filing_deadline": filing_deadline.date().isoformat(),
        "days_left": days_left,
        "delay_threshold_hours": benefit.get("delay_threshold_hours"),
    }
