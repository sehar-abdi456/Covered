"""
stubs/e_receipt.py
---------------------------------------------------------------------------
STANDS IN FOR: an e-receipt / line-item connector (e.g. a merchant receipt feed,
or an email-receipt parser). In production we would request itemized receipt
data ONLY when needed to resolve an ambiguous transaction or to itemize a claim
-- never for every transaction (privacy + cost).

WHAT WOULD CHANGE TO MAKE IT REAL: replace the canned map with a call to the
receipt provider. Signature stays: get_receipt(transaction_id) -> receipt | None
---------------------------------------------------------------------------
"""

CANNED_RECEIPTS = {
    "txn_1001": {
        "line_items": [{"description": 'MacBook Air 13" M4', "qty": 1, "unit_price": 1199.0}],
        "itemized": True,
    },
    "txn_1401": {
        # Warehouse-club receipt showing a MIX of eligible + excluded items --
        # exactly the extra signal a "quick confirm" step would surface.
        "line_items": [
            {"description": "Sony WH-1000XM5 Headphones", "qty": 1, "unit_price": 279.0},
            {"description": "Rotisserie Chicken (perishable)", "qty": 2, "unit_price": 5.0},
            {"description": "Fuel", "qty": 1, "unit_price": 26.0},
        ],
        "itemized": True,
    },
}


def get_receipt(transaction_id):
    return CANNED_RECEIPTS.get(transaction_id)
