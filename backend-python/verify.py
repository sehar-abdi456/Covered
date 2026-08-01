"""
verify.py -- console-verifiable proof of the pipeline.
Run:  python verify.py
Evaluates every seeded transaction and prints the routing decision + the
duplicate/abuse guard results, so you can confirm the engine works WITHOUT the
frontend.
"""

import json

from db import query
from stream.stream_emitter import stream
from claims.duplicate_check import check_duplicate_or_abuse
from claims.claims_layer import build_draft

print("\n=== 1) DETECTION ENGINE: evaluate every seeded transaction ===\n")
stream.drain_now()

rows = query("SELECT * FROM transactions ORDER BY timestamp DESC")
buckets = {"eligible": [], "quick_confirm": [], "ineligible": [], "claimed": []}
for r in rows:
    buckets.setdefault(r["status"], []).append(r)


def line(r):
    bt = f"  -> {r['benefit_type']}" if r["benefit_type"] else ""
    conf = r["confidence"] if r["confidence"] is not None else 0
    return (f"  {r['transaction_id']:<9} {str(r['merchant']):<20} mcc:{str(r['mcc']):<5} "
            f"${str(r['amount']):<9} conf:{conf:.2f}{bt}")


print(f"ELIGIBLE (auto-draft)  [{len(buckets['eligible'])}]")
for r in buckets["eligible"]:
    print(line(r))
print(f"\nQUICK_CONFIRM (low confidence)  [{len(buckets['quick_confirm'])}]")
for r in buckets["quick_confirm"]:
    print(line(r))
print(f"\nINELIGIBLE (dropped silently)  [{len(buckets['ineligible'])}]")
for r in buckets["ineligible"]:
    print(line(r))

print("\n=== 2) DUPLICATE / ABUSE GUARD on the seeded abuse cases ===\n")
for tid in ["txn_1501", "txn_1502", "txn_1503", "txn_1001"]:
    txn = query("SELECT * FROM transactions WHERE transaction_id = ?", (tid,), one=True)
    guard = check_duplicate_or_abuse(txn)
    tail = f"  [{guard['code']}] {guard['reason']}" if guard["blocked"] else ""
    print(f"  {tid}  {'BLOCKED' if guard['blocked'] else 'ok'}{tail}")

print("\n=== 3) HERO CASE draft (txn_1001) ===\n")
print(json.dumps(build_draft("txn_1001"), indent=2))

print("\nDone.\n")
