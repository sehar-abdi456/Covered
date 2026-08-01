"""
claims/claims_layer.py
---------------------------------------------------------------------------
The Claims Layer. Given a detected + matched transaction it:
  - builds a pre-filled DRAFT claim (the "pre-fill" step),
  - runs the duplicate/abuse guard on submit,
  - submits into the (mocked) adjudication system and stores the claim,
  - reads back live status for the tracker.

Covered pre-fills everything the member would otherwise type by hand; the member
only supplies "what happened" + a photo. Covered does NOT adjudicate.
---------------------------------------------------------------------------
"""

import json
from datetime import datetime, timezone

from db import query, ENTITLEMENTS
from engine.detection_engine import evaluate_transaction
from claims.duplicate_check import check_duplicate_or_abuse
from stubs.adjudication import submit_to_adjudicator, get_adjudication_status
from stubs.e_receipt import get_receipt


def _get_txn(transaction_id):
    return query("SELECT * FROM transactions WHERE transaction_id = ?", (transaction_id,), one=True)


def build_draft(transaction_id):
    """build_draft(transaction_id) -> pre-filled claim draft (read-only fields).
    Everything here is DERIVED from data -- nothing the member types.
    """
    txn = _get_txn(transaction_id)
    if not txn:
        return {"error": "transaction_not_found"}

    raw = json.loads(txn["raw_json"])
    result = evaluate_transaction(raw, ENTITLEMENTS)

    if result["status"] == "ineligible" or not result["coverage"]:
        return {"error": "not_eligible", "detail": "No matching benefit for this transaction."}

    c = result["coverage"]
    return {
        "transaction_id": txn["transaction_id"],
        # --- pre-filled, read-only fields shown on the claim review screen ---
        "card_last4": txn["card_last4"],
        "card_product": txn["card_product"],
        "merchant": txn["merchant"],
        "amount": txn["amount"],
        "currency": txn["currency"],
        "purchase_date": txn["timestamp"][:10],
        "benefit_type": c["benefit_type"],
        "benefit_display_name": c["display_name"],
        "coverage_limit": c["coverage_limit"],
        "filing_deadline": c["filing_deadline"],
        "days_left": c["days_left"],
        # extra context surfaced only when useful (e.g. ambiguous purchases)
        "receipt": get_receipt(txn["transaction_id"]),
        "flight": result["flight"],
        "requires_confirmation": result["status"] == "quick_confirm",
        # --- the ONLY two member-editable inputs ---
        "editable_fields": ["what_happened", "photo_filename"],
    }


def submit_claim(payload):
    """submit_claim({transaction_id, what_happened, photo_filename})
    -> {"ok": True, "reference", "status"} | {"ok": False, "code", "reason"}
    """
    transaction_id = payload.get("transaction_id")
    txn = _get_txn(transaction_id)
    if not txn:
        return {"ok": False, "code": "NOT_FOUND", "reason": "Transaction not found."}

    # Duplicate / abuse guard BEFORE anything is submitted downstream.
    guard = check_duplicate_or_abuse(txn)
    if guard["blocked"]:
        return {"ok": False, "code": guard["code"], "reason": guard["reason"]}

    # Re-evaluate to attach the matched benefit + coverage to the claim.
    raw = json.loads(txn["raw_json"])
    result = evaluate_transaction(raw, ENTITLEMENTS)
    if not result["coverage"]:
        return {"ok": False, "code": "NOT_ELIGIBLE", "reason": "No matching benefit for this transaction."}

    # Hand off to the (mocked) adjudication system.
    ack = submit_to_adjudicator({"benefit_type": result["benefit_type"]})

    query(
        """
        INSERT INTO claims
          (reference, transaction_id, benefit_type, draft_json, what_happened, photo_filename, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            ack["reference"], transaction_id, result["benefit_type"],
            json.dumps(result["coverage"]), payload.get("what_happened"),
            payload.get("photo_filename"), "submitted", datetime.now(timezone.utc).isoformat(),
        ),
        write=True,
    )
    query("UPDATE transactions SET status = 'claimed' WHERE transaction_id = ?", (transaction_id,), write=True)

    return {"ok": True, "reference": ack["reference"], "status": "submitted"}


def get_claim_status(reference):
    """Reads live status from the adjudication stub and mirrors it into the
    claims table. This is the ONLY place a status advances."""
    claim = query("SELECT * FROM claims WHERE reference = ?", (reference,), one=True)
    if not claim:
        return None

    live = get_adjudication_status(reference)
    if live:
        query(
            "UPDATE claims SET status = ?, decision = ? WHERE reference = ?",
            (live["status"], live["decision"], reference), write=True,
        )
        claim["status"] = live["status"]
        claim["decision"] = live["decision"]

    return {
        "reference": claim["reference"],
        "transaction_id": claim["transaction_id"],
        "benefit_type": claim["benefit_type"],
        "status": claim["status"],
        "decision": claim["decision"],
    }


def list_claims():
    rows = query("SELECT * FROM claims ORDER BY id DESC")
    out = []
    for c in rows:
        live = get_adjudication_status(c["reference"])
        if live:
            query(
                "UPDATE claims SET status = ?, decision = ? WHERE reference = ?",
                (live["status"], live["decision"], c["reference"]), write=True,
            )
            c["status"] = live["status"]
            c["decision"] = live["decision"]
        out.append({
            "reference": c["reference"],
            "transaction_id": c["transaction_id"],
            "benefit_type": c["benefit_type"],
            "what_happened": c["what_happened"],
            "status": c["status"],
            "decision": c["decision"],
            "created_at": c["created_at"],
        })
    return out
