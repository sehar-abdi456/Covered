"""
engine/classifier.py
---------------------------------------------------------------------------
STANDS IN FOR: a trained ML merchant/item classifier (e.g. a scikit-learn or
PyTorch model served behind an inference endpoint).

WHAT IT DOES HERE: a deterministic keyword/category scoring function that
returns {"category", "confidence"} for a transaction. It is intentionally
exposed through a single `predict(transaction)` function so a real model can be
dropped in later with ZERO changes to the callers -- the Detection Engine only
ever calls `predict()`.

TO MAKE IT REAL: replace the body of `predict()` with a call to the model
service (build features -> model.predict_proba -> return top class + prob). The
signature stays identical.
---------------------------------------------------------------------------
"""

# Merchant-name keyword hints -> category. A real model would learn these from
# labelled transaction history instead of a hand-written table.
MERCHANT_KEYWORDS = [
    {"kw": ["apple", "sony", "samsung", "dell", "best buy", "b&h", "microcenter"], "category": "electronics", "weight": 0.95},
    {"kw": ["nordstrom", "zara", "uniqlo", "macy", "gap", "h&m"], "category": "apparel", "weight": 0.90},
    {"kw": ["rei", "dick's", "patagonia"], "category": "sporting_goods", "weight": 0.90},
    {"kw": ["tiffany", "cartier", "pandora"], "category": "jewelry", "weight": 0.92},
    {"kw": ["delta", "united", "american airlines", "jetblue", "southwest"], "category": "airline", "weight": 0.97},
    {"kw": ["whole foods", "trader joe", "safeway", "kroger"], "category": "perishables", "weight": 0.95},
    {"kw": ["shell", "chevron", "exxon", "bp "], "category": "fuel", "weight": 0.90},
    {"kw": ["hertz", "avis car sales", "carmax"], "category": "vehicles", "weight": 0.90},
    {"kw": ["ticketmaster", "stubhub", "axs"], "category": "tickets", "weight": 0.90},
    {"kw": ["grubhub", "doordash", "uber eats", "restaurant"], "category": "services", "weight": 0.90},
    {"kw": ["atm", "cash withdrawal", "western union"], "category": "cash_equivalents", "weight": 0.97},
    # Deliberately AMBIGUOUS merchants -- mixed inventory, so we score them low.
    {"kw": ["amazon", "walmart", "target", "costco", "ebay"], "category": "marketplace", "weight": 0.45},
]


def predict(transaction):
    """predict(transaction) -> {"category", "confidence"}

    confidence is a 0..1 score. High => the fuzzy layer is sure; low => the
    Detection Engine should route to a "quick confirm" step.
    """
    name = (transaction.get("merchant") or "").lower()
    hint = (transaction.get("category_hint") or "").lower()

    # 1) Match the merchant name against known keyword groups.
    for group in MERCHANT_KEYWORDS:
        if any(k in name for k in group["kw"]):
            return {"category": group["category"], "confidence": group["weight"]}

    # 2) Fall back to the issuer-provided category hint, but with lower
    #    confidence because we could not corroborate it from the merchant name.
    if hint:
        ambiguous = {"marketplace", "warehouse_club", "fuel", "other"}
        confidence = 0.4 if hint in ambiguous else 0.6
        return {"category": hint, "confidence": confidence}

    # 3) Nothing to go on.
    return {"category": "unknown", "confidence": 0.2}
