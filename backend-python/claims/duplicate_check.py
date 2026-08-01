"""
claims/duplicate_check.py
---------------------------------------------------------------------------
Duplicate / abuse guard.

STANDS IN FOR: a fraud/abuse service that cross-checks a claim against existing
claims, merchant refunds, warranty claims, and velocity rules.

WHAT IT CHECKS HERE:
  1. A claim already exists for this transaction_id (double filing).
  2. The transaction was already refunded by the merchant.
  3. The item is already being claimed under a manufacturer warranty.
Any hit -> claim is BLOCKED with a clear reason (no adjudication happens).
---------------------------------------------------------------------------
"""

import json
from db import query


def check_duplicate_or_abuse(transaction):
    """check_duplicate_or_abuse(transaction_row) -> {"blocked", "code", "reason"}"""
    # 1) Already claimed?
    existing = query(
        "SELECT reference FROM claims WHERE transaction_id = ?",
        (transaction["transaction_id"],),
        one=True,
    )
    if existing:
        return {
            "blocked": True,
            "code": "DUPLICATE_CLAIM",
            "reason": f"A claim ({existing['reference']}) already exists for transaction {transaction['transaction_id']}.",
        }

    # 2 & 3) Abuse flags carried on the transaction.
    flags = json.loads(transaction["flags_json"]) if transaction.get("flags_json") else {}
    if flags.get("already_refunded"):
        return {
            "blocked": True,
            "code": "ALREADY_REFUNDED",
            "reason": "This purchase was already refunded by the merchant -- it is not eligible for a protection payout.",
        }
    if flags.get("under_manufacturer_warranty_claim"):
        return {
            "blocked": True,
            "code": "WARRANTY_DOUBLE_DIP",
            "reason": "This item is already being claimed under a manufacturer warranty -- double-dipping is not allowed.",
        }

    return {"blocked": False, "code": None, "reason": None}
