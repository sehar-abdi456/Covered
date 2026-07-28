# Covered — Python backend (FastAPI)

This is a **drop-in Python port** of the Node/Express backend. It exposes the
**identical REST API on port 4000**, so the existing React frontend in
[`../frontend`](../frontend) works against it **unchanged** — nothing in the
frontend needs editing to switch backends.

Same architecture, same seed data, same routing decisions (verified
byte-for-byte against the Node version): 15 eligible, 3 quick-confirm, 6 dropped,
all 3 abuse cases blocked.

## Run it

```bash
cd backend-python
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python main.py            # http://localhost:4000  (or: uvicorn main:app --port 4000)
```

Then, in another terminal, start the frontend as usual:

```bash
cd ../frontend
npm install
npm run dev               # http://localhost:5173  (proxies /api -> :4000)
```

> Run **either** the Node backend (`../backend`) **or** this Python backend —
> both listen on port 4000, so only one at a time.

### Engine proof with no UI

```bash
python verify.py          # prints every transaction's routing decision + the
                          # duplicate/abuse results to the console
```

## Structure (mirrors the Node backend)

```
backend-python/
├── main.py                     # FastAPI app + all endpoints
├── db.py                       # SQLite data layer (thread-safe shared conn)
├── verify.py                   # console-verifiable pipeline proof
├── requirements.txt
├── seed_data/
│   ├── entitlements.json        # machine-readable T&Cs — the RULE PACK
│   └── transactions.json        # 24 seeded transactions
├── engine/
│   ├── rules_engine.py          # deterministic, JSON-configured eligibility
│   ├── classifier.py            # ML-style classifier STUB (predict → {category, confidence})
│   └── detection_engine.py      # rules + classifier + confidence routing
├── claims/
│   ├── claims_layer.py           # drafts, submit, track status
│   └── duplicate_check.py        # duplicate/abuse guard
├── stream/
│   └── stream_emitter.py         # mock "Kafka" feed (background thread)
└── stubs/
    ├── flight_status.py          # flight-status API stub
    ├── e_receipt.py             # e-receipt / line-item connector stub
    └── adjudication.py           # Amex claims/adjudication black-box stub
```

## Endpoints (identical contract to the Node backend)

`GET /transactions` · `POST /transactions/stream/start|stop` ·
`GET /transactions/stream/status` · `GET /coverages` ·
`GET /claims/{transaction_id}/draft` · `POST /claims` ·
`GET /claims/{reference}/status` · `GET /benefits` ·
`GET /debug/evaluations` · `GET /health`

## Tech

FastAPI + Uvicorn, SQLite (`sqlite3`, in-memory, shared thread-safe connection),
a background-thread stream emitter (Kafka stand-in), a JSON-driven rules engine,
and a pluggable `predict()` classifier interface where a real scikit-learn model
would slot in. Standard library everywhere else — no ORM, no extra infra.
