"""
main.py -- Backend REST API (FastAPI)
---------------------------------------------------------------------------
Wires together the Data Layer, Detection Engine, Claims Layer, mock stream, and
the external-dependency stubs. Single demo card member, no auth.

Exposes the SAME REST contract as the Node/Express backend, so the existing
React frontend (which proxies /api -> http://localhost:4000) works unchanged.
Run with:  uvicorn main:app --port 4000   (or:  python main.py)
---------------------------------------------------------------------------
"""

import json

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from db import query, ENTITLEMENTS
from stream.stream_emitter import stream
from claims.claims_layer import build_draft, submit_claim, get_claim_status, list_claims

app = FastAPI(title="Covered backend (Python)")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

PORT = 4000


def shape_txn(row):
    """Hydrate a transaction row for the frontend (parse JSON columns)."""
    raw = json.loads(row["raw_json"]) if row.get("raw_json") else {}
    return {
        "transaction_id": row["transaction_id"],
        "card_last4": row["card_last4"],
        "card_product": row["card_product"],
        "merchant": row["merchant"],
        "mcc": row["mcc"],
        "amount": row["amount"],
        "currency": row["currency"],
        "timestamp": row["timestamp"],
        "category_hint": row["category_hint"],
        "status": row["status"],
        "benefit_type": row["benefit_type"],
        "coverage": json.loads(row["coverage_json"]) if row["coverage_json"] else None,
        "confidence": row["confidence"],
        "demo_note": raw.get("_demo_note"),
    }


# --- Transactions ----------------------------------------------------------
@app.get("/transactions")
def get_transactions():
    rows = query("SELECT * FROM transactions ORDER BY timestamp DESC")
    return [shape_txn(r) for r in rows]


@app.post("/transactions/stream/start")
def stream_start():
    stream.start()
    return {"running": stream.is_running()}


@app.post("/transactions/stream/stop")
def stream_stop():
    stream.stop()
    return {"running": stream.is_running()}


@app.get("/transactions/stream/status")
def stream_status():
    pending = query("SELECT COUNT(*) AS n FROM transactions WHERE status = 'new'", one=True)["n"]
    return {"running": stream.is_running(), "pending": pending}


# --- Coverages -------------------------------------------------------------
@app.get("/coverages")
def get_coverages():
    rows = query(
        "SELECT * FROM transactions WHERE status IN ('eligible','quick_confirm','claimed') ORDER BY timestamp DESC"
    )
    return [shape_txn(r) for r in rows]


# --- Claims ----------------------------------------------------------------
@app.get("/claims/{transaction_id}/draft")
def get_draft(transaction_id: str):
    draft = build_draft(transaction_id)
    if draft.get("error"):
        return JSONResponse(status_code=404, content=draft)
    return draft


@app.post("/claims")
async def post_claim(request: Request):
    payload = await request.json()
    result = submit_claim(payload)
    if not result["ok"]:
        return JSONResponse(status_code=409, content=result)  # 409 = blocked/duplicate
    return JSONResponse(status_code=201, content=result)


@app.get("/claims/{reference}/status")
def claim_status(reference: str):
    status = get_claim_status(reference)
    if not status:
        return JSONResponse(status_code=404, content={"error": "claim_not_found"})
    return status


# --- Benefits tab ----------------------------------------------------------
@app.get("/benefits")
def get_benefits():
    coverages = query(
        "SELECT * FROM transactions WHERE status IN ('eligible','quick_confirm','claimed') ORDER BY timestamp DESC"
    )
    return {
        "entitlements": [
            {
                "benefit_type": b["benefit_type"],
                "display_name": b["display_name"],
                "per_item_limit": b["per_item_limit"],
                "coverage_window_days": b["coverage_window_days"],
            }
            for b in ENTITLEMENTS["benefits"]
        ],
        "coverages": [shape_txn(r) for r in coverages],
        "claims": list_claims(),
    }


# --- Debug / admin: per-transaction evaluation trace -----------------------
@app.get("/debug/evaluations")
def debug_evaluations():
    rows = query("SELECT * FROM transactions ORDER BY timestamp DESC")
    out = []
    for r in rows:
        raw = json.loads(r["raw_json"]) if r["raw_json"] else {}
        out.append({
            "transaction_id": r["transaction_id"],
            "merchant": r["merchant"],
            "mcc": r["mcc"],
            "amount": r["amount"],
            "status": r["status"],
            "confidence": r["confidence"],
            "benefit_type": r["benefit_type"],
            "trace": json.loads(r["trace_json"]) if r["trace_json"] else None,
            "demo_note": raw.get("_demo_note"),
        })
    return out


@app.get("/health")
def health():
    return {"ok": True}


@app.on_event("startup")
def _boot_banner():
    n = query("SELECT COUNT(*) AS n FROM transactions", one=True)["n"]
    print(f"\n\U0001F4B3  Covered backend (Python/FastAPI) on http://localhost:{PORT}")
    print(f"    Seeded {n} transactions.")
    print(f"    POST /transactions/stream/start to begin the live feed.\n")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
